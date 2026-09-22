// Documents API — RAG source management.
//   GET  /api/documents        list the user's uploads
//   POST /api/documents        ingest: multipart file upload OR JSON {title, text}
//   DELETE /api/documents?id=  remove a document (chunks cascade)
//
// All routes require a signed-in user (guests have no RAG). Body size is
// capped at ~4 MB (Vercel functions refuse larger request bodies anyway).

import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, documentChunks } from "@/lib/schema";
import { getSessionUserId } from "@/lib/auth";
import { rateLimit, clientKey } from "@/lib/rateLimit";
import {
  MAX_FILE_BYTES,
  detectKind,
  extractTextFromFile,
  chunkText,
} from "@/lib/rag";
import { hasEmbeddings, embed } from "@/lib/embeddings";

const DOC_LIMIT = { limit: 10, windowMs: 60 * 60_000 };
const MAX_TEXT_CHARS = 400_000;

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId));
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({
    documents: rows.map((d) => ({
      id: d.id,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      chunkCount: d.chunkCount,
      status: d.status,
      error: d.error,
      createdAt: d.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await rateLimit(clientKey(req, userId), DOC_LIMIT.limit, DOC_LIMIT.windowMs);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Upload limit reached — try again in ${rl.retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }
  if (!hasEmbeddings()) {
    return NextResponse.json(
      { error: "Document search is not configured on the server (missing MISTRAL_API_KEY)." },
      { status: 503 }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";

  try {
    let filename: string;
    let mimeType: string | null;
    let raw: Buffer;
    let kind: "pdf" | "text";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file provided." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `File too large — max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.` },
          { status: 413 }
        );
      }
      const detected = detectKind(file.name, file.type);
      if (!detected) {
        return NextResponse.json(
          { error: "Unsupported file type. Upload a PDF, TXT, MD, CSV or JSON file." },
          { status: 415 }
        );
      }
      kind = detected;
      filename = file.name;
      mimeType = file.type || null;
      raw = Buffer.from(await file.arrayBuffer());
    } else {
      // JSON paste mode (used by the chat composer's "paste notes" path).
      const body = await req.json().catch(() => null);
      const title = String(body?.title ?? "").trim();
      const text = String(body?.text ?? "");
      if (!title || !text.trim()) {
        return NextResponse.json({ error: "Title and text are required." }, { status: 400 });
      }
      if (text.length > MAX_TEXT_CHARS) {
        return NextResponse.json(
          { error: `Text too long — max ${MAX_TEXT_CHARS.toLocaleString()} characters.` },
          { status: 413 }
        );
      }
      filename = title;
      mimeType = "text/plain";
      raw = Buffer.from(text, "utf8");
      kind = "text";
    }

    // Extract → chunk → embed → insert. One transaction-ish flow; on any
    // failure the document row is recorded with status 'error' so the UI can
    // show what went wrong instead of silently losing the upload.
    const docId = nanoid();
    let text: string;
    let chunks: string[];
    try {
      text = (await extractTextFromFile(raw, kind)).slice(0, 400_000);
      chunks = chunkText(text);
    } catch (err: any) {
      console.error("Extraction failed:", err);
      await db.insert(documents).values({
        id: docId,
        userId,
        filename,
        mimeType,
        sizeBytes: raw.length,
        chunkCount: 0,
        status: "error",
        error: (err?.message || "Could not read the file").slice(0, 300),
        createdAt: Date.now(),
      });
      return NextResponse.json(
        { error: "Could not read that file. If it's a PDF it may be scanned images without a text layer." },
        { status: 422 }
      );
    }

    if (!chunks.length) {
      await db.insert(documents).values({
        id: docId,
        userId,
        filename,
        mimeType,
        sizeBytes: raw.length,
        chunkCount: 0,
        status: "error",
        error: "No extractable text",
        createdAt: Date.now(),
      });
      return NextResponse.json(
        { error: "That file has no extractable text (scanned PDFs need OCR)." },
        { status: 422 }
      );
    }

    const vectors = await embed(chunks);
    const now = Date.now();

    await db.insert(documents).values({
      id: docId,
      userId,
      filename,
      mimeType,
      sizeBytes: raw.length,
      chunkCount: chunks.length,
      status: "ready",
      createdAt: now,
    });
    // Batched multi-row insert — one round-trip instead of one per chunk.
    await db.insert(documentChunks).values(
      chunks.map((content, i) => ({
        id: nanoid(),
        documentId: docId,
        userId,
        chunkIndex: i,
        content,
        embedding: vectors[i],
        createdAt: now,
      }))
    );

    return NextResponse.json({
      document: {
        id: docId,
        filename,
        sizeBytes: raw.length,
        chunkCount: chunks.length,
        status: "ready",
        createdAt: now,
      },
    });
  } catch (err: any) {
    console.error("Document upload failed:", err);
    return NextResponse.json(
      { error: "Upload failed — please try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing document id." }, { status: 400 });

  const deleted = await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .returning({ id: documents.id });
  if (!deleted.length) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  // Chunks reference documents with ON DELETE CASCADE, but the raw-SQL
  // migration is the source of truth — clean up explicitly so removal is
  // correct even if the cascade isn't present in a given environment.
  await db.execute(sql`DELETE FROM document_chunks WHERE document_id = ${id}`);
  return NextResponse.json({ ok: true });
}
