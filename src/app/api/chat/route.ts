import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";
import { isValidModel } from "@/lib/models";
import {
  hasProviders,
  nextProviderAttempt,
  markProviderRateLimited,
  markProviderUnavailable,
  providerCount,
} from "@/lib/providers";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import {
  retrieveDocumentContext,
  retrieveMemoryContext,
  buildDocumentContextBlock,
  buildMemoryContextBlock,
  rememberExchange,
  type DocMatch,
  type MemoryMatch,
} from "@/lib/rag";

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

// ---------- Reply-language detection ----------
// The model should mirror the language of the user's LATEST message — not the
// conversation's dominant language (the classic bug: Hinglish history makes
// every later English question get a Hindi answer). We detect cheaply on the
// server and inject an explicit, unambiguous directive into the prompt.

type ReplyLang = "en" | "hinglish" | "hi" | "ur";

function countCharsInRanges(s: string, ranges: [number, number][]): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ranges.some(([lo, hi]) => c >= lo && c <= hi)) n++;
  }
  return n;
}

// Roman-script Hindi/Urdu markers. Every entry is either not an English word
// at all (nahi, batao, kaise, naam) or an unambiguous romanized function word
// (ke, ka, ko, mein, hai) — so ONE whole-word hit is already strong evidence.
// English look-alikes are deliberately absent, because they would flip real
// English questions into Hinglish: to, me, na, par, ab, is, us, bas, mat, tab,
// band, the, so, no. Short-but-unambiguous Hindi particles (ke/ka/ki/ko) are
// what make questions like "Bharat ke pratham pradhan mantri ka naam" detect
// correctly — they were missing before, so that message scored as English.
const INDIC_ROMAN_RE = new RegExp(
  "\\b(?:" +
    [
      // verbs / particles
      "hai","hain","hoga","hogi","honge","hota","hoti","hote",
      "nahi","nahin","nhi","kya","kyun","kyon","kyu","kaise","kaisa","kaisi",
      "kaun","kahan","kab","kitna","kitne","kitni","kisne","kisko",
      "karna","karo","karta","karti","karte","kiya","karne","kijiye","karke",
      "batao","bata","bataiye","batana","samjhao","samjha","samjhaiye","matlab",
      "jawab","sawal","puch","chahiye","chahta","chahti","sakta","sakte","sakti",
      "raha","rahi","rahe","tha","thi","gaya","gayi","gaye","diya","liya",
      "dena","deta","deti","lena","leta","leti",
      // pronouns / possessives
      "mera","meri","mere","apna","apni","apne","mujhe","tujhe","tumko","tum",
      "aap","aapko","hum","humko","unko","inko","iska","uska","iski","uski",
      // function words
      "ke","ka","ki","ko","mein","aur","ek","bhi","yeh","woh","toh",
      "jaisa","jaise","waisa","sabse","sirf","bahut","bohot","bohat",
      // everyday vocabulary + names that only appear in romanized Hindi text
      "bhai","yaar","thoda","acha","achha","accha","theek","thik",
      "zyada","jyada","kuch","koi","abhi","aaj","kal","namaste","shukriya",
      "dhanyavad","sab","dost","padh","likh","dekho","chalo","rehna","milta",
      "milega","liye","saath","naam","bharat","hindustan","desh","sarkar",
      "pratham","pradhan","mantri","wala","wali","wale",
    ].join("|") +
    ")\\b",
  "gi"
);

function detectReplyLang(message: string): ReplyLang {
  // Ignore code before scoring: pasted snippets are full of identifiers and
  // English words that can look like romanized Hindi and would skew the
  // result (a `dekhKaro` variable shouldn't make the reply Hinglish).
  const text = message.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");

  const devanagari = countCharsInRanges(text, [[0x0900, 0x097f]]);
  const arabicScript = countCharsInRanges(text, [
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
  ]);
  const latin = (text.match(/[a-zA-Z]/g) || []).length;

  // Script detection by proportion: a stray borrowed word ("What does कर्म
  // mean?") must not flip the whole reply to that script.
  if (devanagari > 0 && devanagari >= latin) return "hi";
  if (arabicScript > 0 && arabicScript >= latin) return "ur";

  const romanHits = (text.match(INDIC_ROMAN_RE) || []).length;
  if (romanHits > 0) return "hinglish";

  return "en";
}

