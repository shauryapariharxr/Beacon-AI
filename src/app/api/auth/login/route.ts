import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, createSession } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { ensureFirebaseUser, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Capability probe: tells the auth pages whether the server can verify
// Firebase tokens (service account set). No secrets returned.
export async function OPTIONS() {
  return NextResponse.json({ firebaseConfigured: isFirebaseAdminConfigured() });
}

export async function POST(req: NextRequest) {
  try {
    // Throttle login attempts per IP to slow password guessing.
    const rl = await rateLimit(clientKey(req, null), 10, 15 * 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many login attempts — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { email, password } = await req.json();

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    const normalizedEmail = email.trim().toLowerCase();

    let user: typeof users.$inferSelect | undefined;
    try {
      const rows = await db.select().from(users).where(eq(users.email, normalizedEmail));
      user = rows[0];
    } catch (err: any) {
      console.error("Login DB read failed:", err);
      return NextResponse.json(
        { error: "Couldn't reach the database. " + (err?.message || String(err)) },
        { status: 500 }
      );
    }

    const DUMMY_HASH = "$2a$10$C6UzMDM.H6dfI/f/IKcEe.Ie1sMU0mFPEKGgD8DwNiUyOQXgbSgAi"; // bcrypt of random data
    const passwordHash = user?.passwordHash ?? DUMMY_HASH;

    // Firebase-managed accounts (Google sign-in) have an unusable
    // "firebase:..." hash — route them to Google sign-in instead of
    // pretending a password login failed.
    if (user && user.passwordHash.startsWith("firebase:")) {
      return NextResponse.json(
        { error: "This account uses Google sign-in. Use the Continue with Google button." },
        { status: 403 }
        );
    }

    const valid = await verifyPassword(password, passwordHash);

    if (!user || !valid) {
      // Constant-shape response regardless of which factor failed.
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    // Mirror the account into Firebase (best-effort, non-blocking for the
    // login itself) so "Forgot password" emails work for legacy users too.
    if (isFirebaseAdminConfigured()) {
      await ensureFirebaseUser(normalizedEmail, { password });
    }

    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email, firebaseConfigured: isFirebaseAdminConfigured() });
  } catch (err: any) {
    console.error("Login failed:", err);
    return NextResponse.json(
      { error: "Login couldn't complete — " + (err?.message || "server error") },
      { status: 500 }
    );
  }
}
