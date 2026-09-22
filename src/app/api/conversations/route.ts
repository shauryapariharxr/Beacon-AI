import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ conversations: [] });

  try {
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt));

    return NextResponse.json({ conversations: rows });
  } catch (err: any) {
    console.error("Conversation list failed:", err);
    return NextResponse.json(
      { error: "Couldn't load conversations — try again in a moment." },
      { status: 500 }
    );
  }
}
