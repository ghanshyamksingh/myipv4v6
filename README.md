# myipv4v6.com — Modern Edge IP Diagnostics & Network Intelligence

A full-featured, edge-first, SEO-optimized "What is my IP" and IP Lookup platform engineered for speed, privacy, and technical accuracy.

Built with **Astro 7**, **Tailwind CSS v4**, **Cloudflare Workers/Pages**, and **Sanity CMS**.

---

## Key Features

- **True Dual-Stack IPv4 & IPv6 Detection:** Instant Cloudflare edge detection via `CF-Connecting-IP` combined with client-side companion probing (`https://ipv4.icanhazip.com` / `https://ipv6.icanhazip.com`) so visitors see both addresses simultaneously when available.
- **Deep Network Diagnostics:** Autonomous System Numbers (ASN), ISP / Organization, BGP routing records, authoritative reverse DNS hostname resolution (via Cloudflare DoH 1.1.1.1), timezone, local time, and coordinates.
- **Embedded Visual Map:** Interactive OpenStreetMap preview centered on routing hub coordinates without third-party tracking cookies or Google Maps API keys.
- **One-Click Share & Developer Export:** Instant clipboard copy, native Web Share API, plus one-click export of lookup reports in JSON and Markdown formats.
- **Fast Dynamic Lookup (`/ip/[ip]`):** Query any public IPv4 or IPv6 address with multi-tier enrichment and Cloudflare KV 24-hour edge caching.
- **Client-Side Private Search History:** Recent lookups are saved exclusively in browser `localStorage` and never transmitted to our servers.
- **Developer-Friendly API (`/api/ip` & `/api/v1/ip`):** Returns JSON (`curl https://myipv4v6.com/api/ip`) or plain text (`curl -H "Accept: text/plain" https://myipv4v6.com/api/ip` or `?format=text`) with rate limiting and CORS support.
- **Strict Zero-Logging Architecture:** Processing runs exclusively in volatile edge RAM; the application does not log, store, track, or sell visitor IP addresses.
- **Security & Headers Hardening:** Strict Content Security Policy (CSP), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and anti-clickjacking headers via edge middleware.
- **Embedded Sanity CMS Studio (`/studio`):** Manage blog posts, static pages, FAQs, and SEO metadata directly from the integrated studio.
- **SEO & Structured Data:** Automatic XML sitemap, `robots.txt`, 1200x630 Open Graph / Twitter Card (`/og-default.png`), and JSON-LD schema markup (`WebApplication`, `FAQPage`, `BreadcrumbList`, `Article`).
- **Modern UI & Dark Mode:** Mobile-first Tailwind CSS v4 design with zero-FOUC persisted dark/light theme toggle.

---

## Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **Astro 7.4** | Hybrid edge web framework (Static prerendered pages + on-demand edge SSR) |
| **Cloudflare Adapter** | Edge SSR execution & Cloudflare KV caching (`@astrojs/cloudflare`) |
| **Tailwind CSS v4** | Next-generation CSS engine with `@tailwindcss/vite` |
| **Sanity CMS** | Headless content management & embedded Studio (`@sanity/astro`) |
| **TypeScript 6** | Strict type safety across network, DNS, and SEO modules |
| **Node.js Test Runner** | Zero-dependency native unit tests (`tests/ip.test.ts`) |

---

## Local Development vs Production

### Local Development
In local development (running `pnpm dev` or `astro dev`):
- `CF-Connecting-IP` is absent because requests originate from your local loopback.
- The system automatically falls back to Cloudflare's Anycast IP (`1.1.1.1`) so all UI cards, reverse DNS, geolocation, and diagnostic panels display full data without errors.
- KV operations automatically fall back to an in-memory bounded store with LRU eviction.

### Production (Cloudflare Edge)
In production:
- The system strictly trusts only the `CF-Connecting-IP` header set by Cloudflare's edge proxy; spoofable headers like `X-Forwarded-For` are ignored.
- KV bindings (`IP_CACHE`) cache enrichment responses for 24 hours.
- Ephemeral rate limits (60 req/min) are counted across edge memory / KV.

---

## Getting Started

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

3. **Run unit tests:**
   ```bash
   pnpm test
   ```

4. **Start the local dev server:**
   ```bash
   pnpm dev
   ```
   Or run in background mode:
   ```bash
   astro dev --background
   ```
   Open `http://localhost:4321` in your browser.

---

## Geolocation Providers Configuration

