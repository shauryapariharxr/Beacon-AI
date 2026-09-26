import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { timingSafeEqual } from "crypto";
import { getJwtSecret, sessionCookieOptions } from "./auth";

// Admin access is deliberately a SEPARATE identity from the normal app
// session — the operator signs in on the ordinary /login form (handled by
// /api/auth/login, which detects the admin credentials and opens /admin
// instead of the chat dashboard; there is no separate admin login page):
//   - its own cookie (`admin_session`), so signing in as a regular Beacon
//     user never grants admin powers and signing out of chat never signs you
//     out of the panel;
//   - a `scope: "admin"` claim inside the JWT, so even if the two cookies got
//     mixed up a user token (which only carries `userId`) fails verification;
//   - credentials that live in environment variables only — never in the
//     database and never in the repository, which is public on GitHub.
//
// Configure in .env.local (and in your hosting provider's env vars):
//   ADMIN_EMAIL=you@example.com
//   ADMIN_PASSWORD=...                  (plaintext — simplest, nothing to escape)
//   ADMIN_PASSWORD_HASH=\$2a\$10\$...    (bcrypt hash)
//
// !! The backslashes above are not a typo. Next.js runs dotenv-expand over its
// .env files, so an UNESCAPED `ADMIN_PASSWORD_HASH=$2a$10$...` has each `$...`
// chunk treated as a variable reference and replaced with an empty string —
// the hash silently becomes a ~30-character stub and every login fails. Write
// each `$` as `\$` in .env.local. Hosting providers (Vercel etc.) inject env
// values raw, so paste the hash there WITHOUT backslashes.
//
// Generate a hash:
//   node -e "console.log(require('bcryptjs').hashSync(process.argv[1],10))" 'your-password'

const ADMIN_COOKIE = "admin_session";
const ADMIN_SCOPE = "admin";
// Shorter than a user session on purpose: the panel can read every user's
// questions, so a stolen cookie should go stale the same working day.
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // Length is not a secret worth defending here, and timingSafeEqual throws
  // on mismatched sizes — so compare only when the shapes line up.
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** The registered admin email, normalized (trim + lowercase). */
export function configuredAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
}

// A bcrypt hash is exactly 60 chars: $2a$10$ + 53 chars of salt+digest.
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** True when ADMIN_EMAIL plus a password (hash or plaintext) are both set. */
export function isAdminConfigured(): boolean {
  return (
    configuredAdminEmail().length > 0 &&
    Boolean(process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD)
  );
}

/**
 * Non-null when the credentials are present but shaped wrong. This exists
 * because a broken credential is INDISTINGUISHABLE from a wrong password at
 * the login form (both just say "Invalid email or password"), and the two
 * ways it happens are both easy to miss:
 *   1. a plaintext password pasted into ADMIN_PASSWORD_HASH, and
 *   2. an unescaped hash in .env.local, shredded by dotenv-expand.
 * The panel shows this string so the operator gets told what to fix.
 */
export function adminConfigWarning(): string | null {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) return null; // plaintext-only or unset — nothing to warn about
  if (BCRYPT_RE.test(hash)) return null;
  if (process.env.ADMIN_PASSWORD) return null; // valid plaintext takes over
  // Deliberately avoids literal backslashes in the prose: this string is
  // rendered in the panel and escaping it correctly is easy to get wrong.
  return (
    "ADMIN_PASSWORD_HASH is set but is not a valid bcrypt hash (expects 60 characters beginning with the $2a$ or $2b$ prefix), " +
    "so its value is being treated as a plaintext password — sign-in still works. Two likely causes: a plaintext password was pasted " +
    "into the hash variable, or an unescaped hash lost its dollar-sign chunks to .env variable expansion (in .env.local, put a " +
    "backslash before each dollar sign). Rename the variable to ADMIN_PASSWORD to silence this warning."
  );
}

/**
 * Check an email/password pair against the configured admin credentials.
 * Both factors are always evaluated (no short-circuit) so a wrong email and a
 * wrong password cost the same and can't be told apart by timing.
 */
export async function verifyAdminCredentials(email: string, password: string): Promise<boolean> {
  const expectedEmail = configuredAdminEmail();
  if (!expectedEmail) return false;

  const emailOk = safeEqual((email || "").trim().toLowerCase(), expectedEmail);

  const hash = process.env.ADMIN_PASSWORD_HASH;
  const plain = process.env.ADMIN_PASSWORD;
  let passwordOk = false;

  if (hash && BCRYPT_RE.test(hash)) {
    passwordOk = await bcrypt.compare(password || "", hash);
  } else if (plain) {
    passwordOk = safeEqual(password || "", plain);
  } else if (hash) {
    // Present but not a bcrypt hash. The overwhelmingly likely intent is
    // "this is the password", so honour it and let adminConfigWarning() tell
    // the operator to fix the variable. Without this, a plaintext value in
    // the hash slot can never match anything (bcrypt.compare only ever
    // returns false for a malformed hash).
    passwordOk = safeEqual(password || "", hash);
  }

  return emailOk && passwordOk;
}

export async function createAdminSession(email: string) {
  const token = await new SignJWT({ scope: ADMIN_SCOPE, email: email.trim().toLowerCase() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_SECONDS}s`)
    .sign(getJwtSecret());

  cookies().set(ADMIN_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: ADMIN_SESSION_SECONDS,
  });
}

export function clearAdminSession() {
  cookies().delete(ADMIN_COOKIE);
}

/** Resolve the current admin session, or null when not signed in as admin. */
export async function getAdminSession(): Promise<{ email: string } | null> {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // The scope check is what keeps an ordinary user session token (which has
    // no scope) from ever being accepted as an admin one.
    if (payload.scope !== ADMIN_SCOPE) return null;
    const email = String(payload.email ?? "");
    // The token must name the CURRENTLY registered admin email. Without this
    // a cookie minted before the operator rotated ADMIN_EMAIL (or removed a
    // co-admin's address) would keep full panel access until its 8h expiry —
    // the panel would then be reachable without the registered credentials.
    const expected = configuredAdminEmail();
    if (expected && email !== expected) return null;
    return { email };
  } catch {
    return null;
  }
}
