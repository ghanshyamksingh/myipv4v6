import type { CloudflareGeoData, IPDetails, LookupProviderConfig, SupportedProvider } from '../types/ip';
import type { CloudflareKVNamespace } from '../env';
import { cleanIP, getIPVersion, isPrivateIP, isValidIP } from './ip.ts';
import { countryCodeToEmoji, getLocalTime } from './geo.ts';
import { resolveReverseDNS } from './dns.ts';

const memoryCache = new Map<string, { data: IPDetails; expiresAt: number }>();
const MAX_ENRICHMENT_CACHE_SIZE = 1000;
const USER_AGENT = 'myipv4v6/1.0 (https://myipv4v6.com; edge lookup)';

function pruneEnrichmentCache(now: number): void {
  if (memoryCache.size > MAX_ENRICHMENT_CACHE_SIZE) {
    for (const [key, val] of memoryCache.entries()) {
      if (now >= val.expiresAt) {
        memoryCache.delete(key);
      }
    }
    if (memoryCache.size > MAX_ENRICHMENT_CACHE_SIZE) {
      const keysToDelete = Array.from(memoryCache.keys()).slice(0, 200);
      for (const k of keysToDelete) {
        memoryCache.delete(k);
      }
    }
  }
}

/**
 * Checks if IP details contain real, valid data suitable for caching.
 * Prevents failed network queries and empty fallback placeholders from poisoning KV cache.
 */
function isCacheable(details: IPDetails | null | undefined): boolean {
  if (!details || details.source === 'fallback') return false;
  if (!details.country) return false;
  const c = details.country.toLowerCase();
  if (c.includes('failed') || c.includes('unavailable') || c === 'unknown' || c === 'lookup unavailable') {
    return false;
  }
  return true;
}

/**
 * Enriches an IP address with geolocation, ASN, ISP, reverse DNS, and network data.
 * Pure HTTPS only. Caches results in Cloudflare KV (24 hours).
 */
