import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const pathname = context.url.pathname;
  const isStudio = pathname.startsWith('/studio');

  // Universal baseline security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
  );
  response.headers.set('X-XSS-Protection', '1; mode=block');

  if (isStudio) {
    // Sanity Studio requires styled-components, auth connections to sanity.io, and same-origin framing
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.sanity.io",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob: https://cdn.sanity.io https://*.sanity.io",
        "connect-src 'self' https://*.sanity.io https://*.sanity.cdn.net https://api.sanity.io wss://*.sanity.io",
        "frame-src 'self' https://*.sanity.io",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
  } else {
    // Hardened CSP for public pages and tools
    //
    // Note on 'unsafe-inline' for script-src & style-src:
    // Astro v7 statically renders islands and inlines critical anti-FOUC theme detection
    // scripts in <head> (e.g. reading localStorage before DOM paint) alongside inlined Tailwind v4
    // stylesheet blocks. Dynamic per-request nonces cannot be injected across prerendered static
    // pages or without extensive streaming HTML rewrites in Cloudflare Workers.
    //
    // Mitigating Controls:
    // 1. 'frame-ancestors none' and 'X-Frame-Options: DENY' prevent clickjacking.
    // 2. Strict 'connect-src' restricts all client fetch/XHR traffic strictly to trusted endpoints
    //    (own origin, Cloudflare DoH, icanhazip, and verified geolocation APIs), mitigating XSS exfiltration.
    // 3. User input in IP search parameters is strictly validated with isValidIP / cleanIP before rendering.
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self' data:",
        "img-src 'self' data: blob: https://*.openstreetmap.org https://cdn.ipwhois.io",
        "connect-src 'self' https://cloudflare-dns.com https://ipwho.is https://ipinfo.io https://pro.ip-api.com https://ipv4.icanhazip.com https://ipv6.icanhazip.com",
        "frame-src 'self' https://www.openstreetmap.org",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
    );
  }

  return response;
});
