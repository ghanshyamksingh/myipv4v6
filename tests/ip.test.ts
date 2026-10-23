import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidIP,
  isIPv4,
  isIPv6,
  isPrivateIP,
  cleanIP,
  getIPVersion,
  getClientIP,
  maskIP,
} from '../src/utils/ip.ts';
import {
  checkRateLimit,
  getRateLimitHeaders,
  RATE_LIMIT_TIERS,
} from '../src/utils/rateLimit.ts';
import {
  enrichIP,
  isCacheable,
  isCircuitOpen,
  recordProviderFailure,
  recordProviderSuccess,
  resetCircuitBreakers,
} from '../src/utils/enrichment.ts';
import type { IPDetails } from '../src/types/ip.ts';

describe('IP Utilities Test Suite', () => {
  describe('IPv4 Validation & Detection', () => {
    it('correctly identifies valid IPv4 addresses', () => {
      assert.equal(isIPv4('1.1.1.1'), true);
      assert.equal(isIPv4('8.8.8.8'), true);
      assert.equal(isIPv4('192.168.1.1'), true);
      assert.equal(isIPv4('255.255.255.255'), true);
      assert.equal(isIPv4('0.0.0.0'), true);
    });

    it('rejects invalid IPv4 addresses', () => {
      assert.equal(isIPv4('256.0.0.1'), false);
      assert.equal(isIPv4('1.2.3'), false);
      assert.equal(isIPv4('1.2.3.4.5'), false);
      assert.equal(isIPv4('abc.def.ghi.jkl'), false);
      assert.equal(isIPv4(''), false);
    });
  });

  describe('IPv6 Validation (RFC 4291 / RFC 5952)', () => {
    it('correctly validates standard and compressed IPv6 addresses', () => {
      assert.equal(isIPv6('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true);
      assert.equal(isIPv6('2001:db8:85a3::8a2e:370:7334'), true);
      assert.equal(isIPv6('2606:4700:4700::1111'), true);
      assert.equal(isIPv6('::1'), true);
      assert.equal(isIPv6('::'), true);
      assert.equal(isIPv6('fe80::1ff:fe23:4567:890a'), true);
    });

    it('strips brackets and zone identifiers cleanly', () => {
      assert.equal(isIPv6('[2606:4700:4700::1111]'), true);
      assert.equal(isIPv6('fe80::1%eth0'), true);
      assert.equal(isIPv6('[fe80::1%eth0]'), true);
    });

    it('rejects malformed IPv6 addresses', () => {
      assert.equal(isIPv6('1200::AB00:1234::2552:7777:1313'), false); // multiple ::
      assert.equal(isIPv6('1:::2'), false); // triple colon
      assert.equal(isIPv6(':2001:db8::1'), false); // single leading colon
      assert.equal(isIPv6('2001:db8::1:'), false); // single trailing colon
      assert.equal(isIPv6('2001:xyz::1'), false); // non-hex
      assert.equal(isIPv6(''), false);
    });
  });

  describe('cleanIP and isValidIP', () => {
    it('cleans brackets and trims whitespace', () => {
      assert.equal(cleanIP('  [1.1.1.1]  '), '1.1.1.1');
      assert.equal(cleanIP('[2606:4700::1]'), '2606:4700::1');
      assert.equal(cleanIP('  [fe80::1%eth0]  '), 'fe80::1');
      assert.equal(cleanIP('fe80::1%en0'), 'fe80::1');
    });

    it('identifies valid and invalid IPs uniformly', () => {
      assert.equal(isValidIP('1.1.1.1'), true);
      assert.equal(isValidIP('2001:db8::1'), true);
      assert.equal(isValidIP('fe80::1%eth0'), true);
      assert.equal(isValidIP('not-an-ip'), false);
      assert.equal(isValidIP(''), false);
    });

    it('returns correct IPVersion', () => {
      assert.equal(getIPVersion('1.1.1.1'), 'IPv4');
      assert.equal(getIPVersion('2606:4700:4700::1111'), 'IPv6');
      assert.equal(getIPVersion('invalid'), null);
    });
  });

  describe('isPrivateIP — Comprehensive Bogon & Special-Use Coverage', () => {
    describe('IPv4 Special & Bogon Ranges', () => {
      it('detects 0.0.0.0/8 (This host on this network, RFC 1122)', () => {
        assert.equal(isPrivateIP('0.0.0.0'), true);
        assert.equal(isPrivateIP('0.1.2.3'), true);
        assert.equal(isPrivateIP('0.255.255.255'), true);
      });

      it('detects 10.0.0.0/8 (Private network, RFC 1918)', () => {
        assert.equal(isPrivateIP('10.0.0.1'), true);
        assert.equal(isPrivateIP('10.123.45.67'), true);
        assert.equal(isPrivateIP('10.255.255.255'), true);
      });

      it('detects 100.64.0.0/10 (Carrier-Grade NAT / Shared Space, RFC 6598)', () => {
        assert.equal(isPrivateIP('100.64.0.1'), true);
        assert.equal(isPrivateIP('100.100.50.25'), true);
        assert.equal(isPrivateIP('100.127.255.254'), true);
        // Boundaries outside 100.64.0.0/10 must not be treated as CGNAT
        assert.equal(isPrivateIP('100.63.255.255'), false);
        assert.equal(isPrivateIP('100.128.0.0'), false);
      });

      it('detects 127.0.0.0/8 (Loopback, RFC 1122)', () => {
        assert.equal(isPrivateIP('127.0.0.1'), true);
        assert.equal(isPrivateIP('127.10.20.30'), true);
        assert.equal(isPrivateIP('127.255.255.255'), true);
      });

      it('detects 169.254.0.0/16 (Link-Local, RFC 3927)', () => {
        assert.equal(isPrivateIP('169.254.0.1'), true);
        assert.equal(isPrivateIP('169.254.255.255'), true);
      });

      it('detects 172.16.0.0/12 (Private network range 172.16–172.31, RFC 1918)', () => {
        assert.equal(isPrivateIP('172.16.0.1'), true);
        assert.equal(isPrivateIP('172.24.10.20'), true);
        assert.equal(isPrivateIP('172.31.255.255'), true);
        // Boundaries outside 172.16.0.0/12 must be public
        assert.equal(isPrivateIP('172.15.255.255'), false);
        assert.equal(isPrivateIP('172.32.0.1'), false);
      });

      it('detects 192.0.0.0/24 (IETF Protocol Assignments, RFC 6890)', () => {
        assert.equal(isPrivateIP('192.0.0.1'), true);
        assert.equal(isPrivateIP('192.0.0.255'), true);
      });

      it('detects 192.0.2.0/24 (TEST-NET-1 Documentation, RFC 5737)', () => {
        assert.equal(isPrivateIP('192.0.2.1'), true);
        assert.equal(isPrivateIP('192.0.2.254'), true);
      });

      it('detects 192.168.0.0/16 (Private network, RFC 1918)', () => {
        assert.equal(isPrivateIP('192.168.0.1'), true);
        assert.equal(isPrivateIP('192.168.1.1'), true);
        assert.equal(isPrivateIP('192.168.255.255'), true);
      });

      it('detects 198.51.100.0/24 (TEST-NET-2 Documentation, RFC 5737)', () => {
        assert.equal(isPrivateIP('198.51.100.1'), true);
        assert.equal(isPrivateIP('198.51.100.254'), true);
      });

      it('detects 203.0.113.0/24 (TEST-NET-3 Documentation, RFC 5737)', () => {
        assert.equal(isPrivateIP('203.0.113.1'), true);
        assert.equal(isPrivateIP('203.0.113.254'), true);
      });

      it('detects 224.0.0.0/4 (Multicast, RFC 5771)', () => {
        assert.equal(isPrivateIP('224.0.0.1'), true);
        assert.equal(isPrivateIP('230.1.2.3'), true);
        assert.equal(isPrivateIP('239.255.255.255'), true);
      });

      it('detects 240.0.0.0/4 (Reserved / Future Use, RFC 1112)', () => {
        assert.equal(isPrivateIP('240.0.0.1'), true);
        assert.equal(isPrivateIP('250.10.20.30'), true);
        assert.equal(isPrivateIP('254.255.255.254'), true);
      });

      it('detects 255.255.255.255 (Broadcast, RFC 919)', () => {
        assert.equal(isPrivateIP('255.255.255.255'), true);
      });

      it('correctly classifies standard public IPv4 addresses', () => {
        assert.equal(isPrivateIP('1.1.1.1'), false);
        assert.equal(isPrivateIP('8.8.8.8'), false);
        assert.equal(isPrivateIP('93.184.216.34'), false);
        assert.equal(isPrivateIP('142.250.190.46'), false);
      });
    });

    describe('IPv6 Special & Bogon Ranges', () => {
      it('detects :: (Unspecified) and ::1 (Loopback, RFC 4291)', () => {
        assert.equal(isPrivateIP('::'), true);
        assert.equal(isPrivateIP('::1'), true);
      });

      it('detects fc00::/7 (Unique Local Address / ULA, RFC 4193)', () => {
        assert.equal(isPrivateIP('fc00::1'), true);
        assert.equal(isPrivateIP('fd00::1'), true);
        assert.equal(isPrivateIP('fd12:3456:789a::1'), true);
        assert.equal(isPrivateIP('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'), true);
      });

      it('detects fe80::/10 (Link-Local Unicast, RFC 4291)', () => {
        assert.equal(isPrivateIP('fe80::1'), true);
        assert.equal(isPrivateIP('fe80::1ff:fe23:4567:890a'), true);
        assert.equal(isPrivateIP('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff'), true);
      });

      it('detects ff00::/8 (Multicast, RFC 4291)', () => {
        assert.equal(isPrivateIP('ff00::1'), true);
        assert.equal(isPrivateIP('ff02::1'), true);
        assert.equal(isPrivateIP('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'), true);
      });

      it('detects 2001:db8::/32 (Documentation, RFC 3849)', () => {
        assert.equal(isPrivateIP('2001:db8::1'), true);
        assert.equal(isPrivateIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334'), true);
      });

      it('detects 2001::/32 (Teredo Tunneling, RFC 4380)', () => {
        assert.equal(isPrivateIP('2001:0000:4136:e378:8000:63bf:3fff:fdd2'), true);
        assert.equal(isPrivateIP('2001::1'), true);
      });

      it('detects 2002::/16 (6to4 Tunneling, RFC 3056)', () => {
        assert.equal(isPrivateIP('2002:c000:0204::1'), true);
        assert.equal(isPrivateIP('2002:cb00:7100::1'), true);
      });

      it('correctly handles IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)', () => {
        // Embedded private IPv4
        assert.equal(isPrivateIP('::ffff:192.168.1.1'), true);
        assert.equal(isPrivateIP('::ffff:10.0.0.1'), true);
        assert.equal(isPrivateIP('::ffff:127.0.0.1'), true);
        assert.equal(isPrivateIP('::ffff:169.254.1.1'), true);
        // Embedded public IPv4
        assert.equal(isPrivateIP('::ffff:8.8.8.8'), false);
        assert.equal(isPrivateIP('::ffff:1.1.1.1'), false);
      });

      it('correctly classifies standard public IPv6 addresses', () => {
        assert.equal(isPrivateIP('2606:4700:4700::1111'), false);
        assert.equal(isPrivateIP('2001:4860:4860::8888'), false);
        assert.equal(isPrivateIP('2400:cb00:2048:1::c629:d7a2'), false);
      });
    });
  });

  describe('getClientIP Security & Edge Rules', () => {
    it('strictly trusts CF-Connecting-IP in production', () => {
      const req = new Request('https://myipv4v6.com', {
        headers: {
          'cf-connecting-ip': '203.0.113.195',
          'x-forwarded-for': '198.51.100.1',
          'x-real-ip': '198.51.100.2',
        },
      });
      assert.equal(getClientIP(req), '203.0.113.195');
    });

    it('falls back to local development safe IP when running without headers', () => {
      const req = new Request('http://localhost:4321');
      assert.equal(getClientIP(req), '1.1.1.1');
    });
  });

  describe('maskIP Privacy Functionality', () => {
    it('masks IPv4 addresses while preserving network prefix', () => {
      assert.equal(maskIP('198.51.100.42'), '198.51.xxx.xxx');
      assert.equal(maskIP('1.1.1.1'), '1.1.xxx.xxx');
      assert.equal(maskIP('  [192.168.1.10]  '), '192.168.xxx.xxx');
    });

    it('masks IPv6 addresses while preserving leading segments', () => {
      assert.equal(
        maskIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334'),
        '2001:0db8:xxxx:...'
      );
      assert.equal(maskIP('2606:4700:4700::1111'), '2606:4700:xxxx:...');
      assert.equal(maskIP('[fe80::1]'), 'fe80::xxxx:...');
    });

    it('handles empty or invalid inputs gracefully', () => {
      assert.equal(maskIP(''), 'masked');
      assert.equal(maskIP('invalid-ip'), 'masked');
    });
  });

  describe('Rate Limiting Logic & Tiered Quotas', () => {
    it('exposes well-defined visitor and lookup tiers', () => {
      assert.equal(RATE_LIMIT_TIERS.VISITOR.limit, 60);
      assert.equal(RATE_LIMIT_TIERS.VISITOR.windowSeconds, 60);
      assert.equal(RATE_LIMIT_TIERS.LOOKUP.limit, 30);
      assert.equal(RATE_LIMIT_TIERS.LOOKUP.windowSeconds, 60);
    });

    it('allows requests within threshold and tracks remaining balance', async () => {
      const testIP = '198.51.100.50';
      const r1 = await checkRateLimit(testIP, undefined, 5, 60, 'test_allow');
      assert.equal(r1.allowed, true);
      assert.equal(r1.limit, 5);
      assert.equal(r1.remaining, 4);

      const headers = getRateLimitHeaders(r1);
      assert.equal(headers['X-RateLimit-Limit'], '5');
      assert.equal(headers['X-RateLimit-Remaining'], '4');
    });

    it('blocks requests once limit is exhausted', async () => {
      const testIP = '198.51.100.99';
      for (let i = 0; i < 3; i++) {
        await checkRateLimit(testIP, undefined, 3, 60, 'test_exhaust');
      }
      const overLimit = await checkRateLimit(testIP, undefined, 3, 60, 'test_exhaust');
      assert.equal(overLimit.allowed, false);
      assert.equal(overLimit.remaining, 0);
    });

    it('maintains isolation between visitor tier and lookup tier', async () => {
      const sharedIP = '198.51.100.77';
      // Exhaust lookup tier (limit = 2 for test)
      await checkRateLimit(sharedIP, undefined, 2, 60, 'lookup_tier');
      await checkRateLimit(sharedIP, undefined, 2, 60, 'lookup_tier');
      const lookupBlocked = await checkRateLimit(sharedIP, undefined, 2, 60, 'lookup_tier');
      assert.equal(lookupBlocked.allowed, false);

      // Visitor tier for the same IP should still have its full quota
      const visitorCheck = await checkRateLimit(sharedIP, undefined, 5, 60, 'visitor_tier');
      assert.equal(visitorCheck.allowed, true);
      assert.equal(visitorCheck.remaining, 4);
    });
  });

  describe('isCacheable Cache Poisoning Protection', () => {
    const baseDetails: IPDetails = {
      ip: '1.2.3.4',
      version: 'IPv4',
      isPrivate: false,
      hostname: 'test.host',
      city: 'Sydney',
      region: 'NSW',
      regionCode: 'NSW',
      country: 'Australia',
      countryCode: 'AU',
      postalCode: '2000',
      latitude: -33.8688,
      longitude: 151.2093,
      timezone: 'Australia/Sydney',
      asn: 'AS1234',
      asOrganization: 'Test Org',
      isp: 'Test ISP',
      colo: 'SYD',
      httpProtocol: 'HTTP/2',
      tlsVersion: 'TLSv1.3',
      source: 'ipwhois',
      localTime: '12:00 PM',
    };

    it('rejects null, undefined, or empty objects', () => {
      assert.equal(isCacheable(null), false);
      assert.equal(isCacheable(undefined), false);
    });

    it('rejects fallback source items', () => {
      assert.equal(isCacheable({ ...baseDetails, source: 'fallback' }), false);
    });

    it('rejects error placeholders in country field', () => {
      assert.equal(isCacheable({ ...baseDetails, country: 'Network query failed' }), false);
      assert.equal(isCacheable({ ...baseDetails, country: 'Lookup unavailable' }), false);
      assert.equal(isCacheable({ ...baseDetails, country: 'Invalid IP address format' }), false);
      assert.equal(isCacheable({ ...baseDetails, country: 'Unknown' }), false);
      assert.equal(isCacheable({ ...baseDetails, country: '' }), false);
    });

    it('rejects Unknown Provider in ISP field', () => {
      assert.equal(isCacheable({ ...baseDetails, isp: 'Unknown Provider' }), false);
    });

    it('accepts legitimate enriched IP records', () => {
      assert.equal(isCacheable(baseDetails), true);
      assert.equal(isCacheable({ ...baseDetails, source: 'ipinfo' }), true);
      assert.equal(isCacheable({ ...baseDetails, source: 'ip-api' }), true);
    });
  });

  describe('Enrichment and Fallback Provider Logic', () => {
    it('handles private IPs instantly without network requests', async () => {
      const res = await enrichIP('192.168.1.1');
      assert.equal(res.isPrivate, true);
      assert.equal(res.country, 'Private Network');
      assert.equal(res.source, 'fallback');
    });

    it('rejects invalid IP format gracefully without network requests', async () => {
      const res = await enrichIP('999.999.999.999');
      assert.equal(res.country, 'Invalid IP address format');
      assert.equal(res.source, 'fallback');
    });

    it('enriches mock public IP with mocked upstream provider', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: RequestInfo | URL) => {
          const urlStr = input.toString();
          if (urlStr.includes('ipwho.is/1.2.3.4')) {
            return new Response(
              JSON.stringify({
                success: true,
                ip: '1.2.3.4',
                type: 'IPv4',
                city: 'Brisbane',
                region: 'Queensland',
                region_code: 'QLD',
                country: 'Australia',
                country_code: 'AU',
                postal: '4000',
                latitude: -27.4698,
                longitude: 153.0251,
                timezone: { id: 'Australia/Brisbane' },
                connection: {
                  asn: 13335,
                  org: 'Cloudflare, Inc.',
                  isp: 'Cloudflare',
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('cloudflare-dns.com')) {
            return new Response(
              JSON.stringify({
                Status: 0,
                Answer: [{ data: 'one.one.one.one.' }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response('Not Found', { status: 404 });
        };

        const res = await enrichIP('1.2.3.4');
        assert.equal(res.ip, '1.2.3.4');
        assert.equal(res.country, 'Australia');
        assert.equal(res.isp, 'Cloudflare');
        assert.equal(res.source, 'ipwhois');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('falls back to secondary provider when primary returns HTTP 500', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: RequestInfo | URL) => {
          const urlStr = input.toString();
          // Primary provider ipwho.is fails
          if (urlStr.includes('ipwho.is/2.3.4.5')) {
            return new Response('Internal Server Error', { status: 500 });
          }
          // Secondary fallback ipinfo succeeds
          if (urlStr.includes('ipinfo.io/2.3.4.5')) {
            return new Response(
              JSON.stringify({
                ip: '2.3.4.5',
                city: 'Paris',
                region: 'Île-de-France',
                country: 'FR',
                loc: '48.8566,2.3522',
                org: 'AS12322 Free SAS',
                timezone: 'Europe/Paris',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (urlStr.includes('cloudflare-dns.com')) {
            return new Response(JSON.stringify({ Status: 3 }), { status: 200 });
          }
          return new Response('Not Found', { status: 404 });
        };

        const res = await enrichIP('2.3.4.5');
        assert.equal(res.ip, '2.3.4.5');
        assert.equal(res.source, 'ipinfo');
        assert.equal(res.city, 'Paris');
        assert.equal(res.country, 'FR');
      } finally {
        globalThis.fetch = originalFetch;
        resetCircuitBreakers();
      }
    });

    it('falls back to empty details with reverse DNS when all providers fail', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async (input: RequestInfo | URL) => {
          const urlStr = input.toString();
          if (urlStr.includes('cloudflare-dns.com')) {
            return new Response(
              JSON.stringify({
                Status: 0,
                Answer: [{ data: 'dns.google.' }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          // Both providers return 500
          return new Response('Service Unavailable', { status: 503 });
        };

        const res = await enrichIP('8.8.8.8');
        assert.equal(res.ip, '8.8.8.8');
        assert.equal(res.source, 'fallback');
        assert.equal(res.country, 'Network query failed');
        assert.equal(res.hostname, 'dns.google');
      } finally {
        globalThis.fetch = originalFetch;
        resetCircuitBreakers();
      }
    });

    it('private and bogon IPs short-circuit with zero network requests', async () => {
      const originalFetch = globalThis.fetch;
      let networkCalled = false;
      try {
        globalThis.fetch = async () => {
          networkCalled = true;
          throw new Error('Network should not be called for private bogon IP');
        };

        const res = await enrichIP('10.0.0.1');
        assert.equal(res.isPrivate, true);
        assert.equal(res.country, 'Private Network');
        assert.equal(res.source, 'fallback');
        assert.equal(networkCalled, false, 'Expected no fetch calls for private bogon IP');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Provider Circuit-Breaker Resilience', () => {
    it('opens circuit after consecutive failures and resets upon success', () => {
      resetCircuitBreakers();
      assert.equal(isCircuitOpen('ipwhois'), false);

      // Record 5 failures to trip breaker
      for (let i = 0; i < 5; i++) {
        recordProviderFailure('ipwhois');
      }
      assert.equal(isCircuitOpen('ipwhois'), true);

      // Record success resets the circuit
      recordProviderSuccess('ipwhois');
      assert.equal(isCircuitOpen('ipwhois'), false);
    });

    it('allows trial when cooldown has elapsed (half-open)', () => {
      resetCircuitBreakers();
      const realNow = Date.now;
      try {
        let mockedTime = 1000000;
        Date.now = () => mockedTime;

        for (let i = 0; i < 5; i++) {
          recordProviderFailure('ipwhois');
        }
        assert.equal(isCircuitOpen('ipwhois'), true);

        // Advance time past 30s cooldown
        mockedTime += 31000;
        assert.equal(isCircuitOpen('ipwhois'), false, 'Expected half-open trial to be allowed after cooldown');
      } finally {
        Date.now = realNow;
        resetCircuitBreakers();
      }
    });

    it('resetCircuitBreakers clears all provider circuit states', () => {
      for (let i = 0; i < 5; i++) {
        recordProviderFailure('ipinfo');
      }
      assert.equal(isCircuitOpen('ipinfo'), true);
      resetCircuitBreakers();
      assert.equal(isCircuitOpen('ipinfo'), false);
    });
  });
});
