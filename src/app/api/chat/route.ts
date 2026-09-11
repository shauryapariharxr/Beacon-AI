import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";
import { isValidModel, MODELS } from "@/lib/models";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message, modelKey, conversationId } = body as {
    message: string;
    modelKey: string;
    conversationId?: string;
  };

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }
  if (!isValidModel(modelKey)) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400 });
  }
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "Server is missing GROQ_API_KEY. Add it to .env.local." },
      { status: 500 }
    );
  }

  const userId = await getSessionUserId();
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
      history = rows.map((r) => ({ role: r.role, content: r.content }));
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

  const groqModel = MODELS[modelKey].groqModel;

  let upstream: Response;
  try {
    upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: groqModel,
        messages: [
          {
            role: "system",              content:
              "You are a concise AI tutor. Follow these rules:\n- Give direct, accurate answers. Be brief.\n- Use code blocks with language tags (```java, ```python, etc.) for code.\n- Use markdown: **bold** for emphasis, headers for sections, bullet lists for steps.\n- For code: explain briefly, then show the code. Don't explain every line.\n- Keep explanations under 200 words unless the user asks for detail.\n- Never repeat the question back. Start with the answer.",
          },
          ...history,
        ],
        stream: true,
      }),
    });
  } catch (err: any) {
    console.error("Failed to reach Groq:", err);
    return NextResponse.json(
      { error: "Couldn't reach Groq's API. Check your network/firewall and try again." },
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
