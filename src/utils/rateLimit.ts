import type { RateLimitResult } from '../types/ip';
import type { CloudflareKVNamespace } from '../env';

// In-memory fallback map for dev or when KV is not configured
// Bounded to prevent memory exhaustion in high-concurrency environments
const memoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const MAX_MEMORY_STORE_SIZE = 5000;

export const RATE_LIMIT_TIERS = {
  OWN_IP: { limit: 60, windowSeconds: 60 },
  ARBITRARY_LOOKUP: { limit: 30, windowSeconds: 60 },
  VISITOR: { limit: 60, windowSeconds: 60 },
  LOOKUP: { limit: 30, windowSeconds: 60 },
} as const;

function pruneMemoryStore(now: number): void {
  if (memoryRateLimitStore.size > MAX_MEMORY_STORE_SIZE) {
    for (const [key, val] of memoryRateLimitStore.entries()) {
      if (now >= val.resetAt) {
        memoryRateLimitStore.delete(key);
      }
    }
    // If still too large, drop oldest entries
    if (memoryRateLimitStore.size > MAX_MEMORY_STORE_SIZE) {
      const keysToDelete = Array.from(memoryRateLimitStore.keys()).slice(0, 1000);
      for (const k of keysToDelete) {
        memoryRateLimitStore.delete(k);
      }
    }
  }
}

/**
 * Edge rate limiter supporting tiered policies:
 * - Own IP / Homepage: 60 requests per 60-second window per client IP
 * - Arbitrary Target Lookups: 30 requests per 60-second window per client IP
 *
 * Concurrency & Eventual Consistency Note:
 * Cloudflare KV is an eventually consistent global distributed store.
 * Concurrent subrequests hitting different edge PoPs within milliseconds may
 * observe slight variance before counter updates propagate. This provides
 * ultra-fast, robust, best-effort edge throttling without incurring single-point
 * transactional database locks or latency penalties.
 */
export async function checkRateLimit(
  clientIP: string,
  kv?: CloudflareKVNamespace,
  maxRequests: number = 60,
  windowSeconds: number = 60,
  tier: string = 'visitor'
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowIndex = Math.floor(now / windowSeconds);
  const windowKey = `ratelimit:${tier}:${clientIP}:${windowIndex}`;
  const reset = (windowIndex + 1) * windowSeconds;

  if (kv) {
    try {
      const current = await kv.get(windowKey);
      const count = current ? parseInt(current, 10) : 0;
      const newCount = count + 1;

      if (count >= maxRequests) {
        return {
          allowed: false,
          limit: maxRequests,
          remaining: 0,
          reset,
        };
      }

      // Best-effort write with window expiration TTL
      await kv.put(windowKey, newCount.toString(), {
        expirationTtl: windowSeconds + 10,
      });

      return {
        allowed: true,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - newCount),
        reset,
      };
    } catch {
      // If KV fails or is temporarily unreachable, fallback gracefully to in-memory store
    }
  }

  // Fallback in-memory rate limiting
  pruneMemoryStore(now);
  const memoryKey = `${tier}:${clientIP}`;
  const existing = memoryRateLimitStore.get(memoryKey);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowSeconds;
    memoryRateLimitStore.set(memoryKey, { count: 1, resetAt });
    return {
      allowed: true,
      limit: maxRequests,
      remaining: maxRequests - 1,
      reset: resetAt,
    };
  }

  if (existing.count >= maxRequests) {
    return {
      allowed: false,
      limit: maxRequests,
      remaining: 0,
      reset: existing.resetAt,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - existing.count),
    reset: existing.resetAt,
  };
}

/**
 * Generates standardized X-RateLimit-* HTTP headers.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.reset.toString(),
  };
}
