import {
  getApps,
  initializeApp,
  type FirebaseApp,
} from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
  type Auth,
} from "firebase/auth";

// Client-side Firebase config. All values are public (they ship to the
// browser), but the app degrades gracefully: when any are missing the auth
// pages simply hide the Google button / forgot-password link and fall back
// to the original email/password API.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
);

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured) return null;
  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
  }
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseApp();
  return a ? getAuth(a) : null;
}

// ---------- Sign-in helpers (all throw with a readable message) ----------

function mapAuthError(err: any): Error {
  const code = typeof err?.code === "string" ? err.code.replace("auth/", "") : "";
  const messages: Record<string, string> = {
    "invalid-credential": "Incorrect email or password.",
    "wrong-password": "Incorrect email or password.",
    "user-not-found": "No account with this email — create one below.",
    "email-already-in-use": "An account with this email already exists — log in instead.",
    "weak-password": "Password must be at least 6 characters.",
    "too-many-requests": "Too many attempts — try again in a few minutes.",
    "popup-closed-by-user": "Google sign-in was cancelled.",
    "cancelled-popup-request": "Google sign-in was cancelled.",
    "network-request-failed": "Network error — check your connection.",
    "operation-not-allowed": "This sign-in method isn't enabled in the Firebase console yet.",
    "unauthorized-domain": "This domain isn't authorized — add it under Firebase Authentication → Settings → Authorized domains.",
    "configuration-not-found": "Sign-in isn't configured in the Firebase console yet.",
    "invalid-api-key": "Firebase API key is invalid — check the environment config.",
    "api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase API key is invalid — check the environment config.",
  };
  // Attach the raw code so callers can react (e.g. fall back to legacy auth).
  const mapped = new Error(messages[code] || err?.message || "Something went wrong");
  (mapped as any).code = code;
  return mapped;
}

/** Open the Google popup and return a fresh ID token. */
export async function firebaseGoogleIdToken(): Promise<string> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  try {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    return await cred.user.getIdToken();
  } catch (err) {
    throw mapAuthError(err);
  }
}

/** Open the GitHub popup and return a fresh ID token. */
export async function firebaseGithubIdToken(): Promise<string> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  try {
    const cred = await signInWithPopup(auth, new GithubAuthProvider());
    return await cred.user.getIdToken();
  } catch (err: any) {
    // Same email already linked through Google — tell the user which one to use.
    const code = typeof err?.code === "string" ? err.code : "";
    if (code === "auth/account-exists-with-different-credential") {
      throw new Error(
        "An account with this email already exists via Google — sign in with Google instead."
      );
    }
    throw mapAuthError(err);
  }
}

/** Firebase email/password sign-in — returns an ID token. */
export async function firebaseEmailPasswordIdToken(
  email: string,
  password: string
): Promise<string> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return await cred.user.getIdToken();
  } catch (err) {
    throw mapAuthError(err);
  }
}

/** Create a Firebase email/password account with a display name. */
export async function firebaseSignUpIdToken(
  name: string,
  email: string,
  password: string
): Promise<string> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    return await cred.user.getIdToken();
  } catch (err) {
    throw mapAuthError(err);
  }
}

/** Send a Firebase password-reset email. Resolves even for unknown emails (anti-enumeration). */
export async function firebaseSendPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) throw new Error("Firebase is not configured");
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err: any) {
    // user-not-found is intentionally swallowed: don't reveal which emails exist.
    const code = typeof err?.code === "string" ? err.code : "";
    if (code !== "auth/user-not-found") throw mapAuthError(err);
  }
}
