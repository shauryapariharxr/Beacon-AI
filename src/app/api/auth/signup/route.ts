import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword, createSession } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { ensureFirebaseUser, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PASSWORD_LENGTH = 200; // bcrypt input cap guard (72-byte limit)

export async function POST(req: NextRequest) {
  try {
    // Throttle account creation per IP to blunt automated signup abuse.
    const rl = await rateLimit(clientKey(req, null), 5, 60 * 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many signup attempts — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { email, password, name } = await req.json();

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !EMAIL_RE.test(email) ||
      password.length < 8 ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return NextResponse.json(
        { error: "Valid email and a password of 8–200 characters are required" },
        { status: 400 }
      );
    }

    // Name is mandatory: trim, cap length, reject empties. Server-side
    // enforcement so bypassing the form's `required` attr gains nothing.
    let cleanName: string | null = null;
    if (typeof name === "string") {
      cleanName = name.trim().slice(0, 60);
      if (cleanName === "") cleanName = null;
    }
    if (!cleanName) {
      return NextResponse.json(
        { error: "Name is required to create an account" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.select().from(users).where(eq(users.email, normalizedEmail));

    if (existing.length > 0) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const id = nanoid();
    const passwordHash = await hashPassword(password);
    await db.insert(users).values({
      id,
      email: normalizedEmail,
      passwordHash,
      name: cleanName,
      verifiedAt: Date.now(), // no email verification: accounts are active immediately
      createdAt: Date.now(),
    });

    // Mirror the account into Firebase Auth (best-effort) so Firebase
    // password-reset emails work for this user right away.
    if (isFirebaseAdminConfigured()) {
      await ensureFirebaseUser(normalizedEmail, { password });
    }

    await createSession(id);
    return NextResponse.json({ id, email: normalizedEmail, name: cleanName });
  } catch (err: any) {
    console.error("Signup failed:", err);
    return NextResponse.json(
      { error: "Signup couldn't complete — please try again." },
      { status: 500 }
    );
  }
}