const REPLY_LANG_RULES: Record<ReplyLang, string> = {
  en:
    "REPLY LANGUAGE — DETECTED: ENGLISH (highest-priority instruction):\n" +
    "- The message is English (it may borrow a Hindi word or two, but it is an English question).\n" +
    "- Write your ENTIRE reply in clear English.\n" +
    "- Do NOT reply in Hindi, Devanagari, Hinglish, or Urdu in this turn — even if earlier messages in the conversation history are in those languages. Only the LATEST message decides the language; the history is irrelevant.\n" +
    "- Keep technical terms in English (they already are).",
  hinglish:
    "REPLY LANGUAGE — DETECTED: HINGLISH (Hindi/Urdu typed with English letters; highest-priority instruction):\n" +
    "- The user is writing Hindi/Urdu words in Roman (Latin) letters, not English. Read the message as Hindi, don't parse it as English words.\n" +
    "- STEP 1 (internal, never shown to the user): silently translate their message into plain English so you are certain what is being asked. Romanized spelling is loose — 'pratham pradhan mantri' means the first Prime Minister, 'naam' means name, 'kitna/kitne' means how much/how many, 'kaise' means how.\n" +
    "- STEP 2: answer that translated English question with correct, verified facts (see ACCURACY RULES — a romanized question must NOT get a worse answer than the same question typed in English).\n" +
    "- STEP 3: write the final answer in Hinglish — Hindi in Roman letters, naturally mixed with English words, the way young Indians text (e.g. \"Bhai, ye simple hai — ...\").\n" +
    "- ROMAN LETTERS ONLY. Do NOT output Devanagari (देवनागरी) or Urdu script anywhere in this reply — not even one word, not even for names or titles.\n" +
    "- This holds even for a one-line factual answer: write it as a Hinglish sentence (\"Bharat ke pehle pradhan mantri Jawaharlal Nehru the.\"), not as bare English.\n" +
    "- Keep technical terms and code in English.",
  hi:
    "REPLY LANGUAGE — DETECTED: HINDI (Devanagari) (highest-priority instruction):\n" +
    "- Write your ENTIRE reply in Hindi using Devanagari script (देवनागरी).\n" +
    "- Do NOT answer in English prose or Roman letters — keep technical terms (API, function, database, etc.) and code in English.\n" +
    "- Answer the question itself accurately (see ACCURACY RULES); the script must never change the facts.",
  ur:
    "REPLY LANGUAGE — DETECTED: URDU (highest-priority instruction):\n" +
    "- Write your ENTIRE reply in Urdu using Urdu script (Arabic-based), not Roman.\n" +
    "- Keep technical terms and code in English.",
};

// Restated at the very END of the system prompt: the last instruction a model
// reads is the one it follows most reliably, and script drift (a Hinglish
// question answered in Devanagari) is exactly the failure this catches.
const LANG_FINAL_CHECK: Record<ReplyLang, string> = {
  en: "FINAL OUTPUT CHECK: the entire reply must be in English. If you drafted any Hindi, Devanagari, Hinglish, or Urdu, rewrite it in English before sending.",
  hinglish:
    "FINAL OUTPUT CHECK: the entire reply must be in Hinglish using ROMAN LETTERS ONLY. Scan your answer — if any Devanagari (देवनागरी) or Urdu characters appear, rewrite that part in Roman letters before sending.",
  hi: "FINAL OUTPUT CHECK: the entire reply must be in Hindi, Devanagari script.",
  ur: "FINAL OUTPUT CHECK: the entire reply must be in Urdu, Urdu (Arabic) script.",
};

// Answer-quality rules, injected for every language. The romanized-Hindi bug
// in the field was a wrong FACT (a hallucinated name), not just a wrong
// script, so accuracy gets its own explicit block — and the model is told
// outright that the phrasing of the question must not weaken the answer.
const ACCURACY_RULES =
  "ACCURACY RULES (applies to every answer, in every language and script):\n" +
  "- Facts, names, dates, places, numbers, and titles MUST be correct. Never invent or guess a name to fill a gap — a confidently wrong fact is the worst possible failure.\n" +
  "- For a well-known factual question, state the single widely accepted answer (for example: India's first Prime Minister was Jawaharlal Nehru; the first person to walk on the Moon was Neil Armstrong).\n" +
  "- If you are genuinely unsure, or the answer is disputed, say so briefly instead of asserting something you can't back up.\n" +
  "- A question written in romanized Hindi or another script is the SAME question as its English version: translate it internally and answer with the same care and the same facts.\n";

