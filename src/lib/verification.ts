// Verification tokens: single-use, 24h expiry. Stored in Upstash Redis when
// configured; otherwise an in-memory Map keeps local dev working with zero
// setup (tokens obviously don't survive a serverless recycle — fine for dev).

import { Redis } from "@upstash/redis";
import { createHash } from "crypto";

const TTL_SECONDS = 24 * 60 * 60;

function redis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// Never store raw tokens — a DB/Redis leak shouldn't yield usable links.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function memoryKey(token: string): string {
  return `verify:${hashToken(token)}`;
}

export async function storeVerificationToken(userId: string, token: string): Promise<void> {
  const key = memoryKey(token);
  const r = redis();
  if (r) {
    await r.set(key, userId, { ex: TTL_SECONDS });
  } else {
    globalThis.__beaconMemVerify?.set(key, { userId, expires: Date.now() + TTL_SECONDS * 1000 });
  }
}

/** Consume a token: returns the userId if valid, else null. Single-use. */
export async function consumeVerificationToken(token: string): Promise<string | null> {
  const key = memoryKey(token);
  const r = redis();

  if (r) {
    const userId = await r.get<string>(key);
    if (!userId) return null;
    await r.del(key); // single-use
    return userId;
  }

  const mem = globalThis.__beaconMemVerify ?? (globalThis.__beaconMemVerify = new Map());
  const entry = mem.get(key) as { userId: string; expires: number } | undefined;
  if (!entry) return null;
  mem.delete(key);
  if (Date.now() > entry.expires) return null;
  return entry.userId;
}

// Ambient type for the in-memory fallback.
declare global {
  // eslint-disable-next-line no-var
  var __beaconMemVerify: Map<string, { userId: string; expires: number }> | undefined;
}
