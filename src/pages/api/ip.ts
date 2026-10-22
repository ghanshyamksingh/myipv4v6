export const prerender = false;

import type { APIRoute } from 'astro';
import { cleanIP, getClientIP, isValidIP } from '../../utils/ip';
import { enrichIP } from '../../utils/enrichment';
import { checkRateLimit } from '../../utils/rateLimit';
import { getCloudflareEnv, getCloudflareGeo } from '../../utils/cloudflare';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const queryParam = url.searchParams.get('q') || url.searchParams.get('ip');
  const format = url.searchParams.get('format') || '';
  const acceptHeader = request.headers.get('accept') || '';

  const clientIP = getClientIP(request);
  const targetIP = queryParam ? cleanIP(queryParam) : clientIP;

  const cfEnv = await getCloudflareEnv();
  const kv = cfEnv.IP_CACHE;
  const cfData = getCloudflareGeo(request);
  const provider = (cfEnv.IP_PROVIDER as any) || 'ip-api';
  const ipinfoToken = cfEnv.IPINFO_TOKEN;

  // Rate Limiting (60 requests per minute)
  const rateLimit = await checkRateLimit(clientIP, kv, 60, 60);

  const rateLimitHeaders = {
    'X-RateLimit-Limit': rateLimit.limit.toString(),
    'X-RateLimit-Remaining': rateLimit.remaining.toString(),
    'X-RateLimit-Reset': rateLimit.reset.toString(),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Try again in 60 seconds.',
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '60',
          ...rateLimitHeaders,
        },
      }
    );
  }

  // If plain text requested (e.g. curl or ?format=text) and no specific details query
  const wantsPlainText =
    format === 'text' ||
    format === 'plain' ||
    (acceptHeader.includes('text/plain') && !acceptHeader.includes('text/html') && !queryParam);

  if (wantsPlainText) {
    return new Response(`${targetIP}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        ...rateLimitHeaders,
      },
    });
  }

  // Validate IP
  if (!isValidIP(targetIP)) {
    return new Response(
      JSON.stringify({
        error: 'Invalid IP',
        message: `"${targetIP}" is not a valid IPv4 or IPv6 address.`,
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...rateLimitHeaders,
        },
      }
    );
  }

  // Enrich IP
  const details = await enrichIP(targetIP, {
    cfData,
    isVisitor: !queryParam,
    kv,
    providerConfig: {
      provider,
      ipinfoToken,
    },
    userAgent: request.headers.get('user-agent') || undefined,
  });

  return new Response(JSON.stringify(details, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
      ...rateLimitHeaders,
    },
  });
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
};
