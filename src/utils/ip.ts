import type { IPVersion } from '../types/ip';

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const IPV6_REGEX =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d)|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?\d)?\d)\.){3}(25[0-5]|(2[0-4]|1?\d)?\d))$/;

export function isIPv4(ip: string): boolean {
  if (!ip) return false;
  return IPV4_REGEX.test(ip.trim());
}

export function isIPv6(ip: string): boolean {
  if (!ip) return false;
  return IPV6_REGEX.test(ip.trim());
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
 * Prioritizes Cloudflare headers: CF-Connecting-IP, True-Client-IP, X-Real-IP, X-Forwarded-For.
 */
export function getClientIP(request: Request): string {
  const headers = request.headers;

  // Cloudflare Primary Header
  const cfIP = headers.get('cf-connecting-ip');
  if (cfIP && isValidIP(cleanIP(cfIP))) {
    return cleanIP(cfIP);
  }

  // Akamai / Enterprise Cloudflare
  const trueClientIP = headers.get('true-client-ip');
  if (trueClientIP && isValidIP(cleanIP(trueClientIP))) {
    return cleanIP(trueClientIP);
  }

  // Reverse proxy standard
  const realIP = headers.get('x-real-ip');
  if (realIP && isValidIP(cleanIP(realIP))) {
    return cleanIP(realIP);
  }

  // Standard X-Forwarded-For: client, proxy1, proxy2
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIP = forwardedFor.split(',')[0]?.trim();
    if (firstIP && isValidIP(cleanIP(firstIP))) {
      return cleanIP(firstIP);
    }
  }

  // Local development fallback IP (Cloudflare 1.1.1.1) so local dev exhibits rich UI
  return '1.1.1.1';
}
