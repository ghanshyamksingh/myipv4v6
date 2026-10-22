import type { RateLimitResult } from '../types/ip';
import type { CloudflareKVNamespace } from '../env';

// In-memory fallback map for dev or when KV is not configured
const memoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Edge rate limiter with 60 requests per 60-second window.
 */
export async function checkRateLimit(
  clientIP: string,
  kv?: CloudflareKVNamespace,
  maxRequests: number = 60,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `ratelimit:${clientIP}:${Math.floor(now / windowSeconds)}`;

  if (kv) {
    try {
      const current = await kv.get(windowKey);
      const count = current ? parseInt(current, 10) : 0;
      const newCount = count + 1;
      const reset = Math.floor(now / windowSeconds) * windowSeconds + windowSeconds;

      if (count >= maxRequests) {
        return {
          allowed: false,
          limit: maxRequests,
          remaining: 0,
          reset,
        };
      }

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
      // If KV fails or is unavailable, fallback to memory store
    }
  }

  // Fallback in-memory rate limiting
  const existing = memoryRateLimitStore.get(clientIP);
  if (!existing || now >= existing.resetAt) {
    const resetAt = now + windowSeconds;
    memoryRateLimitStore.set(clientIP, { count: 1, resetAt });
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
    remaining: maxRequests - existing.count,
    reset: existing.resetAt,
  };
}
