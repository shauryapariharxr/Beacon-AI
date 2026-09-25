import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";

// Must never be prerendered or cached: when the admin env vars are absent the
// `cookies()` call is skipped, Next would freeze this route as static, and the
// answer would be wrong forever.
export const dynamic = "force-dynamic";

/**
 * "Am I signed in as the admin?" — asked by the login page AFTER a successful
 * sign-in (Firebase/provider sign-ins never send the password to our server,
 * so the session cookie is the only reliable signal).
 *
 * Returns nothing but the answer: no `configured` flag, no credential warning.
 * Those would tell an anonymous visitor how the deployment is set up, and the
 * panel already gets them straight from the server component.
 */
export async function GET() {
  const session = await getAdminSession();
  return NextResponse.json({ admin: Boolean(session), email: session?.email ?? null });
}
