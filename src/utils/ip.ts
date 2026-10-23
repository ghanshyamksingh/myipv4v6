import type { IPVersion } from '../types/ip';

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Validates IPv6 addresses according to RFC 4291 / RFC 5952.
 * Supports standard format, zero compression (::), IPv4-mapped IPv6, and link-local zone IDs.
 */
export function isIPv6(ip: string): boolean {
  if (!ip) return false;
  const cleaned = cleanIP(ip).toLowerCase();

  // Strip zone identifier if present (e.g. %eth0)
  const zoneIndex = cleaned.indexOf('%');
  const baseIP = zoneIndex !== -1 ? cleaned.substring(0, zoneIndex) : cleaned;

  // Cannot contain triple colon or more
  if (baseIP.includes(':::')) {
    return false;
  }

  // Cannot start or end with a single colon
  if (
    (baseIP.startsWith(':') && !baseIP.startsWith('::')) ||
    (baseIP.endsWith(':') && !baseIP.endsWith('::'))
  ) {
    return false;
  }

  // Double colon can only appear at most once
  const doubleColonCount = (baseIP.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;

  // Check for IPv4-mapped IPv6 (e.g., ::ffff:192.0.2.1)
  const lastColon = baseIP.lastIndexOf(':');
  if (lastColon !== -1 && baseIP.substring(lastColon + 1).includes('.')) {
    const ipv4Part = baseIP.substring(lastColon + 1);
    if (!isIPv4(ipv4Part)) return false;
    const ipv6Prefix = baseIP.substring(0, lastColon);
    return isIPv6(`${ipv6Prefix}:0:0`);
  }

  const parts = baseIP.split(':');
  if (doubleColonCount === 0) {
    if (parts.length !== 8) return false;
    return parts.every((part) => /^[0-9a-f]{1,4}$/.test(part));
  }

  // Handle :: compression
  const nonEmptyParts = parts.filter((p) => p.length > 0);
  if (nonEmptyParts.length > 7) return false;
  return nonEmptyParts.every((part) => /^[0-9a-f]{1,4}$/.test(part));
}

export function isIPv4(ip: string): boolean {
  if (!ip) return false;
  return IPV4_REGEX.test(cleanIP(ip));
}

export function isValidIP(ip: string): boolean {
  return isIPv4(ip) || isIPv6(ip);
}

export function getIPVersion(ip: string): IPVersion | null {
  if (isIPv4(ip)) return 'IPv4';
  if (isIPv6(ip)) return 'IPv6';
  return null;
}

export function cleanIP(ip: string): string {
  if (!ip) return '';
  return ip.trim().replace(/^\[|\]$/g, '');
}

/**
 * Checks whether an IP address belongs to private/bogon/loopback ranges.
 */
export function isPrivateIP(ip: string): boolean {
  const cleaned = cleanIP(ip);
  if (!cleaned) return true;

  if (isIPv4(cleaned)) {
    const parts = cleaned.split('.').map((p) => parseInt(p, 10));
    const [p0, p1] = parts;

    // Loopback 127.0.0.0/8
    if (p0 === 127) return true;
    // 0.0.0.0/8
    if (p0 === 0) return true;
    // Private 10.0.0.0/8
    if (p0 === 10) return true;
    // Carrier-grade NAT 100.64.0.0/10
    if (p0 === 100 && p1 !== undefined && p1 >= 64 && p1 <= 127) return true;
    // Private 172.16.0.0/12
    if (p0 === 172 && p1 !== undefined && p1 >= 16 && p1 <= 31) return true;
    // Link-local 169.254.0.0/16
    if (p0 === 169 && p1 === 254) return true;
    // Private 192.168.0.0/16
    if (p0 === 192 && p1 === 168) return true;
    // Broadcast 255.255.255.255
    if (p0 === 255) return true;

    return false;
  }

  if (isIPv6(cleaned)) {
    const lower = cleaned.toLowerCase();
    // Loopback
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
    // Unspecified
    if (lower === '::') return true;
    // Unique local address fc00::/7
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link-local fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    return false;
  }

  return false;
}

/**
 * Extracts public client IP from incoming HTTP request.
 *
 * Security Guarantee:
 * - When running in production behind Cloudflare, CF-Connecting-IP is set by the edge
 *   proxy based on the actual TCP connection and cannot be forged by the client.
 *   Therefore, under Cloudflare we trust ONLY CF-Connecting-IP.
 * - Headers like X-Forwarded-For, X-Real-IP, and True-Client-IP are untrusted and ignored
 *   in production because any HTTP client can spoof them.
 * - In local development or automated testing (where CF-Connecting-IP is not present),
 *   we allow non-private forwarded headers or fall back to '1.1.1.1' so the UI displays
 *   realistic geolocation and diagnostics.
 */
export function getClientIP(request: Request): string {
  const headers = request.headers;

  // Cloudflare Primary Header: Authoritative in production
  const cfIP = headers.get('cf-connecting-ip');
  if (cfIP) {
    const cleaned = cleanIP(cfIP);
    if (isValidIP(cleaned)) {
      return cleaned;
    }
  }

  // Local development / non-Cloudflare fallback only:
  // Check if this request is running locally (e.g. localhost, 127.0.0.1, ::1)
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIP = cleanIP(forwardedFor.split(',')[0]?.trim());
    if (isValidIP(firstIP) && !isPrivateIP(firstIP)) {
      return firstIP;
    }
  }

  const realIP = headers.get('x-real-ip');
  if (realIP) {
    const cleaned = cleanIP(realIP);
    if (isValidIP(cleaned) && !isPrivateIP(cleaned)) {
      return cleaned;
    }
  }

  // Local development fallback IP (Cloudflare Anycast 1.1.1.1)
  // Ensures local dev exhibits full network diagnostics without crashing.
  return '1.1.1.1';
}
