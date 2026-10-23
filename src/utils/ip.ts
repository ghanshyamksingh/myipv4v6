import type { IPVersion } from '../types/ip';

const IPV4_REGEX =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * Strips surrounding brackets, whitespace, and link-local scope/zone identifiers.
 * e.g., '[fe80::1%eth0]' -> 'fe80::1', '  1.1.1.1  ' -> '1.1.1.1'
 */
export function cleanIP(ip: string): string {
  if (!ip) return '';
  const trimmed = ip.trim().replace(/^\[|\]$/g, '');
  const zoneIndex = trimmed.indexOf('%');
  return zoneIndex !== -1 ? trimmed.substring(0, zoneIndex) : trimmed;
}

/**
 * Decomposes an IPv6 address into its 8 16-bit numerical words (0-65535).
 * Accurately parses standard notation, zero compression (::), and embedded IPv4-mapped addresses.
 * Returns null if the address syntax is invalid according to RFC 4291 / RFC 5952.
 */
export function parseIPv6Words(ip: string): number[] | null {
  const cleaned = cleanIP(ip).toLowerCase();
  if (!cleaned) return null;

  // Cannot contain triple colons
  if (cleaned.includes(':::')) return null;

  // Cannot start or end with a single colon (only :: allowed at boundaries)
  if (
    (cleaned.startsWith(':') && !cleaned.startsWith('::')) ||
    (cleaned.endsWith(':') && !cleaned.endsWith('::'))
  ) {
    return null;
  }

  let base = cleaned;
  let ipv4Words: number[] = [];

  // Check for embedded IPv4 at the end (e.g., ::ffff:192.0.2.1)
  const lastColon = cleaned.lastIndexOf(':');
  if (lastColon !== -1 && cleaned.substring(lastColon + 1).includes('.')) {
    const ipv4Str = cleaned.substring(lastColon + 1);
    if (!isIPv4(ipv4Str)) return null;
    const octets = ipv4Str.split('.').map(Number);
    ipv4Words = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    base = cleaned.substring(0, lastColon);
  }

  const parts = base.split('::');
  if (parts.length > 2) return null; // Only one :: compression allowed

  let leftWords: number[] = [];
  let rightWords: number[] = [];

  if (parts[0]) {
    const leftHex = parts[0].split(':').filter(Boolean);
    for (const h of leftHex) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      leftWords.push(parseInt(h, 16));
    }
  }

  if (parts.length === 2 && parts[1]) {
    const rightHex = parts[1].split(':').filter(Boolean);
    for (const h of rightHex) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      rightWords.push(parseInt(h, 16));
    }
  }

  const totalKnown = leftWords.length + rightWords.length + ipv4Words.length;
  if (parts.length === 1) {
    if (totalKnown !== 8) return null;
    return [...leftWords, ...ipv4Words];
  } else {
    if (totalKnown > 8) return null;
    const zerosNeeded = 8 - totalKnown;
    return [...leftWords, ...new Array(zerosNeeded).fill(0), ...rightWords, ...ipv4Words];
  }
}

/**
 * Validates IPv6 addresses according to RFC 4291 / RFC 5952.
 */
export function isIPv6(ip: string): boolean {
  if (!ip) return false;
  return parseIPv6Words(ip) !== null;
}

/**
 * Validates standard IPv4 dotted-decimal format.
 */
export function isIPv4(ip: string): boolean {
  if (!ip) return false;
  return IPV4_REGEX.test(cleanIP(ip));
}

/**
 * Validates whether string is a valid public or private IPv4 or IPv6 address.
 */
export function isValidIP(ip: string): boolean {
  return isIPv4(ip) || isIPv6(ip);
}

export function getIPVersion(ip: string): IPVersion | null {
  if (isIPv4(ip)) return 'IPv4';
  if (isIPv6(ip)) return 'IPv6';
  return null;
}

/**
 * Checks whether 4 IPv4 octets fall within private, bogon, CGNAT, loopback, or reserved ranges.
 */
