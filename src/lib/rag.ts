// RAG (Retrieval-Augmented Generation) pipeline:
//   documents: upload → extract text → chunk → embed (mistral-embed) →
//              store in pgvector → semantic retrieve on each message
//   memories:  after each exchange, summarize it into a durable note, embed
//              it, and retrieve relevant notes into future conversations
//
// Everything here is best-effort from the chat route's perspective: retrieval
// failures degrade to plain chat (never break it), and memory writes fail
// silently (logged) after the reply already streamed.

import { sql } from "drizzle-orm";
import { db } from "./db";
import { memories } from "./schema";
import { embed, toVectorLiteral, hasEmbeddings } from "./embeddings";
import {
  hasProviders,
  nextProviderAttempt,
} from "./providers";

// ---------- Document ingestion ----------

export const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB
export const MAX_DOC_CHARS = 400_000;
const MAX_CHUNKS_PER_DOC = 400;

/** Supported upload kinds, by extension first then mime. */
export function detectKind(filename: string, mime: string | null): "pdf" | "text" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json") ||
    mime?.startsWith("text/")
  ) {
    return "text";
  }
  return null;
}

/** Extract plain text from an uploaded file (PDF via unpdf, else UTF-8). */
export async function extractTextFromFile(
  buffer: Buffer,
  kind: "pdf" | "text"
): Promise<string> {
  if (kind === "text") {
    return buffer.toString("utf8");
  }
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf);
  const pages = Array.isArray(text) ? text : [String(text)];
  // Page markers give the model (and the user, via citations in chunk text)
  // provenance for where each piece of content came from.
  return pages.map((p, i) => `[Page ${i + 1}]\n${p}`).join("\n\n");
}

/**
 * Pack text into ~900-char chunks on paragraph boundaries, carrying a
 * ~150-char word-aligned overlap between consecutive chunks so answers
 * spanning a chunk break still have their context.
 */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").slice(0, MAX_DOC_CHARS);
  const target = 900;
  const overlap = 150;

  const chunks: string[] = [];
  let cur = "";

  const push = (piece: string) => {
    if (cur && cur.length + piece.length + 1 > target) {
      chunks.push(cur.trim());
      const tail = cur.slice(-overlap);
      const cut = tail.indexOf(" ");
      cur = (cut >= 0 ? tail.slice(cut + 1) : tail) + " " + piece;
    } else {
      cur = cur ? `${cur}\n${piece}` : piece;
    }
  };

  for (const para of clean.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= target * 1.6) {
      push(p);
    } else {
      // Long paragraphs: split on sentence boundaries, keeping sentences intact.
      const sentences = p.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [p];
      let buf = "";
      for (const s of sentences) {
        if (buf.length + s.length > target && buf) {
          push(buf.trim());
          buf = s;
        } else {
          buf += s;
        }
      }
      if (buf.trim()) push(buf.trim());
    }
  }
  if (cur.trim()) chunks.push(cur.trim());

  return chunks.filter((c) => c.length >= 20).slice(0, MAX_CHUNKS_PER_DOC);
}

// ---------- Retrieval ----------

export type DocMatch = { filename: string; content: string; dist: number };
export type MemoryMatch = { summary: string; dist: number };

type Row = Record<string, unknown>;
function rowsOf(res: unknown): Row[] {
  if (Array.isArray(res)) return res as Row[];
  return ((res as any)?.rows ?? []) as Row[];
}

/** Lexical fallback so retrieval still works if embedding fails at runtime. */
function keywordTerms(message: string): string[] {
  return [...new Set(
    message
      .toLowerCase()
      .split(/[^a-z0-9\u0900-\u097f]+/)
      .filter((w) => w.length >= 4)
  )].slice(0, 6);
}

