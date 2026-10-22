import type { APIRoute } from 'astro';

const robotsTxt = `
User-agent: *
Allow: /
Disallow: /api/
Disallow: /studio/

Sitemap: https://myipv4v6.com/sitemap-index.xml
`.trim();

export const GET: APIRoute = async () => {
  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
