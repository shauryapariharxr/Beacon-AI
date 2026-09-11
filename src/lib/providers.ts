// Multi-provider AI pool with round-robin rotation + rate-limit cooldown.
//
// Configure in .env.local:
//   GROQ_API_KEY=gsk_...        (Groq — primary)
//   GROQ_API_KEY_2=gsk_...      (optional extra Groq keys, up to _5)
//   GROQ_API_KEYS=gsk_...,gsk_...  (or a comma-separated Groq list)
//   MISTRAL_API_KEY=...         (Mistral — used alternately / as fallback)
//
// All configured (provider, key) pairs rotate round-robin so a single
// provider's rate limit doesn't stall chat under load. When one returns 429,
// it goes on a short cooldown and the request retries on the next provider.
// Every provider here speaks the OpenAI chat-completions wire format, so
// request building and SSE parsing are shared.

import type { ModelKey } from "./models";

const RATE_LIMIT_COOLDOWN_MS = 60_000;

type ProviderDef = {
  name: string;
  baseUrl: string;
  models: Record<ModelKey, string>;
  collectKeys: () => string[];
};

const PROVIDERS: ProviderDef[] = [
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: {
      flash: "openai/gpt-oss-20b",
      smart: "openai/gpt-oss-120b",
      coder: "openai/gpt-oss-120b",
    },
    collectKeys: () => {
      const raw: string[] = [];
      const list = process.env.GROQ_API_KEYS;
      if (list) raw.push(...list.split(","));
      if (process.env.GROQ_API_KEY) raw.push(process.env.GROQ_API_KEY);
      for (let i = 2; i <= 5; i++) {
        const k = process.env[`GROQ_API_KEY_${i}`];
        if (k) raw.push(k);
      }
      return raw;
    },
  },
  {
    name: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    models: {
      flash: "mistral-small-latest",
      // mistral-large-latest is NOT in the free/self-serve tier — medium is
      // the strongest chat model available there.
      smart: "mistral-medium-latest",
      coder: "codestral-latest",
    },
    collectKeys: () => (process.env.MISTRAL_API_KEY ? [process.env.MISTRAL_API_KEY] : []),
  },
];

type Instance = {
  provider: ProviderDef;
  apiKey: string;
  // Epoch ms until which this instance is skipped (set after a 429). 0 = healthy.
  cooldownUntil: number;
};

const instances: Instance[] = PROVIDERS.flatMap((provider) =>
  [...new Set(provider.collectKeys().map((k) => k.trim()).filter(Boolean))].map((apiKey) => ({
    provider,
    apiKey,
    cooldownUntil: 0,
  }))
);

// Round-robin pointer so load spreads evenly across healthy instances.
let rr = 0;

export function hasProviders(): boolean {
  return instances.length > 0;
}

export function providerCount(): number {
  return instances.length;
}

export type ProviderAttempt = {
  providerName: string;
  url: string;
  model: string;
  apiKey: string;
};

/**
 * Next provider instance to try, round-robin across healthy ones. If every
 * instance is in a 429 cooldown, returns the one whose cooldown expires
 * first — rate limits are per-window, so it may have recovered by the time
 * we call it.
 */
export function nextProviderAttempt(modelKey: ModelKey): ProviderAttempt {
  if (instances.length === 0) {
    throw new Error("No AI provider keys configured");
  }

  const now = Date.now();
  let picked = instances[rr];
  let pickedIdx = rr;

  for (let i = 0; i < instances.length; i++) {
    const idx = (rr + i) % instances.length;
    const inst = instances[idx];
    if (inst.cooldownUntil <= now) {
      picked = inst;
      pickedIdx = idx;
      break;
    }
    if (inst.cooldownUntil < picked.cooldownUntil) {
      picked = inst;
      pickedIdx = idx;
    }
  }

  rr = (pickedIdx + 1) % instances.length;

  return {
    providerName: picked.provider.name,
    url: `${picked.provider.baseUrl}/chat/completions`,
    model: picked.provider.models[modelKey],
    apiKey: picked.apiKey,
  };
}

/** Put an instance on cooldown after it returned a rate-limit (429). */
export function markProviderRateLimited(attempt: ProviderAttempt) {
  markProviderUnavailable(attempt, RATE_LIMIT_COOLDOWN_MS);
}

/**
 * Put an instance on cooldown for a given duration. Used for 429s (short —
 * the window resets) and for hard model errors like 403 tier_not_allowed /
 * 404 model-not-found (long — it won't self-heal, so stop hammering it).
 */
export function markProviderUnavailable(attempt: ProviderAttempt, durationMs: number) {
  const inst = instances.find(
    (i) => i.provider.name === attempt.providerName && i.apiKey === attempt.apiKey
  );
  if (inst) inst.cooldownUntil = Date.now() + durationMs;
}
