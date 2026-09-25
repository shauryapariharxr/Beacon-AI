import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";
import { isValidModel } from "@/lib/models";
import {
  buildSystemPrompt,
  detectReplyLang,
  languageNudge,
  temperatureFor,
} from "@/lib/answerPolicy";
import {
  hasProviders,
  nextProviderAttempt,
  markProviderRateLimited,
  markProviderUnavailable,
  msUntilNextAvailable,
  providerCount,
} from "@/lib/providers";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import {
  retrieveDocumentContext,
  retrieveMemoryContext,
  buildDocumentContextBlock,
  buildMemoryContextBlock,
  rememberExchange,
  embedQuery,
  type DocMatch,
  type MemoryMatch,
} from "@/lib/rag";

// Streaming a reply holds the function open until the last token is written,
// so the duration must be raised explicitly — a platform default of a few
// seconds kills the function mid-answer. 60s is the ceiling on Vercel's Hobby
// plan; raise it (up to 300s on Pro) if replies are ever cut off mid-stream.
export const maxDuration = 60;
export const runtime = "nodejs";

// Abuse guard: signed-in users get a generous budget, guests a tighter one
// (they're anonymous, so cheaper to attack from).
const CHAT_LIMIT_AUTHED = { limit: 30, windowMs: 5 * 60_000 };
const CHAT_LIMIT_GUEST = { limit: 10, windowMs: 5 * 60_000 };
const MAX_MESSAGE_LENGTH = 4000;
// Context window guard: never feed the model more than the last N turns.
const MAX_HISTORY_TURNS = 40;

// Rate limits recover on their own, so a short cooldown; but "this model
// isn't allowed on your tier" (403) or "model doesn't exist" (404) won't
// self-heal — treat those as failover signals too and bench the provider
// for a while so the same broken mapping isn't retried on every request.
const HARD_FAIL_STATUSES = new Set([403, 404]);

// Cap on a single upstream generation. A provider that accepts the connection
// and then stalls would otherwise hold a serverless invocation (and its single
// database connection) until the platform kills it.
const UPSTREAM_TIMEOUT_MS = 90_000;

// Rate-limit recovery. When every instance is cooling down, the answer is
// worth a short wait (free-tier windows are seconds long) but not an unbounded
// one — past this we fail fast and tell the user to retry, instead of pinning
// a serverless invocation on a minute-long cooldown.
const MAX_RATE_LIMIT_WAIT_MS = 8_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `Retry-After` in milliseconds, from either the delay-seconds or HTTP-date form. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 60_000) : null;
}

