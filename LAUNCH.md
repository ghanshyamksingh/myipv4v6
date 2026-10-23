# Production Launch Checklist: myipv4v6.com

This document serves as the master deployment and operational launch checklist for releasing **myipv4v6.com** to production on Cloudflare Workers / Pages.

---

## 1. Cloudflare Infrastructure & KV Cache Setup

- [ ] **Create Cloudflare KV Namespace:**
  Run the Wrangler command in your deployment terminal:
  ```bash
  npx wrangler kv namespace create IP_CACHE
  ```
- [ ] **Bind KV in `wrangler.jsonc`:**
  Replace the placeholder id `"myipv4v6_ip_cache"` with your generated Cloudflare KV Namespace ID:
  ```jsonc
  "kv_namespaces": [
    {
      "binding": "IP_CACHE",
      "id": "<YOUR_ACTUAL_KV_ID>"
    }
  ]
  ```
- [ ] **Verify Dual Role of `IP_CACHE`:**
  - 24-hour edge enrichment caching for queried IP addresses (`ip_details:<ip>`).
  - Sliding-window ephemeral rate-limiting counters (`rate_limit:<ip>:<timestamp_minute>`).
  - Safe automatic in-memory fallback enabled if KV is unavailable.

---

## 2. Environment Variables & Secrets in Cloudflare

Set the following environment variables in the Cloudflare Dashboard (**Workers & Pages > Settings > Variables and Secrets**) or via Wrangler:

| Variable | Type | Recommended Value / Notes |
| :--- | :--- | :--- |
| `PUBLIC_SITE_URL` | Plaintext | `https://myipv4v6.com` |
| `IP_PROVIDER` | Plaintext | `ipwhois` *(Default free HTTPS, no token required)* |
| `PUBLIC_SANITY_PROJECT_ID` | Plaintext | Required in production (from manage.sanity.io; builds fail-closed if omitted) |
| `PUBLIC_SANITY_DATASET` | Plaintext | `production` |
| `IPINFO_TOKEN` | Secret *(Optional)* | Required only if `IP_PROVIDER=ipinfo` |
| `IP_API_KEY` | Secret *(Optional)* | Required only if `IP_PROVIDER=ip-api` (uses pro.ip-api.com HTTPS) |

```bash
# Example adding secret via Wrangler:
npx wrangler secret put IPINFO_TOKEN
```

---

## 3. Sanity CMS Studio Security & Access Lockdown

