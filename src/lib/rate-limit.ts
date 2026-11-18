export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string, now?: number) => RateLimitResult;
  size: () => number;
};

/**
 * Small fixed-window limiter. State lives in memory, so on Cloudflare Workers it
 * is per isolate: it raises the cost of abuse without pretending to be a global
 * quota. Keys are evicted oldest-first once the map reaches `maxKeys`.
 */
export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? 5000));
  const hits = new Map<string, { count: number; resetAt: number }>();

  const evict = (now: number) => {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    while (hits.size >= maxKeys) {
      const oldest = hits.keys().next();
      if (oldest.done) break;
      hits.delete(oldest.value);
    }
  };

  return {
    check(key: string, now = Date.now()): RateLimitResult {
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        if (hits.size >= maxKeys) evict(now);
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }
      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      entry.count += 1;
      return { allowed: true, remaining: limit - entry.count, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
  };
}