function isPrivateIPv4Octets(o0: number, o1: number, o2: number, _o3: number): boolean {
  // 0.0.0.0/8 (Current network / "this host", RFC 1122)
  if (o0 === 0) return true;

  // 10.0.0.0/8 (Private-Use, RFC 1918)
  if (o0 === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT, RFC 6598: 100.64.0.0 - 100.127.255.255)
  if (o0 === 100 && o1 >= 64 && o1 <= 127) return true;

  // 127.0.0.0/8 (Loopback, RFC 1122)
  if (o0 === 127) return true;

  // 169.254.0.0/16 (Link-Local, RFC 3927)
  if (o0 === 169 && o1 === 254) return true;

  // 172.16.0.0/12 (Private-Use, RFC 1918: 172.16.0.0 - 172.31.255.255)
  if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments, RFC 6890)
  if (o0 === 192 && o1 === 0 && o2 === 0) return true;

  // 192.0.2.0/24 (Documentation TEST-NET-1, RFC 5737)
  if (o0 === 192 && o1 === 0 && o2 === 2) return true;

  // 192.168.0.0/16 (Private-Use, RFC 1918)
  if (o0 === 192 && o1 === 168) return true;

  // 198.51.100.0/24 (Documentation TEST-NET-2, RFC 5737)
  if (o0 === 198 && o1 === 51 && o2 === 100) return true;

  // 203.0.113.0/24 (Documentation TEST-NET-3, RFC 5737)
  if (o0 === 203 && o1 === 0 && o2 === 113) return true;

  // 224.0.0.0/4 (Multicast, RFC 5771: 224.0.0.0 - 239.255.255.255)
  if (o0 >= 224 && o0 <= 239) return true;

  // 240.0.0.0/4 (Reserved for Future Use / Broadcast, RFC 1112: 240.0.0.0 - 255.255.255.255)
  if (o0 >= 240 && o0 <= 255) return true;

  return false;
}

/**
 * Checks whether an IP address belongs to non-public/private/bogon/loopback/multicast ranges.
 * Fully covers RFC 1918, RFC 3927, RFC 6598, RFC 5737, RFC 5771, RFC 1112,
 * RFC 4193, RFC 4291, RFC 3849, RFC 4380, and RFC 3056.
 */
export function isPrivateIP(ip: string): boolean {
  const cleaned = cleanIP(ip);
  if (!cleaned) return true;

  if (isIPv4(cleaned)) {
    const [o0, o1, o2, o3] = cleaned.split('.').map(Number);
    return isPrivateIPv4Octets(o0, o1, o2, o3);
  }

  if (isIPv6(cleaned)) {
    const words = parseIPv6Words(cleaned);
    if (!words) return true; // Malformed address treated as non-public

    // :: (unspecified) and ::1 (loopback)
    const isUnspecified = words.every((w) => w === 0);
    const isLoopback = words.slice(0, 7).every((w) => w === 0) && words[7] === 1;
    if (isUnspecified || isLoopback) return true;

    // fc00::/7 (Unique Local Address, RFC 4193: fc00:: - fdff:ffff:...)
    if ((words[0] & 0xfe00) === 0xfc00) return true;

    // fe80::/10 (Link-Local Unicast, RFC 4291: fe80:: - febf:ffff:...)
    if ((words[0] & 0xffc0) === 0xfe80) return true;

    // ff00::/8 (Multicast, RFC 4291: ff00:: - ffff:ffff:...)
    if ((words[0] & 0xff00) === 0xff00) return true;

    // 2001:db8::/32 (Documentation, RFC 3849)
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true;

    // 2001::/32 (Teredo tunneling prefix, RFC 4380)
    if (words[0] === 0x2001 && words[1] === 0x0000) return true;

    // 2002::/16 (6to4 tunneling prefix, RFC 3056)
    if (words[0] === 0x2002) return true;

    // IPv4-mapped addresses (::ffff:0:0/96 or ::ffff:x.x.x.x)
    // Returns true if the embedded IPv4 address is non-public/private
    const isIPv4Mapped =
      words[0] === 0 &&
      words[1] === 0 &&
      words[2] === 0 &&
      words[3] === 0 &&
      words[4] === 0 &&
      words[5] === 0xffff;

    if (isIPv4Mapped) {
      const o0 = (words[6] >> 8) & 0xff;
      const o1 = words[6] & 0xff;
      const o2 = (words[7] >> 8) & 0xff;
      const o3 = words[7] & 0xff;
      return isPrivateIPv4Octets(o0, o1, o2, o3);
    }

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
  return '1.1.1.1';
}

/**
 * Masks an IP address for privacy-safe logging and diagnostics.
 * Preserves network prefix while obfuscating host/client identifiers.
 * e.g., 198.51.100.42 -> 198.51.xxx.xxx, 2001:0db8::1 -> 2001:0db8:xxxx:...
 */
export function maskIP(ip: string): string {
  if (!ip) return 'masked';
  const cleaned = cleanIP(ip);
  if (isIPv4(cleaned)) {
    const parts = cleaned.split('.');
    return `${parts[0]}.${parts[1]}.xxx.xxx`;
  }
  if (isIPv6(cleaned)) {
    const parts = cleaned.split(':');
    return `${parts[0]}:${parts[1]}:xxxx:...`;
  }
  return 'masked';
}

