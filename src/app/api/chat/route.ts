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
  if (userId) {
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
  }

  // Pull prior turns for context if we have a saved conversation.
  let history: { role: string; content: string }[] = [];
  if (userId && convoId) {
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convoId));
    history = rows.map((r) => ({ role: r.role, content: r.content }));
  } else {
    history = [{ role: "user", content: message }];
  }

  const groqModel = MODELS[modelKey].groqModel;

  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: groqModel,
      messages: [
        {
          role: "system",
          content:
            "You are a friendly, patient AI tutor for students. Explain clearly, use examples, and check understanding.",
        },
        ...history,
      ],
      stream: true,
    }),
  });

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
        await db.insert(messages).values({
          id: nanoid(),
          conversationId: convoId,
          role: "assistant",
          content: fullText,
          createdAt: Date.now(),
        });
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
