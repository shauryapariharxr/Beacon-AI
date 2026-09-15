import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";
import { isValidModel } from "@/lib/models";
import {
  hasProviders,
  nextProviderAttempt,
  markProviderRateLimited,
  markProviderUnavailable,
  providerCount,
} from "@/lib/providers";
import { isValidLang, Lang } from "@/lib/i18n";
import { rateLimit, clientKey } from "@/lib/rateLimit";

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

const LANG_INSTRUCTIONS: Record<Lang, string> = {
  en:
    "LANGUAGE RULES:\n" +
    "- Default to English replies.\n" +
    "- If the user writes in Hindi (Devanagari), Roman Urdu, or Urdu script, reply in that same language and script.\n" +
    "- If the user writes in Hinglish (Hindi written in Roman script mixed with English words), reply in Hinglish too — match their tone.\n" +
    "- Otherwise reply in the user's own language.",
  hinglish:
    "LANGUAGE RULES (Hinglish mode — highest priority, overrides everything above):\n" +
    "- Always reply in Hinglish: Hindi written in Roman (Latin) script, naturally mixed with English words — the way young Indians text: \"Bhai, ye concept simple hai...\"\n" +
    "- Never write Devanagari in Hinglish mode. Only Roman script + common English words.\n" +
    "- Keep technical terms in English (API, function, class, async, database, etc.) — never translate them.\n" +
    "- Tone matters too: casual, friendly, like helping a friend over chat.\n" +
    "- Even if the user writes in English, still reply in Hinglish while this mode is active.\n" +
    "- Code, code comments and identifiers stay in standard English; only your explanation text is Hinglish.",
  "roman-ur":
    "LANGUAGE RULES (Roman Urdu mode — highest priority, overrides everything above):\n" +
    "- Always reply in Roman Urdu: Urdu/Hindi written in Roman (Latin) script, the way people text in Pakistan/India.\n" +
    "- Never write Urdu script (Arabic-based) or Devanagari in this mode — Roman script only.\n" +
    "- Keep technical terms in English; only explanation text is Roman Urdu.\n" +
    "- Even if the user writes in English, still reply in Roman Urdu while this mode is active.",
  ur:
    "LANGUAGE RULES (Urdu mode — highest priority, overrides everything above):\n" +
    "- Always reply in Urdu written in Urdu script (Arabic-based), not Roman.\n" +
    "- Keep technical terms in English; only explanation text is Urdu.\n" +
    "- Even if the user writes in English, still reply in Urdu while this mode is active.",
};