export async function enrichIP(
  rawIP: string,
  options?: {
    cfData?: CloudflareGeoData;
    isVisitor?: boolean;
    kv?: CloudflareKVNamespace;
    providerConfig?: LookupProviderConfig;
    userAgent?: string;
    protocol?: string;
  }
): Promise<IPDetails> {
  const ip = cleanIP(rawIP);
  const version = getIPVersion(ip) || 'IPv4';

  if (!isValidIP(ip)) {
    return createEmptyDetails(ip, version, 'Invalid IP address format');
  }

  // Handle Private / Bogon / Loopback IPs
  if (isPrivateIP(ip)) {
    return {
      ip,
      version,
      isPrivate: true,
      country: 'Private Network',
      countryCode: 'XX',
      flagEmoji: '🔒',
      city: 'Local Area Network',
      region: 'RFC 1918 / Private',
      isp: 'Internal / Non-routable IP',
      org: 'Local Subnet',
      asn: 'N/A',
      hostname: 'localhost',
      timezone: 'UTC',
      localTime: getLocalTime('UTC'),
      source: 'fallback',
      userAgent: options?.userAgent,
      httpProtocol: options?.protocol,
    };
  }

  const cacheKey = `ip:${ip}`;
  const now = Date.now();

  // 1. Check in-memory cache (only accept valid non-poisoned entries)
  const memoryHit = memoryCache.get(cacheKey);
  if (memoryHit && now < memoryHit.expiresAt && isCacheable(memoryHit.data)) {
    return { ...memoryHit.data, source: 'cache' };
  }

  // 2. Check Cloudflare KV cache (only accept valid non-poisoned entries)
  if (options?.kv) {
    try {
      const cached = await options.kv.get(cacheKey, { type: 'json' });
      if (cached && typeof cached === 'object' && cached.ip && isCacheable(cached)) {
        pruneEnrichmentCache(now);
        memoryCache.set(cacheKey, { data: cached, expiresAt: now + 3600 * 1000 });
        return {
          ...cached,
          source: 'cache',
          localTime: getLocalTime(cached.timezone),
        };
      }
    } catch {
      // Continue on cache miss
    }
  }

  // 3. If visitor IP and Cloudflare edge geolocation data is available
  if (options?.isVisitor && options?.cfData?.country) {
    const cf = options.cfData;
    const lat = typeof cf.latitude === 'string' ? parseFloat(cf.latitude) : cf.latitude;
    const lon = typeof cf.longitude === 'string' ? parseFloat(cf.longitude) : cf.longitude;

    // Resolve authoritative reverse DNS via DoH concurrently
    const rDnsPromise = resolveReverseDNS(ip);

    const details: IPDetails = {
      ip,
      version,
      isPrivate: false,
      country: cf.country || 'Unknown',
      countryCode: cf.country,
      flagEmoji: countryCodeToEmoji(cf.country),
      region: cf.region || cf.regionCode,
      regionCode: cf.regionCode,
      city: cf.city,
      postalCode: cf.postalCode,
      latitude: lat,
      longitude: lon,
      timezone: cf.timezone,
      localTime: getLocalTime(cf.timezone),
      asn: cf.asn ? `AS${cf.asn}` : undefined,
      asOrganization: cf.asOrganization,
      isp: cf.asOrganization || 'Cloudflare Routed Network',
      org: cf.asOrganization,
      colo: cf.colo,
      httpProtocol: options.protocol || cf.httpProtocol,
      tlsVersion: cf.tlsVersion,
      userAgent: options.userAgent,
      source: 'cloudflare',
      cachedAt: now,
    };

    details.hostname = await rDnsPromise;

    await saveToCache(cacheKey, details, options?.kv);
    return details;
  }

  // 4. Reliable multi-provider fallback for arbitrary/non-visitor lookups
  // Order:
  // 1) configured provider (default: ipwhois)
  // 2) if that fails -> ipwhois (if not already tried)
  // 3) if that fails -> ipinfo (token optional; free tier without token as last resort)
  // 4) if that fails -> createEmptyDetails with message 'Network query failed'
  const configuredProvider: SupportedProvider = options?.providerConfig?.provider || 'ipwhois';
  let details: IPDetails | null = null;

  try {
    if (configuredProvider === 'ipinfo') {
      details = await fetchFromIpinfo(ip, options?.providerConfig?.ipinfoToken);
    } else if (configuredProvider === 'ip-api' && options?.providerConfig?.ipApiKey) {
      details = await fetchFromIpApiPro(ip, options.providerConfig.ipApiKey);
    } else {
      details = await fetchFromIpWhois(ip);
    }
  } catch (err: any) {
    console.error(`[Enrichment Error] Provider ${configuredProvider} failed for ${maskIP(ip)}:`, err?.message || err);
  }

  // Secondary fallback: ipwhois if not already tried
  if (!details && configuredProvider !== 'ipwhois') {
    try {
      details = await fetchFromIpWhois(ip);
    } catch (err: any) {
      console.warn(`[Enrichment Fallback] ipwhois failed for ${maskIP(ip)}:`, err?.message || err);
    }
  }

  // Tertiary fallback: ipinfo (free tier or token)
  if (!details && configuredProvider !== 'ipinfo') {
    try {
      details = await fetchFromIpinfo(ip, options?.providerConfig?.ipinfoToken);
    } catch (err: any) {
      console.warn(`[Enrichment Fallback] ipinfo failed for ${maskIP(ip)}:`, err?.message || err);
    }
  }

  // 5. Ensure Authoritative Reverse DNS is resolved if missing
  if (details) {
    if (!details.hostname) {
      try {
        const rDns = await resolveReverseDNS(ip);
        if (rDns) details.hostname = rDns;
      } catch {
        // Reverse DNS resolution is best-effort
      }
    }

    details.userAgent = options?.userAgent;
    details.httpProtocol = options?.protocol;
    details.localTime = getLocalTime(details.timezone);
    await saveToCache(cacheKey, details, options?.kv);
    return details;
  }

  // 6. If all external providers fail, still attempt reverse DNS so we have some diagnostic data
  let fallbackHostname: string | undefined;
  try {
    fallbackHostname = await resolveReverseDNS(ip);
  } catch {
    // Continue without hostname
  }

  const empty = createEmptyDetails(ip, version, 'Network query failed');
  if (fallbackHostname) {
    empty.hostname = fallbackHostname;
  }
  empty.userAgent = options?.userAgent;
  empty.httpProtocol = options?.protocol;
  return empty;
}

/**
 * Free HTTPS Provider: ipwho.is (Zero auth required, 100% SSL)
 * Hardened with 8000ms timeout and proper Accept / User-Agent headers.
 */
async function fetchFromIpWhois(ip: string): Promise<IPDetails | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Enrichment] ipwhois returned HTTP ${res.status} for ${maskIP(ip)}`);
      return null;
    }

    const data: any = await res.json();
    if (!data || data.success === false) {
      console.warn(`[Enrichment] ipwhois returned success=false for ${maskIP(ip)}: ${data?.message || 'unknown'}`);
      return null;
    }

    const lat = typeof data.latitude === 'number' ? data.latitude : undefined;
    const lon = typeof data.longitude === 'number' ? data.longitude : undefined;

    return {
      ip: data.ip || ip,
      version: getIPVersion(ip) || 'IPv4',
      isPrivate: false,
      country: data.country || 'Unknown',
      countryCode: data.country_code,
      flagEmoji: data.flag?.emoji || countryCodeToEmoji(data.country_code),
      region: data.region,
      regionCode: data.region_code,
      city: data.city,
      postalCode: data.postal,
      latitude: lat,
      longitude: lon,
      timezone: data.timezone?.id,
      asn: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
      asOrganization: data.connection?.org,
      isp: data.connection?.isp || data.connection?.org || 'Unknown Provider',
      org: data.connection?.org,
      hostname: data.connection?.domain,
      source: 'ipwhois',
      cachedAt: Date.now(),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Enrichment] ipwhois fetch error for ${maskIP(ip)}:`, err?.message || err);
    return null;
  }
}

