/**
 * Expands an IPv6 address string into 32 hexadecimal digits.
 */
function expandIPv6(ip: string): string | null {
  try {
    const address = ip.toLowerCase().trim();
    const parts = address.split('::');
    if (parts.length > 2) return null;

    let left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
    let right = parts[1] ? parts[1].split(':').filter(Boolean) : [];

    if (parts.length === 2) {
      const missing = 8 - (left.length + right.length);
      const zeros = Array(missing).fill('0');
      left = left.concat(zeros);
    }

    const fullBlocks = left.concat(right).map((b) => b.padStart(4, '0'));
    if (fullBlocks.length !== 8) return null;
    return fullBlocks.join('');
  } catch {
    return null;
  }
}

/**
 * Resolves Reverse DNS (PTR record) using Cloudflare DNS-over-HTTPS (DoH).
 * Fast, authoritative, 100% HTTPS, zero API tokens required.
 */
export async function resolveReverseDNS(ip: string): Promise<string | undefined> {
  if (!ip) return undefined;

  try {
    const trimmed = ip.trim();
    const isV4 = trimmed.includes('.');
    let ptrName = '';

    if (isV4) {
      const octets = trimmed.split('.');
      if (octets.length !== 4) return undefined;
      ptrName = `${octets[3]}.${octets[2]}.${octets[1]}.${octets[0]}.in-addr.arpa`;
    } else {
      const expanded = expandIPv6(trimmed);
      if (!expanded) return undefined;
      const reversedNibbles = expanded.split('').reverse().join('.');
      ptrName = `${reversedNibbles}.ip6.arpa`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(ptrName)}&type=PTR`, {
      headers: {
        Accept: 'application/dns-json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return undefined;
    const data: any = await res.json();

    if (data.Status === 0 && Array.isArray(data.Answer) && data.Answer.length > 0) {
      const record = data.Answer[0];
      if (record && typeof record.data === 'string') {
        // Strip trailing dot from FQDN
        return record.data.replace(/\.$/, '');
      }
    }
  } catch {
    // Timeout or DNS resolution failure
  }

  return undefined;
}