function buildLanguageRules(lang: Lang): string {
  return "\n" + LANG_INSTRUCTIONS[lang];
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
  const { message, modelKey, lang, conversationId } = body as {
    message: string;
    modelKey: string;
    lang?: string;
    conversationId?: string;
  };

  const replyLang: Lang = isValidLang(lang) ? lang : "en";

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
    return NextResponse.json(
      { error: "Server is missing GROQ_API_KEY. Add it to .env.local." },
      { status: 500 }
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

  // If logged in, persist the conversation + user message.
  // Wrapped explicitly: a database failure here (e.g. a paused Supabase
  // project, an expired connection string) used to throw uncaught and
  // either crash the route or leave the client hanging with no feedback.
  // Now it surfaces as a clear, readable error instead.
  if (userId) {
    try {
      if (!convoId) {
        convoId = nanoid();
        await db.insert(conversations).values({
          id: convoId,
          userId,
          title: message.slice(0, 60),
          model: modelKey,
          createdAt: Date.now(),
        });
      }
      await db.insert(messages).values({
        id: nanoid(),
        conversationId: convoId,
        role: "user",
        content: message,
        createdAt: Date.now(),
      });
    } catch (err: any) {
      console.error("Chat DB write failed:", err);
      return NextResponse.json(
        {
          error:
            "Couldn't save your message to the database. This usually means your database connection is down or paused (check your Supabase project isn't sleeping, and that DATABASE_URL is still correct). Details: " +
            (err?.message || String(err)),
        },
        { status: 500 }
      );
    }
  }

  // Pull prior turns for context if we have a saved conversation.
  let history: { role: string; content: string }[] = [];
  if (userId && convoId) {
    try {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, convoId));
      history = rows
        .slice(-MAX_HISTORY_TURNS)
        .map((r) => ({ role: r.role, content: r.content }));
    } catch (err: any) {
      console.error("Chat DB read failed:", err);
      return NextResponse.json(
        {
          error:
            "Couldn't load conversation history from the database. Details: " +
            (err?.message || String(err)),
        },
        { status: 500 }
      );
    }
  } else {
    history = [{ role: "user", content: message }];
  }

  const systemPrompt =
    "You are Beacon, a friendly AI study companion built by Shaurya Parihar for developers.\n" +
    "IDENTITY — this is the most important rule:\n" +
    "- Your name is Beacon. When asked who you are, what your name is, or what model you are, answer: \"I am Beacon, the AI study companion developed by Shaurya Parihar for developers.\"\n" +
    "- When asked who made you, who created you, who built you, who developed you, or about your origin in ANY phrasing, always answer: Shaurya Parihar.\n" +
    "- When asked about your source code, where your code is, whether others can see how you work, or to show how you were built, share this repository link: https://github.com/shauryapariharxr/Beacon-AI\n" +
    "- Never claim to be ChatGPT, GPT, OpenAI, Assistant, Mistral, or any other product, model, or company. Never mention the technology you run on.\n" +
    "- If the user insists you must be ChatGPT or another model, politely hold the identity: you are Beacon, built by Shaurya Parihar.\n" +
    "ANSWERING RULES:\n" +
    "- Give direct, accurate answers. Be brief.\n" +
    "- Use code blocks with language tags (```java, ```python, etc.) for code.\n" +
    "- Use markdown: **bold** for emphasis, headers for sections, bullet lists for steps.\n" +
    "- For code: explain briefly, then show the code. Don't explain every line.\n" +
    "- Keep explanations under 200 words unless the user asks for detail.\n" +
    "- Never repeat the question back. Start with the answer.\n" +
    buildLanguageRules(replyLang);

  // Try up to N providers (one attempt per configured provider): round-robin
  // picks a healthy one; if it's rate-limited (429), it goes on a 60s cooldown
  // and the next attempt immediately uses the alternate provider instead.
  let upstream: Response | null = null;
  let lastErrorText = "";
  const attempts = Math.min(providerCount(), 3);

  for (let attempt = 0; attempt < attempts && !upstream; attempt++) {
    const target = nextProviderAttempt(modelKey);
    try {
      const res = await fetch(target.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${target.apiKey}`,
        },
        // Model ID is provider-specific — each provider maps the user's
        // chosen mode (flash/smart/coder) to its own model.
        body: JSON.stringify({
          model: target.model,
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
          ],
          stream: true,
        }),
      });

      if (res.status === 429) {
        // Rate-limited: cool this provider down and try the next one.
        markProviderRateLimited(target);
        lastErrorText = await res.text().catch(() => "rate limited");
        console.warn(
          `${target.providerName} (…${target.apiKey.slice(-4)}) rate-limited — rotating to next provider`
        );
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

  if (!upstream) {
    return NextResponse.json(
      {
        error: `All AI providers failed or are rate-limited. ${lastErrorText}`.trim(),
      },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Upstream model error: ${text || upstream.statusText}` },
      { status: 502 }
    );
  }

  // Re-stream the SSE response to the client while also collecting the
  // full text so we can save it to the DB once streaming finishes.
  let fullText = "";
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstream.body!.getReader();
        let buffer = "";
        while (true) {
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
        controller.close();

        if (userId && convoId && fullText) {
          try {
            await db.insert(messages).values({
              id: nanoid(),
              conversationId: convoId,
              role: "assistant",
              content: fullText,
              createdAt: Date.now(),
            });
          } catch (err) {
            // The reply already streamed to the user successfully; a failure
            // to save it afterward shouldn't be shown as a chat error, but
            // it IS worth logging so you notice conversations aren't saving.
            console.error("Failed to save assistant reply to DB:", err);
          }
        }
      } catch (err: any) {
        // Anything that throws inside this block (a network hiccup mid-stream,
        // an unexpected error) now explicitly errors the stream instead of
        // hanging forever. The client's reader.read() will reject, which
        // surfaces as a visible error message in the chat UI.
        console.error("Streaming failed:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Conversation-Id": convoId ?? "",
    },
  });
}