/**
 * Pro HTTPS Provider: pro.ip-api.com (Requires paid API Key)
 */
async function fetchFromIpApiPro(ip: string, key: string): Promise<IPDetails | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(
      `https://pro.ip-api.com/json/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}&fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,reverse,query`,
      {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
        },
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Enrichment] ip-api pro returned HTTP ${res.status} for ${maskIP(ip)}`);
      return null;
    }

    const data: any = await res.json();
    if (!data || data.status !== 'success') {
      console.warn(`[Enrichment] ip-api pro returned status=${data?.status} for ${maskIP(ip)}: ${data?.message || 'unknown'}`);
      return null;
    }

    return {
      ip: data.query || ip,
      version: getIPVersion(ip) || 'IPv4',
      isPrivate: false,
      country: data.country,
      countryCode: data.countryCode,
      flagEmoji: countryCodeToEmoji(data.countryCode),
      region: data.regionName,
      regionCode: data.region,
      city: data.city,
      postalCode: data.zip,
      latitude: typeof data.lat === 'number' ? data.lat : undefined,
      longitude: typeof data.lon === 'number' ? data.lon : undefined,
      timezone: data.timezone,
      asn: data.as ? data.as.split(' ')[0] : undefined,
      asOrganization: data.as ? data.as.split(' ').slice(1).join(' ') : undefined,
      isp: data.isp,
      org: data.org,
      hostname: data.reverse,
      source: 'ip-api',
      cachedAt: Date.now(),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Enrichment] ip-api pro fetch error for ${maskIP(ip)}:`, err?.message || err);
    return null;
  }
}

/**
 * HTTPS Provider: ipinfo.io (Free tier without token or authenticated with token)
 */
async function fetchFromIpinfo(ip: string, token?: string): Promise<IPDetails | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const url = new URL(`https://ipinfo.io/${encodeURIComponent(ip)}/json`);
    if (token) {
      url.searchParams.set('token', token);
    }

    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Enrichment] ipinfo returned HTTP ${res.status} for ${maskIP(ip)}`);
      return null;
    }

    const data: any = await res.json();
    if (!data || data.bogon) {
      return null;
    }

    const [latStr, lonStr] = (data.loc || '').split(',');
    const lat = latStr ? parseFloat(latStr) : undefined;
    const lon = lonStr ? parseFloat(lonStr) : undefined;

    return {
      ip: data.ip || ip,
      version: getIPVersion(ip) || 'IPv4',
      isPrivate: false,
      country: data.country || 'Unknown',
      countryCode: data.country,
      flagEmoji: countryCodeToEmoji(data.country),
      region: data.region,
      city: data.city,
      postalCode: data.postal,
      latitude: lat && !isNaN(lat) ? lat : undefined,
      longitude: lon && !isNaN(lon) ? lon : undefined,
      timezone: data.timezone,
      asn: data.org ? data.org.split(' ')[0] : undefined,
      asOrganization: data.org ? data.org.split(' ').slice(1).join(' ') : undefined,
      isp: data.org || 'Unknown Provider',
      org: data.org,
      hostname: data.hostname,
      source: 'ipinfo',
      cachedAt: Date.now(),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Enrichment] ipinfo fetch error for ${maskIP(ip)}:`, err?.message || err);
    return null;
  }
}

async function saveToCache(key: string, details: IPDetails, kv?: CloudflareKVNamespace): Promise<void> {
  if (!isCacheable(details)) {
    return;
  }

  pruneEnrichmentCache(Date.now());
  memoryCache.set(key, { data: details, expiresAt: Date.now() + 3600 * 1000 });

  if (kv) {
    try {
      await kv.put(key, JSON.stringify(details), { expirationTtl: 86400 });
    } catch {
      // Continue on KV write error
    }
  }
}

function createEmptyDetails(ip: string, version: 'IPv4' | 'IPv6', message?: string): IPDetails {
  return {
    ip,
    version,
    isPrivate: false,
    country: message || 'Lookup Unavailable',
    countryCode: 'XX',
    flagEmoji: '🌐',
    city: 'Unknown',
    region: 'Unknown',
    isp: 'Unknown Provider',
    org: 'Unknown Organization',
    source: 'fallback',
    localTime: 'Unavailable',
  };
}

/**
 * Masks an IP address for structured observability without storing raw visitor IPs.
 * e.g., 198.51.100.42 -> 198.51.xxx.xxx, 2001:db8::1 -> 2001:db8:xxxx:...
 */
export function maskIP(ip: string): string {
  if (ip.includes('.')) {
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.xxx.xxx` : 'xxx.xxx.xxx.xxx';
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.length >= 2 ? `${parts[0]}:${parts[1]}:xxxx:...` : 'xxxx:...';
  }
  return 'masked';
}
