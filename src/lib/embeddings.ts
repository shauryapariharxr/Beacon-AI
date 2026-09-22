// Embeddings via Mistral's `mistral-embed` model (OpenAI-compatible wire
// format). Uses the same MISTRAL_API_KEY already configured for chat, so
// RAG needs no new provider accounts. Output: 1024-dim vectors, matching
// the `vector(1024)` columns in the schema.

const EMBED_URL = "https://api.mistral.ai/v1/embeddings";
const EMBED_MODEL = "mistral-embed";
// Mistral accepts batched inputs; 32 keeps requests well under limits while
// amortizing HTTP overhead for large uploads.
const BATCH_SIZE = 32;
const MAX_RETRIES = 2;

export function hasEmbeddings(): boolean {
  return Boolean(process.env.MISTRAL_API_KEY);
}

/**
 * Embed a batch of texts. Returns vectors in the same order as the input.
 * Retries transient 429/5xx failures with a short backoff.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY is not set — embeddings unavailable.");

  const out: number[][] = new Array(texts.length);
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(EMBED_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({ model: EMBED_MODEL, input: batch }),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`embeddings HTTP ${res.status}: ${await res.text().catch(() => "")}`);
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, attempt === 0 ? 1200 : 3000));
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) {
          throw new Error(`embeddings HTTP ${res.status}: ${await res.text().catch(() => "")}`);
        }
        const json: any = await res.json();
        // API returns data ordered by `index` — place by index, not position.
        for (const item of json.data ?? []) {
          out[start + item.index] = item.embedding as number[];
        }
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_RETRIES) throw lastErr;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (batch.some((_, i) => !out[start + i])) {
      throw new Error("embeddings response was missing vectors for some inputs");
    }
  }
  return out;
}

/** pgvector accepts a literal like '[0.12,0.5,...]' — build it once per query. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
