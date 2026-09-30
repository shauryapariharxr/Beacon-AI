import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth";

/**
 * Same-origin proxy for remote profile photos (Google's/GitHub's CDN).
 *
 * Why this exists: some users' browsers block the big public CDNs
 * (ad-blockers, privacy extensions, corporate/DNS filters). When the
 * direct <img src="https://lh3.googleusercontent.com/..."> fails, the
 * Avatar component silently falls back to the letter disc — which looks
 * like "the photo isn't fetching" even though the account sync worked.
 *
 * Routing the image through this endpoint keeps the fetch on our server
 * (already proven able to reach the CDN) and on our origin, so no browser
 * rule that targets googleusercontent.com can interfere.
 *
 * Security: signed-in users only (the photo is PII-ish), and the target URL
 * is restricted to an allow-list of the identity providers we actually use —
 * this must never become an open SSRF proxy.
 */

const ALLOWED_HOST_SUFFIXES = [
  ".googleusercontent.com", // Google profile photos
  ".githubusercontent.com", // GitHub avatars (avatars.githubusercontent.com)
  ".githubassets.com", // some GitHub avatar renditions
  ".licdn.cn", // (defensive) GitHub-in-China CDN alias
];

const MAX_BYTES = 512 * 1024; // 512 KiB is far above any real avatar size

export async function GET(req: NextRequest) {
  const uid = await getSessionUserId();
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const target = req.nextUrl.searchParams.get("u");
  if (!target) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only https urls are allowed" }, { status: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { Accept: "image/*" },
      // avatars are small and stable; one retry-worthy hop is enough
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      // Pass through a tiny placeholder so the <img> errors visibly and the
      // Avatar falls back to the initial (same as a blocked CDN would).
      return new NextResponse(null, { status: 404 });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return new NextResponse(null, { status: 404 });
    }

    // Buffer fully (small, bounded) so we can send an honest Content-Length.
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        // Photos are stable between sign-ins; safe to cache briefly in the
        // browser only (never shared/proxy caches — auth is per-cookie).
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("Avatar proxy fetch failed:", err);
    return new NextResponse(null, { status: 502 });
  }
}
