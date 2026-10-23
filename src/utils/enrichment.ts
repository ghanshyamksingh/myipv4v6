import type { CloudflareGeoData, IPDetails, LookupProviderConfig, SupportedProvider } from '../types/ip';
import type { CloudflareKVNamespace } from '../env';
import { cleanIP, getIPVersion, isPrivateIP, isValidIP, maskIP } from './ip.ts';
import { countryCodeToEmoji, getLocalTime } from './geo.ts';
import { resolveReverseDNS } from './dns.ts';
import { logger } from './logger.ts';

const memoryCache = new Map<string, { data: IPDetails; expiresAt: number }>();
const MAX_ENRICHMENT_CACHE_SIZE = 1000;
const USER_AGENT = 'myipv4v6/1.0 (https://myipv4v6.com; edge lookup)';

// Lightweight isolate-local circuit breaker for external providers
// Consecutively failed requests trip the breaker to skip a degraded provider during outages.
// When cooldown elapses, a single half-open trial is permitted.
interface CircuitState {
  failures: number;
  openUntil: number;
  halfOpenTrialInFlight?: boolean;
}
const providerCircuits = new Map<SupportedProvider, CircuitState>();
export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_COOLDOWN_MS = 30_000;

/**
 * Returns true only while the circuit is currently open and within its cooldown window.
 * If cooldown has elapsed, returns false (or true if a half-open trial is already active).
 */
export function isCircuitOpen(provider: SupportedProvider): boolean {
  const state = providerCircuits.get(provider);
  if (!state) return false;
  const now = Date.now();
  if (now < state.openUntil) {
    return true;
  }
  // Cooldown elapsed: half-open. Only block if another trial is currently in flight
  return Boolean(state.halfOpenTrialInFlight);
}

/**
 * Transitions a half-open circuit to an in-flight trial state so subsequent concurrent requests skip.
 */
export function startTrialIfHalfOpen(provider: SupportedProvider): boolean {
  const state = providerCircuits.get(provider);
  if (!state) return true;
  const now = Date.now();
  if (now < state.openUntil) {
    return false;
  }
  state.halfOpenTrialInFlight = true;
  return true;
}

export function recordProviderSuccess(provider: SupportedProvider): void {
  providerCircuits.delete(provider);
}

export function recordProviderFailure(provider: SupportedProvider): void {
  const now = Date.now();
  const state = providerCircuits.get(provider) || { failures: 0, openUntil: 0 };
  state.halfOpenTrialInFlight = false;
  state.failures += 1;
  if (state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openUntil = now + CIRCUIT_COOLDOWN_MS;
    logger.warn('provider_circuit_breaker_opened', {
      provider,
      consecutiveFailures: state.failures,
      cooldownSeconds: CIRCUIT_COOLDOWN_MS / 1000,
    });
  }
  providerCircuits.set(provider, state);
}

export function resetCircuitBreakers(): void {
  providerCircuits.clear();
}

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
 * Prevents failed network queries and empty fallback placeholders from poisoning KV or memory cache.
 */
export function isCacheable(details: IPDetails | null | undefined): boolean {
  if (!details || details.source === 'fallback') return false;
  if (!details.country) return false;
  const c = details.country.toLowerCase();
  if (
    c.includes('failed') ||
    c.includes('unavailable') ||
    c === 'unknown' ||
    c === 'lookup unavailable' ||
    c.includes('invalid')
  ) {
    return false;
  }
  if (details.isp && details.isp.toLowerCase().includes('unknown provider')) {
    return false;
  }
  return true;
}