/**
 * Embed a query once so both retrievers can share it. The chat route used to
 * call `embed()` twice per message (documents and memories each embedded the
 * same text), which doubled embedding spend and added a full round-trip of
 * latency to every single reply. Returns null when embeddings are unavailable
 * or the call fails — callers degrade to the keyword fallback.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!hasEmbeddings() || !text.trim()) return null;
  try {
    const [vec] = await embed([text]);
    return vec ?? null;
  } catch (err) {
    console.error("Query embedding failed:", err);
    return null;
  }
}

export async function retrieveDocumentContext(
  userId: string,
  query: string,
  documentIds?: string[],
  queryVector?: number[] | null
): Promise<DocMatch[] | null> {
  if (!userId || !query.trim()) return null;

  // Pinned docs relax the similarity threshold — the user explicitly asked
  // for this document, so even a weak match should reach the model.
  const pinned = Boolean(documentIds?.length);
  const maxDist = pinned ? 0.85 : 0.72;

  // `undefined` means "no vector was supplied, compute one" (keeps this
  // function usable on its own); `null` means "embedding is unavailable" and
  // goes straight to the keyword fallback.
  const qvec = queryVector === undefined ? await embedQuery(query) : queryVector;
  if (!qvec) return keywordFallback(userId, query, documentIds);

  try {
    const lit = toVectorLiteral(qvec);
    const docFilter = documentIds?.length
      ? sql` AND c.document_id IN (${sql.join(
          documentIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      : sql``;
    const res = await db.execute(sql`
      SELECT c.content, d.filename, (c.embedding <=> ${lit}::vector) AS dist
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE c.user_id = ${userId}${docFilter}
      ORDER BY dist ASC
      LIMIT 4
    `);
    const matches = rowsOf(res)
      .map((r) => ({
        filename: String(r.filename),
        content: String(r.content),
        dist: Number(r.dist),
      }))
      .filter((m) => Number.isFinite(m.dist) && m.dist <= maxDist);
    return matches.length ? matches : null;
  } catch (err) {
    // Vector search failed (e.g. the embedding column is missing, or the DB
    // rejected the operator) — fall back to a cheap ILIKE keyword scan rather
    // than losing document context entirely.
    console.error("Vector doc search failed, trying keyword fallback:", err);
    return keywordFallback(userId, query, documentIds);
  }
}

/** Lexical ILIKE scan used when embeddings are unavailable or fail. */
async function keywordFallback(
  userId: string,
  query: string,
  documentIds?: string[]
): Promise<DocMatch[] | null> {
  const terms = keywordTerms(query);
  if (!terms.length) return null;
  const likes = sql.join(
    terms.map((t) => sql`c.content ILIKE ${"%" + t + "%"}`),
    sql` OR `
  );
  const docFilter = documentIds?.length
    ? sql` AND c.document_id IN (${sql.join(
        documentIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    : sql``;
  const res = await db.execute(sql`
    SELECT c.content, d.filename, 0.5::float8 AS dist
    FROM document_chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.user_id = ${userId} AND (${likes})${docFilter}
    LIMIT 4
  `);
  const matches = rowsOf(res).map((r) => ({
    filename: String(r.filename),
    content: String(r.content),
    dist: Number(r.dist),
  }));
  return matches.length ? matches : null;
}

export async function retrieveMemoryContext(
  userId: string,
  query: string,
  excludeConversationId?: string,
  queryVector?: number[] | null
): Promise<MemoryMatch[] | null> {
  if (!userId || !query.trim()) return null;
  try {
    const qvec = queryVector === undefined ? await embedQuery(query) : queryVector;
    if (!qvec) return null;
    const lit = toVectorLiteral(qvec);
    // Exclude the current conversation: its turns are already in the
    // message history the model sees — recalling them wastes context.
    const excl = excludeConversationId
      ? sql` AND (conversation_id IS NULL OR conversation_id <> ${excludeConversationId})`
      : sql``;
    const res = await db.execute(sql`
      SELECT summary, (embedding <=> ${lit}::vector) AS dist
      FROM memories
      WHERE user_id = ${userId}${excl}
      ORDER BY dist ASC
      LIMIT 5
    `);
    const matches = rowsOf(res)
      .map((r) => ({ summary: String(r.summary), dist: Number(r.dist) }))
      .filter((m) => Number.isFinite(m.dist) && m.dist <= 0.78);
    return matches.length ? matches : null;
  } catch (err) {
    console.error("Memory retrieval failed:", err);
    return null;
  }
}

// ---------- Prompt blocks ----------

export function buildDocumentContextBlock(matches: DocMatch[]): string {
  const lines = matches.map(
    (m, i) => `[D${i + 1}] From "${m.filename}":\n${m.content}`
  );
  return (
    "\n\nDOCUMENT CONTEXT — excerpts retrieved from documents the user attached to this chat:\n" +
    lines.join("\n\n") +
    "\nDOCUMENT RULES:\n" +
    "- Ground any answer about the attached documents in these excerpts, and cite the excerpt id in plain ASCII form — [D1], [D2] — immediately after the sentence that uses it. Never use any other citation style (no 【D1】, no (D1), no footnote numbers).\n" +
    "- Quote numbers, names and measurements ONLY if they appear in the excerpts above; never fill a gap from memory or guess.\n" +
    "- If the excerpts don't contain what's needed, answer generally but say the documents don't cover it — never invent document content."
  );
}

export function buildMemoryContextBlock(matches: MemoryMatch[]): string {
  const lines = matches.map((m, i) => `- ${m.summary}`);
  return (
    "\n\nBACKGROUND MEMORY — notes retrieved from this user's PREVIOUS conversations (not visible in this chat's history):\n" +
    lines.join("\n") +
    "\n- Use this silently as context (their level, goals, prior topics, preferences). Never mention 'memory', 'stored notes', or this block unless the user asks what you remember."
  );
}

// ---------- Memory writing ----------

/**
 * Summarize a finished exchange into one durable memory sentence using any
 * available chat provider. Returns null when no provider is available or
 * the exchange is too thin to be worth remembering.
 */
export async function summarizeExchange(
  userText: string,
  assistantText: string
): Promise<string | null> {
  if (!hasProviders()) return null;
  if (userText.trim().length < 25 || assistantText.trim().length < 60) return null;

  const target = nextProviderAttempt("flash");
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify({
        model: target.model,
        messages: [
          {
            role: "system",
            content:
              "You compress chat exchanges into durable memory notes for an AI assistant about its user.",
          },
          {
            role: "user",
            content:
              `User asked: ${userText.slice(0, 1000)}\n\n` +
              `Assistant answered: ${assistantText.slice(0, 1500)}\n\n` +
              "Write ONE standalone memory sentence (max 35 words) recording only the durable, useful facts: who the user is, what they're working on or studying, their preferences, goals, or decisions. No quotes, no preamble, no names of the AI.",
          },
        ],
        stream: false,
      }),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const text: string | undefined = json.choices?.[0]?.message?.content;
    if (!text) return null;
    const summary = text.trim().replace(/^["']|["']$/g, "").slice(0, 500);
    return summary.length >= 10 ? summary : null;
  } catch (err) {
    console.error("Memory summarization failed:", err);
    return null;
  }
}

/**
 * Persist a memory for a finished exchange. Called after the assistant reply
 * has streamed and been saved — failures here are logged, never surfaced.
 */
export async function rememberExchange(
  userId: string,
  conversationId: string | null,
  userText: string,
  assistantText: string
): Promise<void> {
  const summary = await summarizeExchange(userText, assistantText);
  if (!summary) return;
  const [vec] = await embed([summary]);
  await db.insert(memories).values({
    id: crypto.randomUUID(),
    userId,
    conversationId,
    sourceUser: userText.slice(0, 2000),
    sourceAssistant: assistantText.slice(0, 2000),
    summary,
    embedding: vec,
    createdAt: Date.now(),
  });
}