- [ ] **Dashboard Access Control:**
  Log in to [https://manage.sanity.io](https://manage.sanity.io), navigate to your project, and verify:
  - Project members are limited to authorized team administrators.
  - Project is not set to public read-write.
- [ ] **CORS Origins Configuration:**
  In **Project Settings > API > CORS Origins**:
  - Add `https://myipv4v6.com` (with Credentials enabled if studio authentication is used).
  - Add `http://localhost:4321` for local development.
- [ ] **Sitemap & Robots Verification:**
  - Verify `/studio` is excluded from the generated sitemap (`@astrojs/sitemap` filter active).
  - Verify `robots.txt` has `Disallow: /studio/`.
  - Verify CSP in `src/middleware.ts` enables `frame-ancestors 'self'` and allows necessary Sanity domains only on `/studio`.

---

## 4. Custom Domain & DNS Routing

- [ ] **Add Custom Domain in Cloudflare:**
  - Link `myipv4v6.com` to the Cloudflare Pages/Workers deployment.
- [ ] **Canonical Apex & WWW Redirection:**
  - Create a Cloudflare Page Rule or Redirect Rule to 301 redirect `www.myipv4v6.com` to `https://myipv4v6.com`.
- [ ] **SSL / TLS Configuration:**
  - Set SSL/TLS Encryption mode to **Full (Strict)**.
  - Enable **Always Use HTTPS** and **Minimum TLS Version 1.3** (or 1.2).
  - Enable **HTTP/3 (with QUIC)** and **0-RTT Connection Resumption**.
- [ ] **IPv6 Compatibility:**
  - Ensure Cloudflare IPv6 Compatibility is toggled **ON** in Cloudflare Network settings.

- [ ] **Deploy to Cloudflare Workers:**
  Build and deploy using Wrangler:
  ```bash
  pnpm build && npx wrangler deploy
  ```
  *(Important: Do NOT deploy via `wrangler pages deploy dist` as Pages static hosting bypasses the server entrypoint and produces 404 errors on SSR routes).*

- [ ] **Verify Worker Subdomain & Custom Domain:**
  - Worker URL: `https://myipv4v6.<your-subdomain>.workers.dev`
  - Custom Domain: `https://www.myipv4v6.com` and `https://myipv4v6.com`
  - In Cloudflare Dashboard, verify Custom Domains is attached to the `myipv4v6` Worker under **Worker > Settings > Domains & Routes**.

---

## 5. Security & Rate Limiting Hardening

- [ ] **Strict Client IP Trust:**
  - In production behind Cloudflare, `src/utils/ip.ts` trusts exclusively `CF-Connecting-IP`. Spoofed headers like `X-Forwarded-For` are ignored.
- [ ] **Tiered Rate Limits Verified:**
  - Visitor own IP: 60 requests per 60-second window (`/` and `/api/ip`).
  - Arbitrary target lookups: Stricter 30 requests per 60-second window (`/ip/[ip]` and `/api/ip?q=<ip>`).
  - Proper `X-RateLimit-*` and `Retry-After: 60` headers returned upon 429 status.
- [ ] **Content Security Policy (CSP):**
  - Verify CSP headers on public pages: blocks unauthorized frame embedding (`frame-ancestors 'none'`), disallows untrusted scripts, and whitelists OpenStreetMap and icanhazip.

---

## 6. Privacy & Legal Compliance

- [ ] **Edge Privacy Verification:**
  - Verify visitor IP processing occurs exclusively in volatile RAM memory at the edge node.
  - Enrichment results (including the looked-up IP) are cached for up to 24 hours in Cloudflare KV solely for performance, with no link to user identities.
  - Structured application logs redact visitor IPs (`xxx.xxx.xxx.xxx` / `xxxx:xxxx:...`).
  - Recent search history is stored exclusively in client-side browser `localStorage`.
- [ ] **Review Privacy Policy:**
  - Verify `/privacy` accurately reflects edge RAM processing, Cloudflare reverse proxy transparency, and third-party lookup providers (`ipwho.is` default, `ipinfo.io`, `pro.ip-api.com`).
- [ ] **Review Terms of Service:**
  - Verify `/terms` acceptable use policy, API rate limit guidelines, and disclaimer of warranty.

---

## 7. Search Console & Search Engine Indexing

- [ ] **Google Search Console:**
  - Add property `https://myipv4v6.com`.
  - Submit sitemap index: `https://myipv4v6.com/sitemap-index.xml`.
- [ ] **Bing Webmaster Tools:**
  - Import property from Google Search Console.
  - Verify sitemap indexing.
- [ ] **Social Media Preview Check:**
  - Test `https://myipv4v6.com` with Twitter Card Validator and Facebook Sharing Debugger.
  - Verify `og:image` resolves to `https://myipv4v6.com/og-default.png` (1200x630).

---

## 8. Uptime & Performance Monitoring

- [ ] **Synthetic Uptime Monitoring:**
  Set up health checks (e.g. Better Uptime, Cloudflare Health Checks, or Pingdom):
  - Primary endpoint: `GET https://myipv4v6.com/` (expects 200 OK, HTML).
  - API endpoint: `GET https://myipv4v6.com/api/ip` (expects 200 OK, JSON containing `ip`, `version`, `api_version`).
  - Text API endpoint: `GET https://myipv4v6.com/api/ip?format=text` (expects 200 OK, plain text IP).
- [ ] **Cloudflare Analytics & Observability:**
  - Enable Cloudflare Workers Observability to monitor invocation counts, CPU time, and error rates.
