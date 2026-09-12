import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, createSession } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
    const valid = await verifyPassword(password, passwordHash);

    if (!user || !valid) {
      // Constant-shape response regardless of which factor failed.
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email });
  } catch (err: any) {
    console.error("Login failed:", err);
    return NextResponse.json(
      { error: "Login couldn't complete — " + (err?.message || "server error") },
      { status: 500 }
    );
  }
}
