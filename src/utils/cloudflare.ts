import type { CloudflareGeoData } from '../types/ip';
import type { CloudflareKVNamespace } from '../env';

/**
 * Safely extracts Cloudflare geolocation data from the incoming Request.
 * Uses `request.cf` directly without accessing deprecated `Astro.locals.runtime`.
 */
export function getCloudflareGeo(request: Request): CloudflareGeoData | undefined {
  try {
    return (request as any).cf;
  } catch {
    return undefined;
  }
}

export interface CloudflareEnvBindings {
  IP_CACHE?: CloudflareKVNamespace;
  IP_PROVIDER?: string;
  IPINFO_TOKEN?: string;
  [key: string]: any;
}

/**
 * Safely retrieves Cloudflare environment bindings and variables.
 * Uses lazy import for 'cloudflare:workers' with a safe fallback to process.env
 * during local Vite development or prerendering.
 */
export async function getCloudflareEnv(): Promise<CloudflareEnvBindings> {
  try {
    // @ts-ignore - 'cloudflare:workers' is a virtual module provided in Cloudflare workerd runtime
    const { env } = await import('cloudflare:workers');
    if (env) return env as CloudflareEnvBindings;
  } catch {
    // In local Node / Vite development, cloudflare:workers is not available
  }

  return {
    IP_CACHE: undefined,
    IP_PROVIDER: process.env.IP_PROVIDER || 'ip-api',
    IPINFO_TOKEN: process.env.IPINFO_TOKEN,
    PUBLIC_SANITY_PROJECT_ID: process.env.PUBLIC_SANITY_PROJECT_ID,
    PUBLIC_SANITY_DATASET: process.env.PUBLIC_SANITY_DATASET,
    PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
  };
}
