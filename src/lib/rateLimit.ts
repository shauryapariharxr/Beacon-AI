// Sliding-window rate limiter.
//
// Production (recommended): set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// and limits are shared across ALL serverless instances via Upstash Redis.
// Local dev / fallback: with no Upstash env vars, an in-memory window is
// used per instance — zero setup, adequate for development.

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// One Ratelimit instance per (limit, windowSeconds) combo, created lazily.
// The Upstash SDK fixes the window at construction time, so distinct
// limit/window pairs each get their own instance (and Redis prefix).
const upstashInstances = new Map<string, Ratelimit>();

function getUpstash(limit: number, windowSeconds: number): Ratelimit | null {
  const key = `${limit}:${windowSeconds}`;
  const existing = upstashInstances.get(key);
  if (existing) return existing;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const rl = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: `beacon:rl:${key}`,
    // Don't pay a cross-region round-trip for analytics we don't use.
    analytics: false,
  });
  upstashInstances.set(key, rl);
  return rl;
}

// In-memory fallback buckets.
type Window = { timestamps: number[] };
const buckets = new Map<string, Window>();
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

export type RateLimitResult = {
  ok: boolean;
  // Seconds until the request would be allowed again (only when !ok).
  retryAfterSeconds: number;
};

/**
 * Allow at most `limit` requests per key within the last `windowMs`.
 * If Redis errors, the in-memory limiter takes over for that call.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  const rl = getUpstash(limit, windowSeconds);

  if (rl) {
    try {
      const { success, reset } = await rl.limit(key);
      return {
        ok: success,
        retryAfterSeconds: success ? 0 : Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
      };
    } catch (err) {
      console.error("Upstash rate limit failed, falling back to memory:", err);
    }
  }

  // ---- in-memory fallback ----
  const now = Date.now();

  if (now - lastSweep > SWEEP_INTERVAL_MS) {
    lastSweep = now;
    for (const [k, w] of buckets) {
      if (w.timestamps.every((t) => now - t > windowMs)) buckets.delete(k);
    }
  }

  let window = buckets.get(key);
  if (!window) {
    window = { timestamps: [] };
    buckets.set(key, window);
  }

  window.timestamps = window.timestamps.filter((t) => now - t < windowMs);

  if (window.timestamps.length >= limit) {
    const oldest = window.timestamps[0];
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  window.timestamps.push(now);
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client identity for rate limiting: the authenticated user id
 * when signed in, else the caller's IP from proxy headers.
 */
export function clientKey(req: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return `ip:${fwd}`;
}
