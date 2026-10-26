import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSessionInfo, createSessionToken, sessionCookieOptions, SESSION_REFRESH_WINDOW_MS } from "@/lib/auth";
import { getFirebaseUserByUid, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";

export async function GET() {
  const { userId, issuedAtMs } = await getSessionInfo();
  if (!userId) return NextResponse.json({ user: null });

  const rows = await db.select().from(users).where(eq(users.id, userId));
  const user = rows[0];
  if (!user) return NextResponse.json({ user: null });

  // Self-heal backfill: accounts that signed in with Google/GitHub BEFORE
  // avatar syncing existed have a Firebase uid but no photo URL stored, and
  // their 30-day session means they may not re-login for weeks. One cheap
  // Admin-SDK lookup on read fills the column once; from then on every
  // sign-in keeps it current (see /api/auth/firebase). Failures are logged
  // and swallowed — /me must never break the dashboard over a photo.
  if (!user.avatarUrl && user.firebaseUid && isFirebaseAdminConfigured()) {
    try {
      const fbUser = await getFirebaseUserByUid(user.firebaseUid);
      const photo =
        typeof fbUser?.photoURL === "string" && fbUser.photoURL.startsWith("https://")
          ? fbUser.photoURL
          : null;
      if (photo) {
        await db.update(users).set({ avatarUrl: photo }).where(eq(users.id, user.id));
        user.avatarUrl = photo;
      }
    } catch (err) {
      console.error("Avatar backfill failed:", err);
    }
  }

  // 30-day absolute sessions sent users back to the login page monthly. A
  // session older than (30 days - window) is refreshed to a full new window
  // here — /me runs on every app open, so active users never re-authenticate.
  const sessionAgeMs = issuedAtMs != null ? Date.now() - issuedAtMs : null;
  const shouldRefresh =
    sessionAgeMs != null && sessionAgeMs > 30 * 24 * 60 * 60 * 1000 - SESSION_REFRESH_WINDOW_MS;

  // no-store: the avatar/name live here, and a heuristically-cached copy
  // would keep showing stale profile data after a re-login.
  const res = NextResponse.json(
    { user: { id: user.id, email: user.email, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null } },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
  if (shouldRefresh) {
    const token = await createSessionToken(userId);
    res.cookies.set("session", token, sessionCookieOptions());
  }
  return res;
}
