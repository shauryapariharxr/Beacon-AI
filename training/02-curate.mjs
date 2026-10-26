// Step 2 — Curate raw.jsonl into train/valid/test JSONL splits.
//
//   node --env-file=.env.local training/02-curate.mjs [keep]
//
// keep = how many curated examples to target (default: all usable records).
//
// Curation rules (in order):
//   1. drop records whose reviewer verdict was "reject"
//   2. drop mechanically bad records (missing fields, absurd lengths,
//      non-https/leaky artifacts, duplicate answers)
//   3. deduplicate near-identical PROMPTS (normalized token overlap)
//   4. split train/valid/test 80/10/10 BY seedFamily — all prompts from the
//      same generation batch stay in one split, so no prompt-variant leakage
//   5. output OpenAI-style conversational JSONL: {"messages":[...]}
//      (Together accepts this format directly; system prompt is Beacon's own)

import fs from "node:fs";
import { readJsonl, writeJsonl, ensureDirs, BEACON_SYSTEM, DATA_DIR } from "./lib.mjs";

const KEEP = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;

const MIN_ANSWER = 40; // chars — shorter answers teach nothing
const MAX_ANSWER = 12_000;
const MIN_PROMPT = 10;

/** Normalized 3-gram Jaccard similarity for near-duplicate prompts. */
function trigrams(text) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
  const set = new Set();
  for (let i = 0; i < words.length - 2; i++) set.add(words.slice(i, i + 3).join(" "));
  return set;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

(async () => {
  ensureDirs();
  const raw = readJsonl(`${DATA_DIR}/raw.jsonl`);
  const seenPrompts = []; // arrays of trigram sets
  const seenAnswers = new Set();
  const kept = [];
  const dropReasons = {};

  const drop = (reason) => { dropReasons[reason] = (dropReasons[reason] ?? 0) + 1; };

  for (const r of raw) {
    if (kept.length >= KEEP) break;
    const prompt = (r.prompt ?? "").trim();
    const answer = (r.answer ?? "").trim();

    if (r.reviewVerdict === "reject") { drop("reviewer-reject"); continue; }
    if (prompt.length < MIN_PROMPT || answer.length < MIN_ANSWER || answer.length > MAX_ANSWER) {
      drop("length"); continue;
    }
    if (!r.prompt || !r.answer || /as an ai\b/i.test(answer)) { drop("artifacts"); continue; }

    const answerKey = answer.slice(0, 300);
    if (seenAnswers.has(answerKey)) { drop("dup-answer"); continue; }

    const tg = trigrams(prompt);
    if (seenPrompts.some((prev) => jaccard(prev, tg) > 0.55)) { drop("dup-prompt"); continue; }
    seenPrompts.push(tg);
    seenAnswers.add(answerKey);

    kept.push({
      seedFamily: r.seedFamily,
      category: r.category,
      messages: [
        { role: "system", content: BEACON_SYSTEM },
        { role: "user", content: prompt },
        { role: "assistant", content: answer },
      ],
    });
  }

  // Family-level split: group by seedFamily, then assign whole families to
  // splits so related prompts never straddle train/valid/test.
  const families = [...new Set(kept.map((k) => k.seedFamily))];
  families.sort(() => Math.random() - 0.5);
  const assign = new Map();
  families.forEach((f, i) => {
    const frac = i / Math.max(1, families.length);
    assign.set(f, frac < 0.8 ? "train" : frac < 0.9 ? "valid" : "test");
  });
  // Degenerate case (single family): fall back to record-level split.
  const fallback = (rec) => (assign.size <= 1 ? (Math.random() < 0.8 ? "train" : Math.random() < 0.5 ? "valid" : "test") : assign.get(rec.seedFamily));

  const splits = { train: [], valid: [], test: [] };
  for (const rec of kept) splits[fallback(rec)].push(rec);
  splits.valid = splits.valid.slice(0, 200); // cap valid so it doesn't dominate

  for (const [name, recs] of Object.entries(splits)) {
    writeJsonl(`${DATA_DIR}/${name}.jsonl`, recs.map(({ seedFamily, category, ...rest }) => rest), { fresh: true });
    console.log(`${name}.jsonl: ${recs.length} examples (${new Set(recs.map((r) => r.seedFamily)).size} families)`);
  }
  // Sidecar: map of seedFamily → split for auditing what went where.
  fs.writeFileSync(`${DATA_DIR}/split-map.json`, JSON.stringify(Object.fromEntries(assign), null, 2));

  console.log("\nDropped:", JSON.stringify(dropReasons));
  console.log(`Kept ${kept.length} of ${raw.length} raw records.`);
  console.log("Next: node --env-file=.env.local training/03-train.mjs");
})();
