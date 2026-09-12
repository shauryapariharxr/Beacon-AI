import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/schema";
import { eq, asc, and } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const convo = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.userId, userId)));

    if (convo.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, params.id))
      .orderBy(asc(messages.createdAt));

    return NextResponse.json({ conversation: convo[0], messages: rows });
  } catch (err: any) {
    console.error("Conversation load failed:", err);
    return NextResponse.json(
      { error: "Couldn't load the conversation. " + (err?.message || "database error") },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const convo = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, params.id), eq(conversations.userId, userId)));

    if (convo.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Delete messages first, then the conversation itself.
    await db.delete(messages).where(eq(messages.conversationId, params.id));
    await db.delete(conversations).where(eq(conversations.id, params.id));

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Conversation delete failed:", err);
    return NextResponse.json(
      { error: "Couldn't delete the conversation. " + (err?.message || "database error") },
      { status: 500 }
    );
  }
}
