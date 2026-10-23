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
