import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatedFiles, conversations } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUserId } from "@/lib/auth";
import { DOC_MIME, isDocFormat } from "@/lib/documents";

// Serves one generated document (PDF / DOCX / PPTX). Ownership runs through
// the file's conversation join — without it any signed-in user could
// enumerate ids from other people's conversations and download private files
// (classic IDOR).
export const runtime = "nodejs";

// Beat back-end churn: same-origin only, and the browser can keep one file
// for the session's lifetime. Not private re: caching — the file itself is
// invisible to other users.
const REVALIDATE = { "Cache-Control": "private, max-age=3600" };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
    return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Sign in to download this file." }, { status: 401 });
  }

  let row:
    | { filename: string; format: string; data: string }
    | undefined;
  try {
    const rows = await db
      .select({ filename: generatedFiles.filename, format: generatedFiles.format, data: generatedFiles.data })
      .from(generatedFiles)
      .innerJoin(conversations, eq(generatedFiles.conversationId, conversations.id))
      .where(and(eq(generatedFiles.id, id), eq(conversations.userId, userId)))
      .limit(1);
    row = rows[0];
  } catch {
    return NextResponse.json(
      { error: "Couldn't load that file — try again in a moment." },
      { status: 500 }
    );
  }
  if (!row) {
    // 404 both "doesn't exist" and "not yours" so the response doesn't confirm
    // which ids belong to somebody else.
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const bytes = Buffer.from(row.data, "base64");
  if (!bytes.length) {
    return NextResponse.json({ error: "File data corrupted" }, { status: 500 });
  }
  // Served type is derived from the stored format, never from the request —
  // the browser never gets to argue the Content-Type of a stored file.
  const mime = isDocFormat(row.format) ? DOC_MIME[row.format] : "application/octet-stream";
  // filename is server-generated (slugFilename) and ASCII-only by
  // construction, so it's safe to embed in a Content-Disposition header.
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${row.filename.replace(/[^\x20-\x7E]/g, "")}"`,
      ...REVALIDATE,
    },
  });
}
