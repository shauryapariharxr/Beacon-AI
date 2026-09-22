import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createSession } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import { verifyFirebaseIdToken, isFirebaseAdminConfigured } from "@/lib/firebaseAdmin";

/**
 * Hybrid Firebase sign-in: the client authenticates with Firebase (Google
 * popup or Firebase email/password) and posts the resulting ID token here.
 * The server verifies the token, upserts a local users row (so chat
 * history, conversations and the JWT session keep working as before), and
 * issues the standard session cookie.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = await rateLimit(clientKey(req, null), 20, 15 * 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: `Too many attempts — try again in ${Math.ceil(rl.retryAfterSeconds / 60)} min.` },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { idToken } = await req.json();
    if (typeof idToken !== "string" || idToken.length < 20) {
      return NextResponse.json({ error: "A Firebase ID token is required" }, { status: 400 });
    }

    const decoded = await verifyFirebaseIdToken(idToken);
    if (!decoded) {
      // Unconfigured (no service account) and invalid/expired tokens both
      // return null — tell them apart so client devs aren't misled.
      const status = isFirebaseAdminConfigured() ? 401 : 503;
      const error = isFirebaseAdminConfigured()
        ? "Firebase sign-in token was invalid or expired — try again"
        : "Firebase sign-in is not configured on the server yet";
      return NextResponse.json({ error }, { status });
    }

    const email = decoded.email?.trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        { error: "Your Google account has no email — use email signup instead" },
        { status: 400 }
      );
    }

    const name =
      typeof decoded.name === "string" && decoded.name.trim()
        ? decoded.name.trim().slice(0, 60)
        : email.split("@")[0];

    const existingRows = await db.select().from(users).where(eq(users.email, email));
    let user = existingRows[0];

    if (user) {
      // SECURITY: a Firebase *email/password* account can be created for any
      // address without proving ownership. Only link an existing legacy
      // (bcrypt, never-linked) account when the token proves email control:
      // a Google/OAuth token, or a Firebase-verified email. Accounts we
      // provisioned ourselves (legacy login mirror) are created with
      // emailVerified: true, so they pass. Anything else gets 409 instead of
      // a session — otherwise anyone could take over an existing account by
      // signing up with its email in Firebase.
      const provider: string = decoded.firebase?.sign_in_provider ?? "";
      const isOAuth = provider !== "" && provider !== "password";
      if (!user.firebaseUid && !user.passwordHash.startsWith("firebase:") && !isOAuth && decoded.email_verified !== true) {
        return NextResponse.json(
          { error: "This email already has a Beacon account. Log in with your password first — after that, Google sign-in will work automatically." },
          { status: 409 }
        );
      }

      // Link the Firebase identity to the existing local account; fill in
      // the name for legacy accounts created before the name field existed.
      if (user.firebaseUid !== decoded.uid || !user.name) {
        const updates: Partial<typeof users.$inferInsert> = { firebaseUid: decoded.uid };
        if (!user.name) updates.name = name;
        await db.update(users).set(updates).where(eq(users.id, user.id));
        user = { ...user, ...updates } as typeof users.$inferSelect;
      }
    } else {
      // New Google user: create a local row. No password is ever stored —
      // passwordHash is NOT NULL, so it holds an unusable random value.
      const id = nanoid();
      const unusableHash = `firebase:${nanoid(32)}`;
      await db.insert(users).values({
        id,
        email,
        passwordHash: unusableHash,
        name,
        firebaseUid: decoded.uid,
        verifiedAt: Date.now(),
        createdAt: Date.now(),
      });
      user = (await db.select().from(users).where(eq(users.id, id)))[0];
    }

    await createSession(user.id);
    return NextResponse.json({ id: user.id, email: user.email, name: user.name });
  } catch (err: any) {
    console.error("Firebase auth exchange failed:", err);
    return NextResponse.json(
      { error: "Sign-in couldn't complete — please try again." },
      { status: 500 }
    );
  }
}
