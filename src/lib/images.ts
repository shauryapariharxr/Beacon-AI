// Image generation: Gemini (paid quality) with a free fallback provider.
//
// Primary: a Pollen key (enter.pollinations.ai) — unlimited, logo-free
// generation through the OpenAI-compatible endpoint.
// Second: Gemini API "Nano Banana" models — used automatically when billing
// is enabled on the key. Free-tier Gemini keys have ZERO image-generation
// quota (every image model 429s with limit: 0).
// Last: the anonymous classic Pollinations route — keyless, genuinely free
// Flux-based generation, 1 image per 45s per IP.
//
// Configure in .env.local:
//   POLLINATIONS_API_KEY=sk_...         (get one: enter.pollinations.ai)
//   GEMINI_API_KEY=AIza...              (unlocks Nano Banana once billing is on)
//   GEMINI_IMAGE_MODEL=...              (optional model override)
//
// Model note (Nov 2026): `gemini-2.5-flash-image` is the cheapest current
// Nano Banana; newer models exist but change fast — override without code.

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Gemini image gen takes 5–25s; Pollinations queues can run longer. Cap the
// hold so a dead upstream can't pin a serverless invocation.
const GEMINI_TIMEOUT_MS = 90_000;
const POLLINATIONS_TIMEOUT_MS = 120_000;
// Generated images are ~1–3 MB base64. Refuse absurd payloads rather than
// writing gigabytes into Postgres on a prompt that confused the model.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REF_BYTES = 6 * 1024 * 1024; // per attachment
const MAX_REF_COUNT = 3;

export function hasImageProvider(): boolean {
  // Pollinations needs no key, so image generation is always available.
  return true;
}

/**
 * Does the user's message ask for an image to be *made*?
 *
 * Only an explicit creation verb paired with a visual noun triggers the
 * image model; generic chat that merely mentions "image" stays with the
 * regular text providers.
 */
const CREATION_VERB =
  /\b(draw|draws|drawing|generate|creates?|make|makes?|making|paint|paints?|painting|design|renders?|imagine|imagines?|sketch|sketches?|illustrate|illustration|show)\b/i;
const VISUAL_NOUN =
  /\b(image|images|illustration|illustrations|picture|pictures|pic|pics|photo|photos|photograph|artwork|poster|posters|logo|wallpaper|painting|sketch|sketche?s?|icon|icons|banner|stickers?|chart|diagram|drawing|art|portrait|scene|comic|cartoon|clipart|thumbnail|flyer|invitation)\b/i;

export function isImageGenRequest(message: string): boolean {
  // "how to draw", "what is image processing" style questions shouldn't
  // route to the image model — require a creation-ish pairing, not just a
  // visual noun.
  if (message.length > 500) return false;
  const brackets = message.match(/\[(.*?)\]/)?.[1]; // "[draw a cat]" front
  const probe = brackets || message;

  // Negative: questions about drawing/what things are stay in text mode.
  if (/\bhow (do|to|can) (i|we|you|one)\b.*\b(draw|paint|design|make)\b/i.test(probe)) return false;
  if (/\b(what|whats|what's|tell me)\b.*\b(image|picture|logo|poster)\b/i.test(probe) && !CREATION_VERB.test(probe)) {
    return false;
  }
  return CREATION_VERB.test(probe) && VISUAL_NOUN.test(probe);
}

export type GeneratedImage = {
  mimeType: string;
  base64: string;
  text?: string; // any text parts Gemini sent alongside the image
};

/** A validated user-provided reference image for image-to-image editing. */
export type RefImage = {
  mimeType: string;
  base64: string;
};

const ALLOWED_REF_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Parse and strictly validate data-URL attachments coming from the client.
 * Returns null-entries dropped; caller sees only valid ones.
 */
export function parseRefImages(dataUrls: unknown): RefImage[] {
  if (!Array.isArray(dataUrls)) return [];
  const imgs: RefImage[] = [];
  for (const raw of dataUrls.slice(0, MAX_REF_COUNT)) {
    if (typeof raw !== "string") continue;
    const m = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) continue;
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length || buf.length > MAX_REF_BYTES) continue;
    const mime = m[1];
    if (!ALLOWED_REF_MIME.has(mime)) continue;
    imgs.push({ mimeType: mime, base64: m[2].replace(/\s+/g, "") });
  }
  return imgs;
}

/**
 * Pollen key? (enter.pollinations.ai → API key, `sk_…`.) Removes the 45s/IP
 * limit, the corner logo, and unlocks all models via the OpenAI-compatible
 * generations endpoint. Accepted as POLLINATIONS_API_KEY (or POLLINATIONS_KEY).
 */
function pollinationsKey(): string | null {
  const key = process.env.POLLINATIONS_API_KEY || process.env.POLLINATIONS_KEY;
  return key && key.trim() ? key.trim() : null;
}

