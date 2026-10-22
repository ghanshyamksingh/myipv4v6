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

  vite: {
    plugins: [tailwindcss()],
  },

  adapter: cloudflare(),

  integrations: [
    sitemap(),
    sanity({
      projectId: 'PASTE_YOUR_PROJECT_ID_HERE', // ← put your real Project ID
      dataset: 'production',
      useCdn: false,
      apiVersion: '2025-10-01',
    }),
    react(),
  ],
});