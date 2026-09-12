import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, createSession } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { emailVerificationConfigured, sendVerificationEmail } from "@/lib/email";
import { storeVerificationToken } from "@/lib/verification";

function baseUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  // Throttle login attempts per IP to slow password guessing.
  const rl = await rateLimit(clientKey(req, null), 10, 15 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many login attempts — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { email, password, resendVerification } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  let user: typeof users.$inferSelect | undefined;
  try {
    const rows = await db.select().from(users).where(eq(users.email, email));
    user = rows[0];
  } catch (err: any) {
    console.error("Login DB read failed:", err);
    return NextResponse.json(
      { error: "Couldn't reach the database. " + (err?.message || String(err)) },
      { status: 500 }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Correct credentials but unverified email — don't reveal account status
  // to the wrong person: only offer resend AFTER the password checks out.
  if (emailVerificationConfigured() && user.verifiedAt === null) {
    if (resendVerification) {
      const token = nanoid(32);
      await storeVerificationToken(user.id, token);
      const err = await sendVerificationEmail(email, `${baseUrl(req)}/api/auth/verify?token=${token}`);
      if (err) {
        return NextResponse.json({ error: err }, { status: 500 });
      }
      return NextResponse.json({ ok: true, verificationResent: true });
    }
    return NextResponse.json(
      { error: "Please verify your email before signing in. Check your inbox for the verification link.", needsVerification: true },
      { status: 403 }
    );
  }

  await createSession(user.id);
  return NextResponse.json({ id: user.id, email: user.email });
}