The application supports three geolocation providers via the `IP_PROVIDER` environment variable:

1. **`ipwhois` (Default):**
   - Free, HTTPS endpoint (`https://ipwho.is/`).
   - Requires no API token or registration.
   - Ideal for production and development.

2. **`ipinfo`:**
   - Queries `https://ipinfo.io/<ip>/json`.
   - Requires setting `IPINFO_TOKEN=your_token` in environment variables.

3. **`ip-api` (Pro):**
   - Queries `https://pro.ip-api.com/json/<ip>`.
   - Requires setting `IP_API_KEY=your_key` in environment variables.
   *(Note: The free tier of ip-api.com is plain HTTP only and is not used in production to ensure end-to-end TLS security).*

---

## Cloudflare KV Cache & Rate Limiting Setup

To enable persistent 24-hour edge caching and shared rate-limiting:

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

*(Note: If KV is not bound, the application automatically uses an in-memory LRU store with automatic eviction).*

---

## Developer API Documentation

### 1. Plain Text Visitor IP (for CLI / Scripts)
```bash
curl https://myipv4v6.com/api/ip
# or
curl https://myipv4v6.com/api/ip?format=text
```
Output:
```
157.35.51.11
```

### 2. Full JSON Visitor Intelligence
```bash
curl https://myipv4v6.com/api/ip
```
Response:
```json
{
  "api_version": "1.0",
  "ip": "1.1.1.1",
  "version": "IPv4",
  "isPrivate": false,
  "hostname": "one.one.one.one",
  "city": "San Jose",
  "region": "California",
  "regionCode": "CA",
  "country": "United States",
  "countryCode": "US",
  "postalCode": "95141",
  "latitude": 37.3382,
  "longitude": -121.8863,
  "timezone": "America/Los_Angeles",
  "asn": "AS13335",
  "asOrganization": "Cloudflare, Inc.",
  "isp": "Cloudflare, Inc.",
  "colo": "SJC",
  "httpProtocol": "HTTP/3",
  "tlsVersion": "TLSv1.3",
  "source": "ipwhois"
}
```

### 3. Query Specific Target IP
```bash
curl "https://myipv4v6.com/api/ip?q=2606:4700:4700::1111"
# or versioned endpoint
curl "https://myipv4v6.com/api/v1/ip?q=8.8.8.8"
```

### Rate Limiting & Headers
- Policy: **60 requests per 60-second window** per client IP.
- Headers returned on all responses:
  - `X-RateLimit-Limit: 60`
  - `X-RateLimit-Remaining: 59`
  - `X-RateLimit-Reset: 1729674000`
  - `Access-Control-Allow-Origin: *`
- Over-limit status: `429 Too Many Requests` with `Retry-After: 60`.

---

## Sanity CMS Studio

The embedded Sanity Studio is accessible at:
```
http://localhost:4321/studio
```
(and in production at `https://myipv4v6.com/studio`).

Available Schemas in `/src/sanity/schemaTypes`:
- **Post:** Technical blog articles with author, date, and read time.
- **Page:** Static pages with rich portable text.
- **FAQ:** Categorized frequently asked questions.
- **SEO:** Reusable metadata object (meta title, description, canonical, OG image, noindex).

---

## Quality Checks & Production Build

```bash
# Run unit tests
pnpm test

# Type check Astro and TypeScript files
pnpm astro check

# Build production bundle
pnpm build
```

### Production Deployment (Cloudflare Workers)

This application utilizes Astro SSR on Cloudflare with Worker edge entrypoints. Deploy using **Cloudflare Workers**:

```bash
# Recommended deploy command:
pnpm build && npx wrangler deploy

# Or via npm script:
pnpm deploy
```

> [!IMPORTANT]
> **Do NOT use `wrangler pages deploy dist`**: Deploying static `dist` to Cloudflare Pages bypasses the SSR server entrypoint and causes HTTP 404 errors on dynamic routes (`/`, `/ip/[ip]`, `/api/ip`). Always use `wrangler deploy` (Cloudflare Workers).

### Custom Domain vs Worker URL
- **Production Custom Domain:** `https://www.myipv4v6.com` and `https://myipv4v6.com` (configured in Cloudflare Dashboard under Worker > Settings > Triggers / Custom Domains).
- **Worker Subdomain:** `https://myipv4v6.<your-subdomain>.workers.dev` (useful for direct testing and health checks).

See [LAUNCH.md](./LAUNCH.md) for the complete pre-flight checklist.
