import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { consumeVerificationToken } from "@/lib/verification";

/**
 * Verification link target: /api/auth/verify?token=...
 * Marks the account verified and sends the user to the login page with a
 * flag the UI can pick up to show a success message.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000"}`;

  if (!token) {
    return NextResponse.redirect(`${base}/login?verified=invalid`);
  }

  const userId = await consumeVerificationToken(token);
  if (!userId) {
    return NextResponse.redirect(`${base}/login?verified=expired`);
  }

  await db
    .update(users)
    .set({ verifiedAt: Date.now() })
    .where(eq(users.id, userId));

  return NextResponse.redirect(`${base}/login?verified=1`);
}
