import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

// Server-side Firebase Admin. Configured via EITHER:
//   FIREBASE_SERVICE_ACCOUNT_JSON   — the whole service-account JSON on one line
// …or the three individual vars:
//   FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
// When nothing is set the helpers below are inert and the app keeps using
// the original email/password (bcrypt) auth untouched.
type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

function getServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      // Malformed JSON — fall through to the individual vars.
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }
  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return getServiceAccount() !== null;
}

let app: App | null = null;

function getAdminApp(): App | null {
  const account = getServiceAccount();
  if (!account) return null;
  if (!app) {
    app =
      getApps().find((a) => a.name === "beacon-admin") ??
      initializeApp({ credential: cert(account) }, "beacon-admin");
  }
  return app;
}

/** Verify a Firebase ID token from the client. Returns null when unconfigured or invalid. */
export async function verifyFirebaseIdToken(idToken: string): Promise<DecodedIdToken | null> {
  const a = getAdminApp();
  if (!a) return null;
  try {
    return await getAuth(a).verifyIdToken(idToken);
  } catch (err) {
    console.error("Firebase ID token verification failed:", err);
    return null;
  }
}

/**
 * Best-effort mirror of a legacy (bcrypt) account into Firebase Auth so
 * "Forgot password" emails work for users created before Firebase existed.
 * Creates the user when missing; optionally syncs the password. Never
 * throws — provisioning failures must not block login/signup.
 */
export async function ensureFirebaseUser(
  email: string,
  opts?: { password?: string }
): Promise<void> {
  const a = getAdminApp();
  if (!a) return;
  try {
    const user = await getAuth(a).getUserByEmail(email);
    if (opts?.password) {
      await getAuth(a).updateUser(user.uid, { password: opts.password, emailVerified: true });
    }
  } catch (err: any) {
    if (err?.code === "auth/user-not-found") {
      try {
        await getAuth(a).createUser({
          email,
          password: opts?.password,
          emailVerified: true,
        });
      } catch (e2: any) {
        // Already exists (race with signup) — harmless; anything else is
        // logged but still swallowed.
        if (e2?.code !== "auth/email-already-exists") {
          console.error("Firebase user provisioning failed:", e2);
        }
      }
    } else {
      console.error("Firebase user provisioning failed:", err);
    }
  }
}
