import type { CloudflareGeoData, IPDetails, LookupProviderConfig } from '../types/ip';
import type { CloudflareKVNamespace } from '../env';
import { cleanIP, getIPVersion, isPrivateIP, isValidIP } from './ip';
import { countryCodeToEmoji, getLocalTime } from './geo';
import { resolveReverseDNS } from './dns';

const memoryCache = new Map<string, { data: IPDetails; expiresAt: number }>();

export interface ExtendedProviderConfig extends LookupProviderConfig {
  ipApiKey?: string;
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
    providerConfig?: ExtendedProviderConfig;
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

  // 1. Check in-memory cache
  const memoryHit = memoryCache.get(cacheKey);
  if (memoryHit && now < memoryHit.expiresAt) {
    return { ...memoryHit.data, source: 'cache' };
  }

  // 2. Check Cloudflare KV cache
  if (options?.kv) {
    try {
      const cached = await options.kv.get(cacheKey, { type: 'json' });
      if (cached && typeof cached === 'object' && cached.ip) {
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

    // Resolve reverse DNS via DoH concurrently
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

  // 4. External Enrichment Provider (100% HTTPS)
  const provider = options?.providerConfig?.provider || 'ip-api';
  let details: IPDetails | null = null;

  try {
    if (provider === 'ipinfo') {
      details = await fetchFromIpinfo(ip, options?.providerConfig?.ipinfoToken);
    } else if (provider === 'ip-api' && options?.providerConfig?.ipApiKey) {
      details = await fetchFromIpApiPro(ip, options.providerConfig.ipApiKey);
    } else {
      // Default to ipwhois (free, 100% HTTPS, reliable)
      details = await fetchFromIpWhois(ip);
    }
  } catch {
    // If primary failed, try fallback
    try {
      details = await fetchFromIpWhois(ip);
    } catch {
      details = null;
    }
  }

  // 5. Ensure Reverse DNS is resolved if missing
  if (details && !details.hostname) {
    try {
      details.hostname = await resolveReverseDNS(ip);
    } catch {
      // Continue without reverse DNS
    }
  }

  if (details) {
    details.userAgent = options?.userAgent;
    details.httpProtocol = options?.protocol;
    details.localTime = getLocalTime(details.timezone);
    await saveToCache(cacheKey, details, options?.kv);
    return details;
  }

  // Fallback if network is unreachable
  return createEmptyDetails(ip, version, 'Network query failed');
}

/**
 * Free HTTPS Provider: ipwho.is (Zero auth required, 100% SSL)
 */
async function fetchFromIpWhois(ip: string): Promise<IPDetails | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`https://ipwho.is/${ip}`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.success) return null;

    return {
      ip: data.ip || ip,
      version: getIPVersion(ip) || 'IPv4',
      isPrivate: false,
      country: data.country,
      countryCode: data.country_code,
      flagEmoji: data.flag?.emoji || countryCodeToEmoji(data.country_code),
      region: data.region,
      regionCode: data.region_code,
      city: data.city,
      postalCode: data.postal,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone?.id,
      asn: data.connection?.asn ? `AS${data.connection.asn}` : undefined,
      asOrganization: data.connection?.org,
      isp: data.connection?.isp || data.connection?.org,
      org: data.connection?.org,
      hostname: data.connection?.domain,
      source: 'ip-api',
      cachedAt: Date.now(),
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Pro HTTPS Provider: pro.ip-api.com
 */
async function fetchFromIpApiPro(ip: string, key: string): Promise<IPDetails | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(
      `https://pro.ip-api.com/json/${ip}?key=${encodeURIComponent(key)}&fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,reverse,query`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data: any = await res.json();
    if (data.status !== 'success') return null;

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
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
      asn: data.as ? data.as.split(' ')[0] : undefined,
      asOrganization: data.as ? data.as.split(' ').slice(1).join(' ') : undefined,
      isp: data.isp,
      org: data.org,
      hostname: data.reverse,
      source: 'ip-api',
      cachedAt: Date.now(),
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * HTTPS Provider: ipinfo.io
 */
async function fetchFromIpinfo(ip: string, token?: string): Promise<IPDetails | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const url = new URL(`https://ipinfo.io/${ip}/json`);
    if (token) {
      url.searchParams.set('token', token);
    }

    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data: any = await res.json();

    const [latStr, lonStr] = (data.loc || '').split(',');
    const lat = latStr ? parseFloat(latStr) : undefined;
    const lon = lonStr ? parseFloat(lonStr) : undefined;

    return {
      ip: data.ip || ip,
      version: getIPVersion(ip) || 'IPv4',
      isPrivate: false,
      country: data.country,
      countryCode: data.country,
      flagEmoji: countryCodeToEmoji(data.country),
      region: data.region,
      city: data.city,
      postalCode: data.postal,
      latitude: lat,
      longitude: lon,
      timezone: data.timezone,
      asn: data.org ? data.org.split(' ')[0] : undefined,
      asOrganization: data.org ? data.org.split(' ').slice(1).join(' ') : undefined,
      isp: data.org,
      org: data.org,
      hostname: data.hostname,
      source: 'ipinfo',
      cachedAt: Date.now(),
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

async function saveToCache(key: string, details: IPDetails, kv?: CloudflareKVNamespace): Promise<void> {
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
