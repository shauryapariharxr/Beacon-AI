import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ user: null });

  const rows = await db.select().from(users).where(eq(users.id, userId));
  const user = rows[0];
  if (!user) return NextResponse.json({ user: null });

  return NextResponse.json({ user: { id: user.id, email: user.email } });
}
