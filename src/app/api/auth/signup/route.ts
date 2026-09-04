import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword, createSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Valid email and a password of 8+ characters are required" },
      { status: 400 }
    );
  }

  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const id = nanoid();
  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    id,
    email,
    passwordHash,
    createdAt: Date.now(),
  });

  await createSession(id);
  return NextResponse.json({ id, email });
}
