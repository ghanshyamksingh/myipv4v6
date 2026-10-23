// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import sanity from '@sanity/astro';
import react from '@astrojs/react';

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
      projectId: process.env.PUBLIC_SANITY_PROJECT_ID || 'avfq9cch',
      dataset: process.env.PUBLIC_SANITY_DATASET || 'production',
      useCdn: false,
      apiVersion: '2025-10-01',
      studioBasePath: '/studio',
    }),
    react(),
  ],
});
