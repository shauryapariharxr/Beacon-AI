// Document generation — the replacement for the removed image feature.
//
// Flow for one turn:
//   1. isDocumentRequest(message) (auto mode) or the client's explicit format
//      picker decides this turn should produce a file.
//   2. draftDocument() asks the drafting model (same provider pool as chat,
//      non-streaming) for a tight JSON outline: title, subtitle, sections
//      with paragraphs and bullets. One schema feeds all three renderers.
//   3. renderDocument() turns that outline into real bytes — pdf-lib for
//      PDFs (embedded Noto fonts, no hope of host system fonts in
//      serverless), the `docx` library for Word, pptxgenjs for PowerPoint.
//
// Configure in .env.local: nothing new is needed — providers come from
// src/lib/providers.ts (GROQ/MISTRAL keys).

import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  Document as WordDocument,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import PptxGenJS from "pptxgenjs";
import { DOC_FONTS } from "./docFonts";
import {
  nextProviderAttempt,
  markProviderRateLimited,
  markProviderUnavailable,
  msUntilNextAvailable,
  providerCount,
} from "./providers";
import type { ModelKey } from "./models";
import { detectReplyLang, type ReplyLang } from "./answerPolicy";

export type DocFormat = "pdf" | "docx" | "pptx";

export const DOC_MIME: Record<DocFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function isDocFormat(v: unknown): v is DocFormat {
  return v === "pdf" || v === "docx" || v === "pptx";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Intent detection
// ---------------------------------------------------------------------------

/** Only explicit creation verbs count — "what is a PDF" must stay in chat. */
const DOC_CREATION_VERB =
  /\b(create|creates?|creating|generate|generates?|generating|make|makes?|making|write|writes?|writing|draft|drafts?|prepare|prepares?|prepare\w*|produce|build|design|compose|bana|banao|banado|banade|likh|likho|likhdo|dedo|do)\b/i;

const DOC_FORMAT_NOUN =
  /\b(pdfs?|word|docx?|document|documents|docs|report|reports|essay|essays|letter|letters|resume|cvs?|presentation|presentations|slides?|slide\s*deck|slide\s*decks|powerpoint|ppts?|pptx|assignment|assignments|proposal|proposals|agenda|minutes|summary|summaries|whitepaper|brochure|newsletter|case\s*study|project\s*report|cover\s*letter|recommendation\s*letter|note|notes|guide|study\s*guide|paper)\b/i;

// Words that, all alone, would make "guide"/"paper"/"note" over-fire on
// ordinary questions ("can you guide me?", "paper");
// the interrogative guard below already covers most of these.
const QUESTION_START =
  /^(how|why|when|where|who|is|are|can|could|should|does|do|did|explain|define|differen\w+)/i;

export function isDocumentRequest(message: string): boolean {
  const probe = message.trim();
  if (!probe || probe.length > 500) return false;
  if (QUESTION_START.test(probe) && !/\b(make|create|write|generate|draft|prepare|banao|likho)\b/i.test(probe)) {
    // "how do I write a resume" is a question about writing, not a
    // commission — no file. The second clause keeps "make me a study
    // guide on how democracy works" working: creation verb present.
    if (!DOC_CREATION_VERB.test(probe)) return false;
  }
  return DOC_CREATION_VERB.test(probe) && DOC_FORMAT_NOUN.test(probe);
}

/** Which office format the request is for, read from its words. PDF = default. */
export function detectDocFormat(message: string): DocFormat {
  if (/\b(ppts?|pptx|powerpoint|presentation|slides?|slide\s*deck)\b/i.test(message)) return "pptx";
  if (/\b(word|docx|editable|ms\s*word)\b/i.test(message)) return "docx";
  return "pdf";
}

// ---------------------------------------------------------------------------
// 2. Drafting (model → JSON outline)
// ---------------------------------------------------------------------------

export type DocSection = {
  heading: string;
  paragraphs: string[];
  bullets: string[];
};

export type DocDraft = {
  title: string;
  subtitle: string;
  sections: DocSection[];
};

const MAX_DRAFT_SECTIONS = 12;
const MAX_TEXT_PER_LINE = 500;

function clip(s: unknown, n: number): string {
  // Strip the markdown bold/italic the models sprinkle in — none of the
  // renderers can use inline emphasis, and asterisks in a PDF look like a bug.
  return String(s ?? "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

/**
 * Validate and normalize whatever the model returned. Everything is
 * clamped, never trusted: a section with no content, an 80-bullet list or
 * a hostile string would otherwise flow straight into a document.
 */
function normalizeDraft(raw: unknown): DocDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = clip(obj.title as unknown, 120);
  if (!title) return null;
  const subtitle = clip(obj.subtitle as unknown, 160);

  const sectionsOut: DocSection[] = [];
  const sectionsIn = Array.isArray(obj.sections) ? obj.sections : [];
  for (const s of sectionsIn.slice(0, MAX_DRAFT_SECTIONS)) {
    if (!s || typeof s !== "object") continue;
    const sec = s as Record<string, unknown>;
    const paragraphs = (Array.isArray(sec.paragraphs) ? sec.paragraphs : [])
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .slice(0, 4)
      .map((p) => clip(p, 900));
    const bullets = (Array.isArray(sec.bullets) ? sec.bullets : [])
      .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      .slice(0, 10)
      .map((b) => clip(b, MAX_TEXT_PER_LINE));
    const heading = clip(sec.heading as unknown, 110);
    if (!paragraphs.length && !bullets.length) continue;
    sectionsOut.push({ heading: heading || title, paragraphs, bullets });
  }
  if (!sectionsOut.length) return null;
  return { title, subtitle, sections: sectionsOut };
}

function extractJSON(text: string): unknown {
  // Models love wrapping JSON in ```json fences — peel them first.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const candidate = (fenced ?? text).trim();
  const start = candidate.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching close brace; a truncated reply then fails cleanly
  // at JSON.parse instead of being fed to the JSON parser as garbage.
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === "{") depth++;
    else if (candidate[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** One non-streaming completion through the rotating provider pool. */
async function completeOnce(
  messages: { role: string; content: string }[],
  modelKey: ModelKey
): Promise<string> {
  const target = nextProviderAttempt(modelKey);
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.apiKey}`,
      },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: target.model,
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        stream: false,
      }),
    });
    if (res.status === 429) {
      markProviderRateLimited(target);
      throw new RateLimitErr();
    }
    if (res.status === 403 || res.status === 404) {
      markProviderUnavailable(target, 10 * 60_000);
      throw new RateLimitErr();
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("Drafting upstream error:", res.status, body.slice(0, 200));
      throw new RateLimitErr();
    }
    const json: any = await res.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new RateLimitErr();
    return content;
  } catch (err: any) {
    if (err instanceof RateLimitErr) throw err;
    console.error(`Failed to reach ${target.providerName} for drafting:`, err?.message);
    throw new RateLimitErr();
  }
}

class RateLimitErr extends Error {
  constructor() {
    super("provider unavailable");
  }
}

/** Provider-retry loop around completeOnce: rotate / brief-wait, then give up. */
async function completeWithRotation(
  messages: { role: string; content: string }[],
  modelKey: ModelKey
): Promise<string> {
  const maxAttempts = Math.max(3, providerCount() * 2);
  let lastErr: RateLimitErr | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await completeOnce(messages, modelKey);
    } catch (err) {
      if (!(err instanceof RateLimitErr)) throw err;
      lastErr = err;
      const waitMs = msUntilNextAvailable();
      if (waitMs > 0 && waitMs <= 8_000) await sleep(waitMs + 150);
    }
  }
  throw lastErr ?? new RateLimitErr();
}

const LANG_DIRECTIVE: Record<ReplyLang, string> = {
  en: "Write the document in clear English.",
  hinglish:
    "The request is Hinglish (Hindi typed in Roman letters). Write the document in Hinglish — Roman/Latin letters ONLY, no Devanagari anywhere.",
  hi: "The request is in Hindi. Write the document in Hindi (Devanagari script).",
  ur: "The request is in Urdu. Write the document in Urdu script. (Note: the PDF renderer has no Arabic-script font — if format is pdf, fall back to Roman-letter Urdu for body text but keep the title Urdu.)",
};

/**
 * Ask the model for a structured outline and return it validated.
 * Throws a user-readable Error when drafting is impossible.
 */
export async function draftDocument(
  message: string,
  modelKey: ModelKey,
  format: DocFormat
): Promise<DocDraft> {
  const lang = detectReplyLang(message);
  const isSlides = format === "pptx";

  const system = [
    "You write detailed, correct, well-structured documents on the user's topic.",
    `TARGET FORMAT: ${format === "pptx" ? "PowerPoint presentation" : format === "docx" ? "Word document" : "PDF document"}.`,
    isSlides
      ? "Structure for slides: a title, and 5-9 sections; each section is one slide. Keep each bullet under 12 words — slides are read at a glance. paragraphs must be empty for slides."
      : "Structure: a title, and 4-10 sections, each with 1-2 short paragraphs and often 3-8 bullets. Facts must be accurate — never invent names, dates, or statistics.",
    "The WHOLE document content must total at most 700 words for pdf/docx, at most 150 words for pptx.",
    LANG_DIRECTIVE[lang],
    "Output ONLY a JSON object, no prose, no markdown fences, exactly in this shape:",
    '{"title": <string>, "subtitle": <optional string>, "sections": [{"heading": <string>, "paragraphs": [<string>], "bullets": [<string>]}]}',
    "Both paragraphs and bullets may be [] but a section must have at least one.",
  ].join(" ");

  const user = `Draft the document for this request:\n"""${message.trim().slice(0, 1000)}"""`;

  const first = await completeWithRotation(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    modelKey
  );

  let draft = normalizeDraft(extractJSON(first));
  if (!draft) {
    // One strict retry: a malformed outline is usually fence noise or a
    // JSON-key tangent that a terse reminder fixes outright.
    const retry = await completeWithRotation(
      [
        { role: "system", content: system },
        { role: "user", content: user },
        { role: "assistant", content: first.slice(0, 2000) },
        {
          role: "user",
          content: "That was not valid JSON matching the required shape. Return ONLY the corrected JSON object. No explanations.",
        },
      ],
      modelKey
    );
    draft = normalizeDraft(extractJSON(retry));
  }
  if (!draft) {
    throw new Error("The document draft came back malformed — try rephrasing and sending again.");
  }
  return draft;
}

// ---------------------------------------------------------------------------
// 3. Renderers
// ---------------------------------------------------------------------------

export type RenderedDoc = {
  bytes: Buffer;
  filename: string;
};

/** Filesystem-safe, self-describing filename from the draft title. */
export function slugFilename(draft: DocDraft, format: DocFormat): string {
  const ext = format;
  const base =
    draft.title
      .toLowerCase()
      // Slugify keeps only slug characters; Devanagari/Hinglish titles both
      // collapse here, so fall back rather than shipping an empty name.
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "beacon-document";
  return `${base}.${ext}`;
}

// --- PDF -------------------------------------------------------------------

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 62;
const BODY_SIZE = 11;
const LEADING = 16.2;

const DEVA_RE = /[\u0900-\u097F]/;

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

type PdfFont = Awaited<ReturnType<PDFDocument["embedFont"]>>;
type PdfFonts = {
  latinReg: PdfFont;
  latinBold: PdfFont;
  deva?: PdfFont | null;
};

// Greedy word-wrap against the real glyph metrics; pdf-lib has no layout
// engine. Lines longer than a page width are chopped (long unbroken
// strings — URLs — rare in drafts but not unheard of).
function wrap(text: string, font: PdfFonts["latinReg"], size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paraLine of text.split(/\n+/)) {
    const words = paraLine.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      try {
        if (font.widthOfTextAtSize(test, size) <= maxWidth) {
          line = test;
          continue;
        }
      } catch {
        // widthOfTextAtSize throws on glyphs the font lacks — fall through
        // and hard-chop the line rather than lose the text.
      }
      if (line) out.push(line);
      // Hard-chop words wider than the whole column.
      if (word.length > 1 && font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) chunk += ch;
          else {
            out.push(chunk);
            chunk = ch;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Pick the font that covers a string: Devanagari chunks need the Noto font. */
function fontFor(text: string, fonts: PdfFonts) {
  if (DEVA_RE.test(text) && fonts.deva) return fonts.deva;
  return fonts.latinReg;
}

async function renderPdf(draft: DocDraft, rendered: RenderedDoc): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fonts: PdfFonts = {
    latinReg: await pdf.embedFont(base64ToBytes(DOC_FONTS.latinRegular), { subset: true }),
    latinBold: await pdf.embedFont(base64ToBytes(DOC_FONTS.latinBold), { subset: true }),
  };
  // Devanagari is embedded only when actually needed — fontkit shaping
  // overhead plus ~100 KB of glyphs is pointless on English-only drafts.
  if (DEVA_RE.test(JSON.stringify(draft))) {
    fonts.deva = await pdf.embedFont(base64ToBytes(DOC_FONTS.devanagariRegular), { subset: true });
  }

  const ink = rgb(0.13, 0.12, 0.11);
  const muted = rgb(0.45, 0.42, 0.38);
  const lamp = rgb(0.91, 0.64, 0.24); // the app's amber

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPageIfNeeded = (room: number) => {
    if (y - room >= MARGIN) return;
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  };

  const drawLines = (
    text: string,
    opts: { size: number; font: PdfFonts["latinReg"]; color: typeof ink; gap: number; indent?: number }
  ) => {
    const f = opts.font;
    // A mixed-script paragraph picks the covering font per line via wrap()
    // below, but a decision up front avoids wrapping Devanagari with Latin
    // metrics (which overestimates widths and leaves ragged whitespace).
    const chosen = DEVA_RE.test(text) && fonts.deva ? fonts.deva : opts.font;
    const lines = wrap(text, chosen, opts.size, PAGE_W - MARGIN * 2 - (opts.indent ?? 0));
    for (const line of lines) {
      newPageIfNeeded(LEADING * (opts.size / BODY_SIZE));
      page.drawText(line, { x: MARGIN + (opts.indent ?? 0), y: y - opts.size, size: opts.size, font: chosen, color: opts.color });
      y -= opts.size * 1.45 + opts.gap;
    }
  };

  // Title block.
  const titleFont = fonts.latinBold;
  const titleChosen = DEVA_RE.test(draft.title) && fonts.deva ? fonts.deva : titleFont;
  for (const line of wrap(draft.title, titleChosen, 22, PAGE_W - MARGIN * 2)) {
    page.drawText(line, { x: MARGIN, y: y - 22, size: 22, font: titleChosen, color: ink });
    y -= 30;
  }
  y -= 6;
  if (draft.subtitle) {
    for (const line of wrap(draft.subtitle, fonts.latinReg, 12, PAGE_W - MARGIN * 2)) {
      page.drawText(line, { x: MARGIN, y: y - 12, size: 12, font: fonts.latinReg, color: muted });
      y -= 18;
    }
  }
  // Accent rule under the title — one touch of brand color, nothing more.
  page.drawRectangle({ x: MARGIN, y: y - 10, width: 64, height: 3, color: lamp });
  y -= 34;

  for (const sec of draft.sections) {
    newPageIfNeeded(60);
    y -= 14;
    const headChosen = DEVA_RE.test(sec.heading) && fonts.deva ? fonts.deva : fonts.latinBold;
    for (const line of wrap(sec.heading, headChosen, 15, PAGE_W - MARGIN * 2)) {
      newPageIfNeeded(LEADING);
      page.drawText(line, { x: MARGIN, y: y - 15, size: 15, font: headChosen, color: lamp });
      y -= 22;
    }
    for (const p of sec.paragraphs) {
      drawLines(p, { size: BODY_SIZE, font: fonts.latinReg, color: ink, gap: 4 });
    }
    for (const b of sec.bullets) {
      newPageIfNeeded(LEADING);
      page.drawText("•", { x: MARGIN + 2, y: y - BODY_SIZE, size: BODY_SIZE, font: fonts.latinReg, color: lamp });
      drawLines(b, { size: BODY_SIZE, font: fonts.latinReg, color: ink, gap: 2, indent: 16 });
    }
    y -= 6;
  }

  // Page numbers, every page after the first draw pass.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    if (pages.length < 2) return;
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: PAGE_W - MARGIN - 24,
      y: MARGIN - 22,
      size: 9,
      font: fonts.latinReg,
      color: muted,
    });
  });

  rendered.bytes = Buffer.from(await pdf.save());
}

// --- DOCX -------------------------------------------------------------------

async function renderDocx(draft: DocDraft, rendered: RenderedDoc): Promise<void> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: draft.title, bold: true, size: 44 })],
    })
  );
  if (draft.subtitle) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: draft.subtitle, size: 24, color: "595959" })],
      })
    );
  }

  for (const sec of draft.sections) {
    children.push(
      new Paragraph({
        spacing: { before: 280, after: 100 },
        children: [new TextRun({ text: sec.heading, bold: true, size: 30 })],
      })
    );
    for (const p of sec.paragraphs) {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: p, size: 22 })],
        })
      );
    }
    for (const b of sec.bullets) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: [new TextRun({ text: b, size: 22 })],
        })
      );
    }
  }

  const doc = new WordDocument({
    creator: "Beacon",
    title: draft.title,
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: [{ children }],
  });
  rendered.bytes = await Packer.toBuffer(doc);
}

// --- PPTX -------------------------------------------------------------------

async function renderPptx(draft: DocDraft, rendered: RenderedDoc): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  // Title slide. The layout constants mirror the chat UI's dark theme so a
  // deck shared straight from the app still reads as made here.
  const title = pptx.addSlide();
  title.background = { color: "17130E" };
  title.addText(draft.title, {
    x: 0.6,
    y: 2.1,
    w: 8.8,
    fontSize: 34,
    bold: true,
    color: "F4EDE3",
    fontFace: "Calibri",
  });
  if (draft.subtitle) {
    title.addText(draft.subtitle, {
      x: 0.6,
      y: 3.35,
      w: 8.8,
      fontSize: 16,
      color: "BFB4A6",
      fontFace: "Calibri",
    });
  }
  title.addShape(pptx.ShapeType.rect, {
    x: 0.6,
    y: 3.15,
    w: 0.9,
    h: 0.05,
    fill: { color: "E8A33D" },
  });
  title.addText("Made with Beacon", {
    x: 0.6,
    y: 6.7,
    w: 3,
    fontSize: 10,
    color: "8A8073",
  });

  for (const sec of draft.sections) {
    const slide = pptx.addSlide();
    slide.background = { color: "17130E" };
    slide.addText(sec.heading, {
      x: 0.6,
      y: 0.5,
      w: 8.8,
      fontSize: 24,
      bold: true,
      color: "E8A33D",
      fontFace: "Calibri",
    });
    const lines: { text: string; options?: object }[] = [];
    for (const p of sec.paragraphs) {
      // Slides: paragraphs get split on sentence boundaries so nothing over
      // runs off the card.
      const parts = p.match(/[^.!?]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [p];
      for (const s of parts) lines.push({ text: s, options: { bullet: false, breakLine: true } });
    }
    for (const b of sec.bullets) lines.push({ text: b, options: { bullet: { code: "2022" }, breakLine: true } });
    if (lines.length) {
      slide.addText(lines, {
        x: 0.6,
        y: 1.6,
        w: 8.8,
        h: 4.6,
        fontSize: 14,
        color: "F4EDE3",
        fontFace: "Calibri",
        valign: "top",
      });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  rendered.bytes = out as Buffer;
}

/**
 * Render the validated draft into real file bytes.
 * rendered is passed in-out to reuse one object across the format switch.
 */
export async function renderDocument(draft: DocDraft, format: DocFormat): Promise<RenderedDoc> {
  const rendered: RenderedDoc = { bytes: Buffer.alloc(0), filename: slugFilename(draft, format) };
  if (format === "pdf") await renderPdf(draft, rendered);
  else if (format === "docx") await renderDocx(draft, rendered);
  else await renderPptx(draft, rendered);
  if (!rendered.bytes.length) {
    throw new Error("The document came out empty — try rephrasing and sending again.");
  }
  return rendered;
}