export async function POST(req: NextRequest) {
  // A malformed body (bad content-type, truncated request) used to throw
  // uncaught and surface as an opaque 500 — reject it cleanly instead.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const { message, modelKey, guestHistory, conversationId, documentIds } = body as {
    message: string;
    modelKey: string;
    guestHistory?: { role: string; content: string }[];
    conversationId?: string;
    documentIds?: string[];
  };

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).` },
      { status: 400 }
    );
  }
  if (!isValidModel(modelKey)) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }

  // Guests (not signed in) are restricted to the Flash model. Checked on the
  // server so bypassing the UI lock doesn't grant access to premium models.
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId && modelKey !== "flash") {
    return NextResponse.json(
      { error: "Sign in to use models other than Flash." },
      { status: 401 }
    );
  }
  if (!hasProviders()) {
    // Deliberately vague: the response is client-facing and must not name
    // server environment variables.
    return NextResponse.json(
      { error: "The chat service isn't configured on this server yet." },
      { status: 503 }
    );
  }

  const userId = sessionUserId;

  // Rate limit per user (or IP for guests) before doing any expensive work.
  const limiter = userId ? CHAT_LIMIT_AUTHED : CHAT_LIMIT_GUEST;
  const rl = await rateLimit(clientKey(req, userId), limiter.limit, limiter.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many messages — please wait ${rl.retryAfterSeconds}s and try again.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }
  let convoId = conversationId;
  // Tracked so a send that never gets a reply can be rolled back instead of
  // leaving a question in the database that will never have an answer (see
  // the provider-exhausted branch below).
  let userMessageId: string | null = null;
  let createdConversation = false;

  // If logged in, persist the conversation + user message.
  // Wrapped explicitly: a database failure here (e.g. a paused Supabase
  // project, an expired connection string) used to throw uncaught and
  // either crash the route or leave the client hanging with no feedback.
  // Now it surfaces as a clear, readable error instead.
  if (userId) {
    try {
      if (convoId) {
        // SECURITY: the conversation must belong to the caller. Without this
        // check any signed-in user could pass another user's conversation id
        // and both append messages into it and read its history via the
        // model prompt (classic IDOR).
        const owned = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(and(eq(conversations.id, convoId), eq(conversations.userId, userId)))
          .limit(1);
        if (!owned.length) {
          return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
        }
      } else {
        convoId = nanoid();
        createdConversation = true;
        await db.insert(conversations).values({
          id: convoId,
          userId,
          title: message.slice(0, 60),
          model: modelKey,
          createdAt: Date.now(),
        });
      }
      userMessageId = nanoid();
      await db.insert(messages).values({
        id: userMessageId,
        conversationId: convoId,
        role: "user",
        content: message,
        createdAt: Date.now(),
      });
    } catch (err: any) {
      console.error("Chat DB write failed:", err);
      // Generic client message — internal error details stay in the server log.
      return NextResponse.json(
        { error: "Couldn't save your message. The database may be unreachable — try again in a moment." },
        { status: 500 }
      );
    }
  }

  // Pull prior turns for context if we have a saved conversation.
  let history: { role: string; content: string }[] = [];
  if (userId && convoId) {
    try {
      // Newest-first with a LIMIT, then reversed: an index-backed page of the
      // conversation instead of loading every message it ever held and
      // slicing the last 40 in JS (which on a long conversation meant reading
      // thousands of rows — and unordered, since the old query had no ORDER
      // BY at all).
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convoId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(MAX_HISTORY_TURNS);
      history = rows.reverse().map((r) => ({ role: r.role, content: r.content }));
    } catch (err: any) {
      console.error("Chat DB read failed:", err);
      return NextResponse.json(
        { error: "Couldn't load your conversation history — try again in a moment." },
        { status: 500 }
      );
    }
  } else {
    // Guests have no persistence, so the client sends its recent turns;
    // sanitize strictly before they reach the model prompt.
    history = Array.isArray(guestHistory)
      ? guestHistory
          .filter(
            (m) =>
              m &&
              typeof m.content === "string" &&
              m.content.trim().length > 0 &&
              (m.role === "user" || m.role === "assistant")
          )
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content.slice(0, MAX_MESSAGE_LENGTH),
          }))
      : [];
    history = history.filter((m) => m.content !== message);
    history.push({ role: "user", content: message });
  }

  // Detected once, used for the prompt rules, the per-turn language directive,
  // and the temperature choice.
  const replyLang = detectReplyLang(message);

  // ---------- RAG retrieval (signed-in users only; best-effort) ----------
  // Documents the user pinned to this chat (or all their docs if none are
  // pinned), plus relevant notes from previous conversations. Failures
  // degrade to plain chat — never block a reply on retrieval.
  //
  // The query is embedded ONCE and shared by both retrievers: embedding the
  // same text twice (as this used to) doubled embedding spend and added a
  // round-trip of latency to every single reply.
  let docMatches: DocMatch[] | null = null;
  let memoryMatches: MemoryMatch[] | null = null;
  if (userId) {
    const pinnedIds =
      Array.isArray(documentIds) && documentIds.length
        ? documentIds.filter((id) => typeof id === "string").slice(0, 10)
        : undefined;
    const queryVector = await embedQuery(message);
    [docMatches, memoryMatches] = await Promise.all([
      retrieveDocumentContext(userId, message, pinnedIds, queryVector),
      retrieveMemoryContext(userId, message, convoId, queryVector),
    ]);
  }

  const systemPrompt = buildSystemPrompt({
    lang: replyLang,
    documentBlock: docMatches ? buildDocumentContextBlock(docMatches) : "",
    memoryBlock: memoryMatches ? buildMemoryContextBlock(memoryMatches) : "",
  });

  // The system prompt is one instruction among many by the time a long history
  // follows it, and models drift back to the previous turn's language. So the
  // directive is repeated inside the very turn being answered — and, when the
  // user has switched language mid-conversation, the nudge says so explicitly.
  // Only the outbound copy carries it; the stored message stays untouched.
  const lastUserIdx = history.map((m) => m.role).lastIndexOf("user");
  const previousUserText =
    lastUserIdx > 0
      ? [...history.slice(0, lastUserIdx)].reverse().find((m) => m.role === "user")?.content
      : undefined;
  const outbound =
    lastUserIdx === -1
      ? history
      : history.map((m, i) =>
          i === lastUserIdx
            ? {
                role: m.role,
                content:
                  m.content +
                  languageNudge(
                    replyLang,
                    previousUserText ? detectReplyLang(previousUserText) : null
                  ),
              }
            : m
        );

  // Rotate across every configured (provider, key) pair. Two things make this
  // loop more than a plain failover:
  //
  //   1. A 429 benches the instance for the provider's own `Retry-After` (5s
  //      by default) instead of a flat 60s — the old fixed bench meant two
  //      free-tier 429s put the whole app out of service for a minute, and
  //      every request in that window answered "all providers busy" while the
  //      user's question was already stored, with no reply to go with it.
  //   2. When *every* instance is cooling down, a short wait is spent before
  //      retrying rather than giving up immediately: rate-limit windows are
  //      seconds long, and waiting them out turns a lost answer into a slightly
  //      slower one. If the remaining cooldown is longer than we can afford to
  //      hold the request, the request fails fast with a clear message.
  let upstream: Response | null = null;
  let lastErrorText = "";
  const maxAttempts = Math.max(3, providerCount() * 2);

  for (let attempt = 0; attempt < maxAttempts && !upstream; attempt++) {
    const target = nextProviderAttempt(modelKey);
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`,
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        // Model ID is provider-specific — each provider maps the user's
        // chosen mode (flash/smart/coder) to its own model.
        body: JSON.stringify({
          model: target.model,
          messages: [{ role: "system", content: systemPrompt }, ...outbound],
          stream: true,
          // Tuned for accuracy, not vibes: factual names/dates are far more
          // reliable with a low temperature, and both Groq and Mistral accept
          // this on every model we route to. The non-English scripts measured
          // the highest hallucination rate, so they run even cooler.
          temperature: temperatureFor(replyLang),
        }),
      });

      if (res.status === 429) {
        // Rate-limited: bench this instance for as long as the provider says
        // (its own window) and try the next one.
        markProviderRateLimited(target, retryAfterMs(res) ?? undefined);
        lastErrorText = await res.text().catch(() => "rate limited");
        console.warn(
          `${target.providerName} (…${target.apiKey.slice(-4)}) rate-limited — rotating to next provider`
        );

        const waitMs = msUntilNextAvailable();
        if (waitMs > 0 && waitMs <= MAX_RATE_LIMIT_WAIT_MS) {
          // Nothing healthy: wait out the window rather than lose the answer.
          await sleep(waitMs + 150);
        } else if (waitMs > MAX_RATE_LIMIT_WAIT_MS) {
          lastErrorText = `all providers rate-limited for ~${Math.round(waitMs / 1000)}s`;
          break;
        }
        continue;
      }

      if (HARD_FAIL_STATUSES.has(res.status)) {
        // Model unavailable on this provider (tier/model error): fail over
        // like a 429, but bench the provider longer so we stop retrying a
        // mapping that can't succeed until it's reconfigured.
        markProviderUnavailable(target, 10 * 60_000);
        lastErrorText = await res.text().catch(() => res.statusText);
        console.warn(
          `${target.providerName} model '${target.model}' unavailable (${res.status}) — rotating to next provider`
        );
        continue;
      }

      upstream = res;
    } catch (err: any) {
      console.error(`Failed to reach ${target.providerName}:`, err);
      lastErrorText = err?.message || String(err);
    }
  }

  /**
   * Undo the half-written turn when no reply is going to exist.
   *
   * Without this, every failed send left a question in the database that could
   * never have an answer: ~20% of the questions in production were in that
   * state, the user's sidebar filled up with conversations holding a single
   * orphan question, and a client retry would have stored the same message a
   * second time.
   */
  const rollbackUnanswered = async () => {
    if (!userId || !userMessageId) return;
    try {
      await db
        .delete(messages)
        .where(and(eq(messages.conversationId, convoId!), eq(messages.id, userMessageId)));
      if (createdConversation && convoId) {
        await db.delete(conversations).where(eq(conversations.id, convoId));
      }
    } catch (err) {
      console.error("Failed to roll back an unanswered message:", err);
    }
  };

  if (!upstream) {
    // `lastErrorText` holds raw upstream responses — log it, never send it.
    console.error("All providers exhausted. Last upstream error:", lastErrorText);
    await rollbackUnanswered();
    return NextResponse.json(
      { error: "All AI providers are busy or unreachable right now — please try again in a moment." },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    // A revoked/expired key, a wrong model id on a new plan tier, a provider
    // outage — anything that reaches the provider but produces no reply also
    // has to leave the conversation untouched.
    const text = await upstream.text().catch(() => "");
    console.error("Upstream model error:", upstream.status, text || upstream.statusText);
    await rollbackUnanswered();
    return NextResponse.json(
      { error: "The AI provider returned an error — please try again." },
      { status: 502 }
    );
  }

  // Re-stream the SSE response to the client while also collecting the full
  // text so we can save it to the DB once streaming finishes.
  let fullText = "";
  let persisted = false;
  let clientGone = false;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  /**
   * Save the assistant reply exactly once.
   *
   * Called on the normal path AND from `cancel()` (the client disconnected:
   * tab closed, page reloaded, request aborted). Roughly one in five stored
   * questions used to have no reply at all, because a disconnect threw inside
   * the stream, the catch skipped the insert, and the question sat in the
   * database unanswered forever. The user had already read the answer on
   * screen; only the record was lost.
   */
  const persistReply = async () => {
    if (persisted) return;
    persisted = true;
    if (!userId || !convoId || !fullText.trim()) return;
    try {
      await db.insert(messages).values({
        id: nanoid(),
        conversationId: convoId,
        role: "assistant",
        content: fullText,
        createdAt: Date.now(),
      });
    } catch (err) {
      // The reply already reached the user; a save failure is logged, not
      // shown as a chat error — but it IS worth knowing conversations aren't
      // saving.
      console.error("Failed to save assistant reply to DB:", err);
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstream.body!.getReader();
        upstreamReader = reader;
        let buffer = "";
        while (true) {
          if (clientGone) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                controller.enqueue(encoder.encode(delta));
              }
            } catch {
              // ignore malformed keep-alive lines
            }
          }
        }
        // Persist BEFORE closing: once the stream ends the function may be
        // frozen, and an un-awaited insert after that point is simply lost.
        await persistReply();
        if (!clientGone) controller.close();
      } catch (err: any) {
        // Anything that throws inside this block (a network hiccup mid-stream,
        // an unexpected error, or the client going away) explicitly errors the
        // stream instead of hanging forever — the client's reader.read() then
        // rejects and the chat UI shows a visible error.
        await persistReply();
        console.error("Streaming failed:", err);
        try {
          if (!clientGone) controller.error(err);
        } catch {
          // already closed/cancelled
        }
      }

      // Long-term memory: summarize this exchange into a durable note future
      // conversations can retrieve. Strictly after the reply is saved;
      // failures are logged and swallowed — never user-facing.
      if (userId && convoId && fullText) {
        try {
          await rememberExchange(userId, convoId, message, fullText);
        } catch (err) {
          console.error("Memory write failed:", err);
        }
      }
    },

    /**
     * The consumer went away (tab closed, reload, navigation, network drop).
     * Save what was already generated and stop pulling tokens from the
     * provider — the user isn't there to read them and they cost real money.
     */
    async cancel() {
      clientGone = true;
      await persistReply();
      try {
        await upstreamReader?.cancel();
      } catch {
        // upstream already finished
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Conversation-Id": convoId ?? "",
      // Compact summary of what was retrieved, so the UI can show which
      // documents grounded this reply without parsing the stream.
      // HTTP headers are ISO-8859-1: a filename with non-Latin1 characters
      // (Devanagari, emoji…) would crash the response. Strip to a safe range.
      "X-Rag-Docs": docMatches
        ? JSON.stringify([...new Set(docMatches.map((m) => m.filename))])
            .replace(/[^\x20-\x7E]/g, "?")
            .slice(0, 400)
        : "",
    },
  });
}