/**
 * Enriches an IP address with geolocation, ASN, ISP, reverse DNS, and network data.
 *
 * Architecture & Caching Strategy:
 * - 24-Hour Cache TTL: Successful enrichment results are cached in Cloudflare KV (expirationTtl: 86400s)
 *   and in edge memory (1 hour) to minimize latency and third-party API consumption.
 * - Multi-Provider Fallback Order:
 *   1) Configured Provider (Default: 'ipwhois' via HTTPS)
 *   2) ipwhois (if configured provider was ipinfo or ip-api and failed)
 *   3) ipinfo (free tier or token fallback)
 *   4) Graceful fallback with Authoritative Reverse DNS (DoH) if all external providers fail.
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

  // Handle Private / Bogon / Loopback IPs immediately without outbound API calls
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

    // Resolve authoritative reverse DNS via Cloudflare DoH concurrently
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

  // 4. Reliable multi-provider fallback with isolate-local circuit breaker
  const primaryProvider: SupportedProvider = options?.providerConfig?.provider || 'ipwhois';
  
  // Build ordered candidate list:
  // 1. Configured primary (default ipwhois)
  // 2. ipwhois (if not primary)
  // 3. ipinfo (if not primary)
  // 4. ip-api (only if API key is configured and not primary)
  const candidateProviders: SupportedProvider[] = [primaryProvider];
  if (primaryProvider !== 'ipwhois') candidateProviders.push('ipwhois');
  if (primaryProvider !== 'ipinfo') candidateProviders.push('ipinfo');
  if (options?.providerConfig?.ipApiKey && primaryProvider !== 'ip-api') {
    candidateProviders.push('ip-api');
  }

  // Check if all candidate circuits are open
  const allCircuitsOpen = candidateProviders.every((p) => isCircuitOpen(p));

  let details: IPDetails | null = null;
  const triedProviders: SupportedProvider[] = [];

  for (const provider of candidateProviders) {
    // If all circuits are open, allow one trial on primary (true half-open); otherwise respect isCircuitOpen
    const canAttempt = allCircuitsOpen ? provider === primaryProvider : !isCircuitOpen(provider);

    if (!canAttempt) {
      logger.info('circuit_breaker_skipping_provider', { provider });
      continue;
    }

    startTrialIfHalfOpen(provider);
    triedProviders.push(provider);

    try {
      if (provider === 'ipwhois') {
        details = await fetchFromIpWhois(ip);
      } else if (provider === 'ipinfo') {
        details = await fetchFromIpinfo(ip, options?.providerConfig?.ipinfoToken);
      } else if (provider === 'ip-api' && options?.providerConfig?.ipApiKey) {
        details = await fetchFromIpApiPro(ip, options.providerConfig.ipApiKey);
      }

      if (details) {
        recordProviderSuccess(provider);
        break;
      } else {
        recordProviderFailure(provider);
      }
    } catch (err: any) {
      recordProviderFailure(provider);
      logger.error('enrichment_provider_failed', {
        provider,
        ip,
        error: err?.message || String(err),
      });
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

  // 6. If all external providers fail, log and attempt reverse DNS for diagnostics
  logger.warn('enrichment_all_providers_failed', {
    ip,
    triedProviders,
    allCircuitsOpen,
  });

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

    if (!res.ok) {
      let snippet = '';
      try {
        snippet = (await res.text()).slice(0, 100);
      } catch {}
      logger.warn('ipwhois_http_status_error', { provider: 'ipwhois', ip, status: res.status, snippet });
      return null;
    }

    const data: any = await res.json();
    if (!data || data.success === false) {
      logger.warn('ipwhois_response_unsuccessful', {
        provider: 'ipwhois',
        ip,
        message: data?.message || 'unknown',
      });
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
    logger.warn('ipwhois_network_exception', {
      provider: 'ipwhois',
      ip,
      error: err?.message || String(err),
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
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

    if (!res.ok) {
      let snippet = '';
      try {
        snippet = (await res.text()).slice(0, 100);
      } catch {}
      logger.warn('ip_api_pro_http_status_error', { provider: 'ip-api', ip, status: res.status, snippet });
      return null;
    }

    const data: any = await res.json();
    if (!data || data.status !== 'success') {
      logger.warn('ip_api_pro_response_unsuccessful', {
        provider: 'ip-api',
        ip,
        status: data?.status,
        message: data?.message || 'unknown',
      });
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
    logger.warn('ip_api_pro_network_exception', {
      provider: 'ip-api',
      ip,
      error: err?.message || String(err),
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
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

    if (!res.ok) {
      let snippet = '';
      try {
        snippet = (await res.text()).slice(0, 100);
      } catch {}
      logger.warn('ipinfo_http_status_error', { provider: 'ipinfo', ip, status: res.status, snippet });
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
    logger.warn('ipinfo_network_exception', {
      provider: 'ipinfo',
      ip,
      error: err?.message || String(err),
    });
    return null;
  } finally {
    clearTimeout(timeoutId);
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

export { maskIP };