type CreateImageResponse = {
  data?: { b64_json?: string; url?: string; revised_prompt?: string; output_format?: string }[];
};

/**
 * Keyed generation through gen.pollinations.ai — no per-IP limit, no logo.
 * OpenAI Images shape: POST /v1/images/generations → data[0].b64_json.
 */
async function generateImagePollen(prompt: string, apiKey: string): Promise<GeneratedImage> {
  const res = await fetch("https://gen.pollinations.ai/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      size: "1024x1024",
      response_format: "b64_json",
    }),
    signal: AbortSignal.timeout(POLLINATIONS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Pollinations (keyed) error:", res.status, body.slice(0, 300));
    if (res.status === 401) {
      throw new Error("The image API key was rejected — check POLLINATIONS_API_KEY on the server.");
    }
    if (res.status === 402) {
      throw new Error("Image credits are used up — top up Pollen at enter.pollinations.ai.");
    }
    throw new Error(res.status === 429
      ? "Image generation is rate limited — try again in a moment."
      : "Image generation failed — please try again in a moment.");
  }
  const json: CreateImageResponse = await res.json().catch(() => ({}) as CreateImageResponse);
  const first = json.data?.[0];
  if (first?.b64_json) {
    const buf = Buffer.from(first.b64_json, "base64");
    if (buf.length > MAX_IMAGE_BYTES) {
      throw new Error("The generated image was too large to process — try a simpler prompt.");
    }
    return { mimeType: "image/jpeg", base64: first.b64_json };
  }
  // Some models return a stored media URL instead of inline base64.
  if (first?.url) {
    const media = await fetch(first.url, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (media.ok) {
      const buf = Buffer.from(await media.arrayBuffer());
      const ctm = media.headers.get("content-type") ?? "image/jpeg";
      if (buf.length <= MAX_IMAGE_BYTES && ctm.startsWith("image/")) {
        return { mimeType: ctm, base64: buf.toString("base64") };
      }
    }
  }
  throw new Error("The image service returned no picture — try different wording.");
}

/**
 * Image-to-image with reference image(s). Requires a working keyed provider —
 * editing silently degrading to a from-scratch generation would mislead the
 * user, so unlike create-mode there is NO anonymous fallback: choices are
 * Pollen key first, Gemini second (it edits natively), else a clear error.
 */
export async function generateImageEdit(
  prompt: string,
  refs: RefImage[]
): Promise<GeneratedImage> {
  const text =
    prompt.trim() ||
    "Improve this image while keeping its subject, style and colors. Respond with the edited image.";

  const pollenKey = pollinationsKey();
  if (pollenKey) {
    try {
      const res = await fetch("https://gen.pollinations.ai/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pollenKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: text,
          // Docs: reference image as URL *or data URI*; arrays supported.
          image: refs.map((r) => `data:${r.mimeType};base64,${r.base64}`),
          // Only models listing "image" under input_modalities accept
          // references — the default flux.1-schnell 400s with exactly that
          // error. Kontext is Black Forest Labs' image-editing model.
          model: "black-forest-labs/flux.1-kontext-pro",
          size: "1024x1024",
          response_format: "b64_json",
        }),
        signal: AbortSignal.timeout(POLLINATIONS_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("Pollinations edit error:", res.status, body.slice(0, 300));
        if (res.status === 402) throw new Error("Image credits are used up — top up Pollen at enter.pollinations.ai.");
        if (res.status !== 503 && res.status !== 429) {
          throw new Error(body.includes("not") || res.status === 400
            ? "The image service couldn't process that reference — try a JPG or PNG."
            : "Image editing failed — please try again in a moment.");
        }
        // 429/503: fall through to Gemini below.
      } else {
        const json: CreateImageResponse = await res.json().catch(() => ({}) as CreateImageResponse);
        const first = json.data?.[0];
        if (first?.b64_json) {
          const buf = Buffer.from(first.b64_json, "base64");
          if (buf.length > MAX_IMAGE_BYTES) throw new Error("The edited image was too large to process — try a smaller prompt.");
          return { mimeType: "image/jpeg", base64: first.b64_json };
        }
        if (first?.url) {
          const media = await fetch(first.url, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
          if (media.ok) {
            const buf = Buffer.from(await media.arrayBuffer());
            const ctm = media.headers.get("content-type") ?? "image/jpeg";
            if (buf.length <= MAX_IMAGE_BYTES && ctm.startsWith("image/")) {
              return { mimeType: ctm, base64: buf.toString("base64") };
            }
          }
        }
      }
    } catch (err: any) {
      if (err?.message?.includes("credits")) throw err;
      console.error("Keyed edit failed, trying Gemini:", err?.message);
    }
  }

  if (process.env.GEMINI_API_KEY && Date.now() >= geminiCooldownUntil) {
    try {
      const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY,"Content-Type": "application/json" },
        body: JSON.stringify({
          contents: {
            parts: [
              { text },
              ...refs.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.base64 } })),
            ],
          },
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("Gemini edit error:", res.status, body.slice(0, 300));
        if (res.status === 429) geminiCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS;
      } else {
        const json: unknown = await res.json();
        const parts =
          (
            json as {
              candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] } }[];
            }
          ).candidates?.[0]?.content?.parts ?? [];
        let resultText = "";
        let image: { mimeType: string; base64: string } | undefined;
        for (const part of parts) {
          if (part.text && !part.inlineData) resultText += part.text;
          if (part.inlineData?.data) {
            const bytes = Buffer.from(part.inlineData.data, "base64").length;
            if (bytes <= MAX_IMAGE_BYTES) image = { mimeType: part.inlineData.mimeType || "image/png", base64: part.inlineData.data };
          }
        }
        if (image) return { ...(image as { mimeType: string; base64: string }), text: resultText.trim() || undefined };
      }
    } catch (err: any) {
      console.error("Gemini edit failed:", err?.message);
    }
  }

  throw new Error(
    pollenKey
      ? "The image service couldn't edit that reference right now — try again in a moment."
      : "Editing an uploaded picture needs an image API key on the server (POLLINATIONS_API_KEY or billed GEMINI_API_KEY)."
  );
}

