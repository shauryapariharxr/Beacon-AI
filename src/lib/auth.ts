import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "session";

// Refresh the session cookie once this much of its 30-day validity remains.
// With /me sliding-refreshing on every authenticated call, an app opened
// even monthly never sees a login screen again.
export const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function getJwtSecret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32) {
    // In production a weak/missing JWT_SECRET lets anyone forge session
    // cookies — refuse to issue/verify sessions rather than silently
    // running with the dev fallback.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "JWT_SECRET is missing or too short (32+ chars required in production). Set it in your hosting provider's environment variables."
      );
    }
    return new TextEncoder().encode("dev-only-insecure-secret-change-me");
  }
  return new TextEncoder().encode(value);
}

const secret = getJwtSecret();

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(userId: string) {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function createSession(userId: string) {
  const token = await createSessionToken(userId);
  cookies().set(COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSession() {
  cookies().delete(COOKIE_NAME);
}

export async function getSessionInfo(): Promise<{
  userId: string | null;
  issuedAtMs: number | null;
}> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return { userId: null, issuedAtMs: null };
  try {
    const { payload } = await jwtVerify(token, secret);
    const issuedAt = payload.iat;
    return {
      userId: (payload.userId as string) ?? null,
      issuedAtMs: typeof issuedAt === "number" ? issuedAt * 1000 : null,
    };
  } catch {
    return { userId: null, issuedAtMs: null };
  }
}

export async function getSessionUserId(): Promise<string | null> {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return (payload.userId as string) ?? null;
  } catch {
    return null;
  }
}
