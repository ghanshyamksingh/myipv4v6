export type IPVersion = 'IPv4' | 'IPv6';

export type IPSource =
  | 'cloudflare'
  | 'cache'
  | 'ipwhois'
  | 'ip-api'
  | 'ipinfo'
  | 'fallback';

export interface IPDetails {
  ip: string;
  version: IPVersion;
  isPrivate: boolean;
  hostname?: string;
  city?: string;
  region?: string;
  regionCode?: string;
  country?: string;
  countryCode?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  localTime?: string;
  asn?: string | number;
  asOrganization?: string;
  isp?: string;
  org?: string;
  colo?: string;
  httpProtocol?: string;
  tlsVersion?: string;
  userAgent?: string;
  flagEmoji?: string;
  source: IPSource;
  cachedAt?: number;
}

export interface CloudflareGeoData {
  asn?: number;
  asOrganization?: string;
  city?: string;
  country?: string;
  region?: string;
  regionCode?: string;
  postalCode?: string;
  metroCode?: string;
  timezone?: string;
  latitude?: string | number;
  longitude?: string | number;
  colo?: string;
  httpProtocol?: string;
  tlsVersion?: string;
  isEUCountry?: string | boolean;
  clientTcpRtt?: number;
}

export type SupportedProvider = 'ipwhois' | 'ipinfo' | 'ip-api';

export interface LookupProviderConfig {
  provider: SupportedProvider;
  ipinfoToken?: string;
  ipApiKey?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
}