// Module-state cooldown: once Gemini answers "quota exhausted" we stop
// re-paying the 429 round-trip on every image request. Free-tier keys always
// 429; paid ones never do — so a 60s recheck cadence costs one wasted call
// per minute and nothing on the working path.
const GEMINI_COOLDOWN_MS = 60_000;
let geminiCooldownUntil = 0;

// Free-tier single-flight queue — see generateImageFree below.
const FREE_GAP_MS = 45_000;
let lastFreeImageAt = 0;
let lastRetryAfterS: number | null = null;
let freeSlotQueue: Promise<void> = Promise.resolve();

/** Pollinations returns JPEG bytes for a prompt, keyless. */
async function generateImageFree(prompt: string): Promise<GeneratedImage> {
  const seed = Math.floor(Math.random() * 1_000_000);
  // Free "classic" tier: max 768×768 area, JPEG, one image ≥45s apart per IP
  // (hence the single-flight queue — concurrent asks would just 402).
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=768&height=768&nologo=true&seed=${seed}`;
  // Single-flight: only one free-tier generation at a time, with ≥45s of
  // spacing between requests — two simultaneous image asks would otherwise
  // both fire and the loser gets 402 strictly because we didn't queue.
  const prev = freeSlotQueue;
  const mine = (freeSlotQueue = prev.then(async () => {
    const wait = Math.max(0, FREE_GAP_MS - (Date.now() - lastFreeImageAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
  }));
  await mine;
  const attempt = async (ms: number) => {
    // Network/deadline errors and non-2xx both return null — callers re-arm
    // spacing so a failure doesn't double-burst, then the retry decides.
    try {
      const res = await fetch(url, {
        headers: { Accept: "image/*" },
        signal: AbortSignal.timeout(ms),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length && buf[0] === 0xff && buf[1] === 0xd8) {
          const mime = res.headers.get("content-type")?.startsWith("image/")
            ? res.headers.get("content-type")!
            : "image/jpeg";
          return { buf, mime };
        }
        // 200 but not a JPEG body — treat as an upstream hiccup.
        console.warn("Pollinations returned non-JPEG 200 body:", buf.length, "bytes");
        return null;
      }
      // Free tier: 1 image / ≥45s per IP → 402 (sometimes an image-card body).
      // Queue overload shows up as 503 WITH a small Retry-After. Both read
      // the body just to log the reason; neither is trusted as artwork —
      // polling the slot again is the honest recovery.
      const text = await res.text().catch(() => "");
      console.warn(`Pollinations ${res.status}:`, text.slice(0, 160).replace(/\s+/g, " "));
      return { status: res.status, retryAfter: retryAfterSeconds(res) };
    } catch (err: any) {
      console.warn("Pollinations network failure:", err?.name, err?.message);
      return null;
    }
  };

  // Two attempts: the first prompt consumes a slot; if the gateway answers
  // 402/503 with a short Retry-After (rack pressure or the 45s rule with a
  // small remainder), wait it out and try once more inside this request —
  // that converts most transient failures into a finished image instead of
  // bouncing the user.
  const FREE_MAX_WAIT_S = 20;
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) {
      const extra = Math.max(3, (lastRetryAfterS ?? 5) + 1) * 1000;
      await new Promise((r) => setTimeout(r, extra));
    }
    lastFreeImageAt = Date.now();
    const out: any = await attempt(pass === 0 ? POLLINATIONS_TIMEOUT_MS : 60_000);
    lastRetryAfterS = null;
    if (out && out.buf) {
      if (out.buf.length > MAX_IMAGE_BYTES) {
        throw new Error("The generated image was too large to process — try a simpler prompt.");
      }
      return { mimeType: out.mime, base64: out.buf.toString("base64") };
    }
    if (out && out.status === 402) {
      if ((out.retryAfter ?? 99) > FREE_MAX_WAIT_S) {
        // Longer than we can fairly hold the request — surface the wait.
        throw new Error(
          "The free image service allows about one picture every 45 seconds — try again in a minute."
        );
      }
      lastRetryAfterS = out.retryAfter ?? 5;
      continue;
    }
    if (out && out.status === 503) {
      lastRetryAfterS = Math.min(out.retryAfter ?? 10, 15);
      continue;
    }
    break; // network error / weird body — no use retrying the same URL now
  }
  throw new Error("Image generation is busy right now — please try again in a moment.");
}

/** Retry-After in seconds from header or the JSON body text. */
function retryAfterSeconds(res: Response): number | null {
  const header = res.headers.get("retry-after");
  const asNum = Number(header);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum;
  return null;
}

/** One Gemini call; throws for refusals, spam-free rate limits. */
async function generateImageGemini(prompt: string): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const res = await fetch(`${GEMINI_BASE}/models/${GEMINI_IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: {
        parts: [
          {
            text:
              `Generate a single image for the user's request, in a clean, appealing style.\n` +
              `If the request is educational, make the image clear and readable. ` +
              `User request:\n\n${prompt}`,
          },
        ],
      },
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Gemini image error:", res.status, body.slice(0, 500));
    if (res.status === 429) {
      geminiCooldownUntil = Date.now() + GEMINI_COOLDOWN_MS;
      // Caller decides: fall back to the free provider or surface the error.
      const err = new Error("Gemini image quota exhausted") as Error & { rateLimited: true };
      err.rateLimited = true;
      throw err;
    }
    if (res.status === 403 || res.status === 400) {
      // Likely a bad key/model or a safety-blocked prompt: surface a gentle message.
      const err = new Error("The image service refused that request — try rephrasing it.") as Error & { refused: true };
      err.refused = true;
      throw err;
    }
    throw new Error("Image generation failed — please try again in a moment.");
  }

  const json: unknown = await res.json();
  const parts =
    (
      json as {
        candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] } }[];
      }
    ).candidates?.[0]?.content?.parts ?? [];

  let text = "";
  let image: { mimeType: string; base64: string } | undefined;
  for (const part of parts) {
    if (part.text && !part.inlineData) text += part.text;
    if (part.inlineData?.data) {
      const bytes = Buffer.from(part.inlineData.data, "base64").length;
      if (bytes > MAX_IMAGE_BYTES) continue; // skip bloated blobs, prefer later ones
      image = { mimeType: part.inlineData.mimeType || "image/png", base64: part.inlineData.data };
    }
  }
  if (!image) {
    console.warn("Gemini returned no image for prompt:", prompt.slice(0, 120));
    const err = new Error(
      text.trim() ||
        "The image service couldn't create an image for that request — try rephrasing it."
    ) as Error & { refused: true };
    err.refused = true;
    throw err;
  }
  return { ...image, text: text.trim() || undefined };
}

