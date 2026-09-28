import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";
import { getFirebaseUserByUid, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";

export async function GET() {
  const userId = await getSessionUserId();
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

  // no-store: the avatar/name live here, and a heuristically-cached copy
  // would keep showing stale profile data after a re-login.
  return NextResponse.json(
    { user: { id: user.id, email: user.email, name: user.name ?? null, avatarUrl: user.avatarUrl ?? null } },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
