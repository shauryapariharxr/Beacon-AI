import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { images, conversations } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";

// Serves one stored generated image. Ownership runs through the image's
// conversation join — without it any signed-in user could enumerate ids from
// other people's conversations and view private images (classic IDOR).
export const runtime = "nodejs";

// Beat back-end churn: same-origin only, and the browser can keep one image
// for the session's lifetime. Not private re: caching, since the file itself
// is invisible to other users.
const REVALIDATE = { "Cache-Control": "private, max-age=3600" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid image id" }, { status: 400 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to view this image." }, { status: 401 });
  }

  let row:
    | { mimeType: string; data: string }
    | undefined;
  try {
    const rows = await db
      .select({ mimeType: images.mimeType, data: images.data })
      .from(images)
      .innerJoin(conversations, eq(images.conversationId, conversations.id))
      .where(and(eq(images.id, id), eq(conversations.userId, userId)))
      .limit(1);
    row = rows[0];
  } catch {
    return NextResponse.json(
      { error: "Couldn't load that image — try again in a moment." },
      { status: 500 }
    );
  }
  if (!row) {
    // 404 both "doesn't exist" and "not yours" so the response doesn't confirm
    // which ids belong to somebody else.
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const bytes = Buffer.from(row.data, "base64");
  if (!bytes.length) {
    return NextResponse.json({ error: "Image data corrupted" }, { status: 500 });
  }
  const mimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);
  const mime = mimeTypes.has(row.mimeType) ? row.mimeType : "image/png";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      ...REVALIDATE,
    },
  });
}
