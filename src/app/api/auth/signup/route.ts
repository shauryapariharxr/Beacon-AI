import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hashPassword, createSession } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { emailVerificationConfigured, sendVerificationEmail } from "@/lib/email";
import { storeVerificationToken } from "@/lib/verification";

function appBaseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  // Throttle account creation per IP to blunt automated signup abuse.
  const rl = await rateLimit(clientKey(req, null), 5, 60 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many signup attempts — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { email, password } = await req.json();

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: "Valid email and a password of 8+ characters are required" },
      { status: 400 }
    );
  }

  const existing = await db.select().from(users).where(eq(users.email, email));
  const verificationOn = emailVerificationConfigured();

  if (existing.length > 0) {
    const user = existing[0];
    // Unverified account: let them restart verification with the new
    // password instead of a dead-end "already exists".
    if (verificationOn && user.verifiedAt === null) {
      const passwordHash = await hashPassword(password);
      const token = nanoid(32);
      await storeVerificationToken(user.id, token);
      await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      const err = await sendVerificationEmail(email, `${appBaseUrl(req)}/api/auth/verify?token=${token}`);
      if (err) {
        return NextResponse.json({ error: err }, { status: 500 });
      }
      return NextResponse.json({ ok: true, needsVerification: true });
    }
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const id = nanoid();
  const passwordHash = await hashPassword(password);
  await db.insert(users).values({
    id,
    email,
    passwordHash,
    // With verification on, the account stays unverified until the link is
    // clicked; without email configured (local dev), verify immediately.
    verifiedAt: verificationOn ? null : Date.now(),
    createdAt: Date.now(),
  });

  if (verificationOn) {
    const token = nanoid(32);
    await storeVerificationToken(id, token);
    const err = await sendVerificationEmail(email, `${appBaseUrl(req)}/api/auth/verify?token=${token}`);
    if (err) {
      return NextResponse.json(
        { error: `Account created, but the verification email couldn't be sent: ${err}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, needsVerification: true });
  }

  await createSession(id);
  return NextResponse.json({ id, email });
}
