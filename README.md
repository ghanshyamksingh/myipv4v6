# myipv4v6.com — Modern Edge IP Diagnostics & Network Intelligence

A full-featured, edge-first, SEO-optimized "What is my IP" and IP Lookup platform designed for speed, privacy, and technical accuracy.

Built with **Astro 7**, **Tailwind CSS v4**, **Cloudflare Workers/Pages**, and **Sanity CMS**.

---

## Key Features

- **Instant Dual-Stack Detection:** Cloudflare edge detection via `CF-Connecting-IP` and `request.cf` for immediate IPv4 and IPv6 identification.
- **Deep Network Diagnostics:** Autonomous System Numbers (ASN), ISP / Organization, BGP routing, reverse DNS hostname, timezone, local time, and GPS coordinates.
- **Fast Dynamic Lookup (`/ip/[ip]`):** Search any IPv4 or IPv6 address with multi-tier enrichment and Cloudflare KV 24-hour edge caching.
- **Developer-Friendly API (`/api/ip`):** Returns JSON or plain text (`curl myipv4v6.com/api/ip`) with rate limiting and CORS support.
- **Zero-Logging Privacy:** IP processing runs exclusively in volatile edge RAM; no visitor IPs are stored or tracked.
- **Embedded Sanity CMS Studio (`/studio`):** Manage blog posts, static pages, FAQs, and SEO metadata directly from the integrated studio.
- **SEO & Structured Data:** Automatic XML sitemap, `robots.txt`, Open Graph / Twitter Cards, and schema markup (`WebApplication`, `FAQPage`, `BreadcrumbList`, `Article`).
- **Modern UI & Dark Mode:** Mobile-first Tailwind CSS v4 design with zero-FOUC persisted dark/light theme toggle.

---

## Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **Astro 7.4** | Hybrid edge web framework |
| **Cloudflare Adapter** | Edge SSR execution & Cloudflare KV caching |
| **Tailwind CSS v4** | Next-gen CSS engine with `@tailwindcss/vite` |
| **Sanity CMS** | Headless content management & embedded Studio |
| **TypeScript 6** | Strict type safety across network & SEO modules |

---

## Local Development

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Start the local dev server:**
   ```bash
   pnpm dev
   ```
   Or run in background mode:
   ```bash
   astro dev --background
   ```
   Open `http://localhost:4321` in your browser.

---

## Cloudflare KV Cache Setup

To enable persistent 24-hour edge caching for IP lookups:

1. **Create the KV Namespace using Wrangler:**
   ```bash
   npx wrangler kv namespace create IP_CACHE
   ```

2. **Update `wrangler.jsonc`:**
   Paste the returned `id` into `wrangler.jsonc`:
   ```jsonc
   "kv_namespaces": [
     {
       "binding": "IP_CACHE",
       "id": "<YOUR_KV_NAMESPACE_ID>"
     }
   ]
   ```

*(Note: If the KV namespace is not yet bound, the application automatically uses an in-memory fallback cache so the site continues working without errors).*

---

## Sanity CMS Studio

The embedded Sanity Studio is accessible at:
```
http://localhost:4321/studio
```
(and in production at `https://myipv4v6.com/studio`).

Schemas available in `/src/sanity/schemaTypes`:
- **Post:** Technical blog articles with author, publication date, and SEO tags.
- **Page:** Static content pages with markdown/portable text.
- **FAQ:** Categorized frequently asked questions rendered on homepage and tools.
- **SEO:** Reusable metadata object (meta title, description, canonical URL, OG image, noindex).

---

## Public API Usage

Fetch visitor's IP in plain text:
```bash
curl https://myipv4v6.com/api/ip
```

Query specific IP details in JSON:
```bash
curl "https://myipv4v6.com/api/ip?q=8.8.8.8"
```

Rate limiting: 60 requests per minute per IP address.

---

## Production Build & Verification

```bash
# Type check Astro and TypeScript files
pnpm astro check

# Build static assets & Cloudflare server bundle
pnpm build
```

Deploy to Cloudflare Pages or Workers:
```bash
npx wrangler pages deploy dist
```