/**
 * Generate one image from a prompt — Gemini when its quota allows
 * (billed keys), free fallback otherwise. Throws Error with user-safe text
 * only; upstream details are logged here and never returned to the client.
 */
export async function generateImage(
  prompt: string,
  refs: RefImage[] = []
): Promise<GeneratedImage> {
  if (refs.length) return generateImageEdit(prompt, refs);
  const pollenKey = pollinationsKey();
  if (pollenKey) {
    // Keyed Pollinations first: no per-IP limit and no logo — strictly
    // better than the classic route whenever a key exists.
    try {
      return await generateImagePollen(prompt, pollenKey);
    } catch (err: any) {
      console.error("Keyed Pollinations failed, using anon fallback:", err?.message);
      // fall through to the anonymous classic route below
    }
  }
  if (process.env.GEMINI_API_KEY && Date.now() >= geminiCooldownUntil) {
    try {
      return await generateImageGemini(prompt);
    } catch (err: any) {
      // Refusals are a content-policy answer: don't shop it to a looser
      // provider behind Gemini's back — return the refusal.
      if (err?.refused) throw err;
      // Rate limit or transient: fall through to the free provider below.
      if (!err?.rateLimited) console.error("Gemini image failed, using fallback:", err?.message);
    }
  }
  return generateImageFree(prompt);
}
