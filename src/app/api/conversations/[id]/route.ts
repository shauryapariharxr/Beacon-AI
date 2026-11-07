import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, messages, generatedFiles } from "@/lib/schema";
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
      { error: "Couldn't load the conversation — try again in a moment." },
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

    // Delete messages and generated files first, then the conversation itself.
    // Sequential awaits used to run these as two separate transactions: a crash
    // between them (or a concurrent read) could see a conversation with no
    // messages, or orphaned rows. Generated files are keyed by conversation, so
    // they are removed here too instead of being stranded with the chat gone.
    await db.transaction(async (tx) => {
      await tx.delete(generatedFiles).where(eq(generatedFiles.conversationId, params.id));
      await tx.delete(messages).where(eq(messages.conversationId, params.id));
      await tx.delete(conversations).where(eq(conversations.id, params.id));
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Conversation delete failed:", err);
    return NextResponse.json(
      { error: "Couldn't delete the conversation — try again in a moment." },
      { status: 500 }
    );
  }
}
