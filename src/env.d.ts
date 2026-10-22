/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="@sanity/astro/module" />

export interface CloudflareKVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream'; cacheTtl?: number }): Promise<any>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expiration?: number; expirationTtl?: number; metadata?: any }): Promise<void>;
  delete(key: string): Promise<void>;
}

declare module 'cloudflare:workers' {
  export const env: {
    IP_CACHE?: CloudflareKVNamespace;
    IPINFO_TOKEN?: string;
    IP_PROVIDER?: string;
    PUBLIC_SITE_URL?: string;
    PUBLIC_SANITY_PROJECT_ID?: string;
    PUBLIC_SANITY_DATASET?: string;
    [key: string]: any;
  };
}

declare global {
  namespace App {
    interface Locals {
      cfContext?: any;
    }
  }
}
