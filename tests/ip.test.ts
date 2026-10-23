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
} from '../src/utils/ip.ts';
import { checkRateLimit, getRateLimitHeaders } from '../src/utils/rateLimit.ts';

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
    });

    it('identifies valid and invalid IPs uniformly', () => {
      assert.equal(isValidIP('1.1.1.1'), true);
      assert.equal(isValidIP('2001:db8::1'), true);
      assert.equal(isValidIP('not-an-ip'), false);
    });

    it('returns correct IPVersion', () => {
      assert.equal(getIPVersion('1.1.1.1'), 'IPv4');
      assert.equal(getIPVersion('2606:4700:4700::1111'), 'IPv6');
      assert.equal(getIPVersion('invalid'), null);
    });
  });

  describe('isPrivateIP (Bogon / RFC 1918 / RFC 4193)', () => {
    it('detects private IPv4 networks', () => {
      assert.equal(isPrivateIP('10.0.0.1'), true);
      assert.equal(isPrivateIP('172.16.5.4'), true);
      assert.equal(isPrivateIP('172.31.255.255'), true);
      assert.equal(isPrivateIP('192.168.1.1'), true);
      assert.equal(isPrivateIP('127.0.0.1'), true);
      assert.equal(isPrivateIP('169.254.1.1'), true);
      assert.equal(isPrivateIP('100.64.0.1'), true); // CGNAT
    });

    it('distinguishes public IPv4 addresses', () => {
      assert.equal(isPrivateIP('1.1.1.1'), false);
      assert.equal(isPrivateIP('8.8.8.8'), false);
      assert.equal(isPrivateIP('172.32.0.1'), false);
    });

    it('detects private IPv6 subnets', () => {
      assert.equal(isPrivateIP('::1'), true);
      assert.equal(isPrivateIP('fc00::1'), true);
      assert.equal(isPrivateIP('fd12:3456:789a::1'), true);
      assert.equal(isPrivateIP('fe80::1'), true);
      assert.equal(isPrivateIP('2606:4700:4700::1111'), false);
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

  describe('Rate Limiting Logic', () => {
    it('allows requests within threshold and tracks remaining balance', async () => {
      const testIP = '198.51.100.50';
      const r1 = await checkRateLimit(testIP, undefined, 5, 60);
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
        await checkRateLimit(testIP, undefined, 3, 60);
      }
      const overLimit = await checkRateLimit(testIP, undefined, 3, 60);
      assert.equal(overLimit.allowed, false);
      assert.equal(overLimit.remaining, 0);
    });
  });
});
