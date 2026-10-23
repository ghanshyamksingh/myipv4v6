// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import sanity from '@sanity/astro';
import react from '@astrojs/react';

// Load local .env into process.env if available (Node 20.6+)
try {
  process.loadEnvFile?.();
} catch {}

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
const sanityProjectId = process.env.PUBLIC_SANITY_PROJECT_ID;

// In production builds, require PUBLIC_SANITY_PROJECT_ID to prevent deploying unauthenticated builds
if (!sanityProjectId && !isDev) {
  throw new Error(
    '[FATAL CONFIG ERROR] PUBLIC_SANITY_PROJECT_ID environment variable is required for production builds. Please set PUBLIC_SANITY_PROJECT_ID in your Cloudflare Dashboard or deployment environment.'
  );
}

// Development-only safe placeholder if unset locally
const resolvedSanityProjectId = sanityProjectId || 'dev-sandbox-id';

// https://astro.build/config
export default defineConfig({
  site: 'https://myipv4v6.com',
  output: 'server',

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),

  integrations: [
    sitemap({
      filter: (page) => !page.includes('/api/') && !page.includes('/studio'),
    }),
    sanity({
      projectId: resolvedSanityProjectId,
      dataset: process.env.PUBLIC_SANITY_DATASET || 'production',
      useCdn: false,
      apiVersion: '2025-10-01',
      studioBasePath: '/studio',
    }),
    react(),
  ],
});