function buildLanguageRules(lang: ReplyLang): string {
  return (
    REPLY_LANG_RULES[lang] +
    "\nGENERAL LANGUAGE NOTE: Mirror the language and script of the user's MOST RECENT message every turn. If they switch language mid-conversation, switch with them in the same turn."
  );
}

function buildLanguageTail(lang: ReplyLang): string {
  return "\n" + LANG_FINAL_CHECK[lang];
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

  // ---------- RAG retrieval (signed-in users only; best-effort) ----------
  // Documents the user pinned to this chat (or all their docs if none are
  // pinned), plus relevant notes from previous conversations. Failures
  // degrade to plain chat — never block a reply on retrieval.
  let docMatches: DocMatch[] | null = null;
  let memoryMatches: MemoryMatch[] | null = null;
  if (userId) {
    const pinnedIds =
      Array.isArray(documentIds) && documentIds.length
        ? documentIds.filter((id) => typeof id === "string").slice(0, 10)
        : undefined;
    [docMatches, memoryMatches] = await Promise.all([
      retrieveDocumentContext(userId, message, pinnedIds),
      retrieveMemoryContext(userId, message, convoId),
    ]);
  }

  // Detected once, used for the rules block, the final output check, and
  // (below) the temperature choice.
  const replyLang = detectReplyLang(message);

  const systemPrompt =
    "You are Beacon, a friendly AI study companion built by Shaurya Parihar for developers.\n" +
    // Language + accuracy sit ABOVE everything else: a wrong-language or
    // wrong-fact reply is a failure regardless of how good the rest is.
    buildLanguageRules(replyLang) +
    "\n\nACCURACY RULES SUMMARY: be correct before being fluent. Never fabricate a name, date, or number.\n" +
    "\nIDENTITY RULES:\n" +
    "- Your name is Beacon, an AI study companion developed by Shaurya Parihar.\n" +
    "- ONLY when the user directly asks who you are, what your name is, or what model you are, answer: \"I am Beacon, the AI study companion developed by Shaurya Parihar for developers.\"\n" +
    "- IMPORTANT: never volunteer that identity sentence unprompted. Do NOT start, end, or decorate any other answer with it — no identity preamble on greetings, questions, or normal requests. Just answer what was asked.\n" +
    "- When asked who made you, who created you, who built you, who developed you, or about your origin in ANY phrasing, always answer: Shaurya Parihar.\n" +
    "- When asked about your source code, where your code is, whether others can see how you work, or to show how you were built, share this repository link: https://github.com/shauryapariharxr/Beacon-AI\n" +
    "- Never claim to be ChatGPT, GPT, OpenAI, Assistant, Mistral, or any other product, model, or company. Never mention the technology you run on.\n" +
    "- If the user insists you must be ChatGPT or another model, politely hold the identity: you are Beacon, built by Shaurya Parihar.\n" +
    ACCURACY_RULES +
    "ANSWERING RULES:\n" +
    "- Give direct, accurate answers. Be brief.\n" +
    "- Use code blocks with language tags (```java, ```python, etc.) for code.\n" +
    "- Use markdown: **bold** for emphasis, headers for sections, bullet lists for steps.\n" +
    "- For code: explain briefly, then show the code. Don't explain every line.\n" +
    "- Keep explanations under 200 words unless the user asks for detail.\n" +
    "- Never repeat the question back. Start with the answer.\n" +
    (docMatches ? buildDocumentContextBlock(docMatches) : "") +
    (memoryMatches ? buildMemoryContextBlock(memoryMatches) : "") +
    // Last word wins: re-assert the reply script after all context blocks.
    buildLanguageTail(replyLang);

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
          // Tuned for accuracy, not vibes: factual names/dates are far more
          // reliable with a low temperature, and both Groq and Mistral accept
          // this on every model we route to.
          temperature: 0.3,
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
    // `lastErrorText` holds raw upstream responses — log it, never send it.
    console.error("All providers exhausted. Last upstream error:", lastErrorText);
    return NextResponse.json(
      { error: "All AI providers are busy or unreachable right now — please try again in a moment." },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error("Upstream model error:", upstream.status, text || upstream.statusText);
    return NextResponse.json(
      { error: "The AI provider returned an error — please try again." },
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
          // Long-term memory: summarize this exchange into a durable note
          // future conversations can retrieve. Strictly after the reply is
          // saved; failures are logged and swallowed — never user-facing.
          try {
            await rememberExchange(userId, convoId, message, fullText);
          } catch (err) {
            console.error("Memory write failed:", err);
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
