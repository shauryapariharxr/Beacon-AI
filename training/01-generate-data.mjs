// Step 1 — Generate the distillation dataset with OpenAI + Claude teachers.
//
//   node --env-file=.env.local training/01-generate-data.mjs [N]
//
// N = number of examples to keep (default 1000). Generation produces ~15%
// more candidates than N so curation can throw bad ones away.
//
// Design (based on distillation research):
// - Prompts are generated in seed batches across a task map (8 categories) so
//   coverage is deliberate, not whatever the teacher finds easy to write.
// - The two teachers alternate as PROMPT writers (diversity), but all ANSWERS
//   come from ONE teacher (openai) under one system rubric — mixing answer
//   styles from two teachers teaches the student an inconsistent voice.
// - A second-teacher review pass flags answers that are wrong/sycophantic/
//   incomplete; flagged ones are dropped by 02-curate.mjs.
// - Every record keeps a seedFamily id so 02 can split train/valid/test BY
//   FAMILY (no prompt-variant leakage across splits).

import fs from "node:fs";
import { callTeacher, parseJsonArray, readJsonl, writeJsonl, ensureDirs, sleep, printCost, BEACON_SYSTEM, DATA_DIR } from "./lib.mjs";

const TARGET = Math.max(1, parseInt(process.argv[2] ?? "1000", 10));
const CANDIDATES = Math.ceil(TARGET * 1.15);
const PROMPTS_PER_BATCH = 10;

const CATEGORY_POOL = [
  { key: "explain", brief: "Explain a concept clearly (science, math, history, economics, CS…)" },
  { key: "homework-check", brief: "Student shows a worked solution or claim that may contain an error; correct it politely with reasoning" },
  { key: "summarize", brief: "Summarize or extract key points from a passage the user pastes" },
  { key: "how-to", brief: "Step-by-step how-to for a concrete academic or study task" },
  { key: "compare", brief: "Compare/contrast two concepts a student might confuse" },
  { key: "structured", brief: "Produce a structured output: table, timeline, flashcards, checklist, or outline" },
  { key: "advice", brief: "Study planning, exam strategy, or learning-approach advice" },
  { key: "tricky", brief: "Question with a subtle trap: false premise, ambiguity needing clarification, or a request requiring a gentle boundary" },
];

const AUDIENCE_POOL = ["a 14-year-old", "a first-year university student", "someone self-studying at night", "a student preparing for tomorrow's exam", "a non-native English speaker", "a tired student who wants it short"];

const PROMPT_WRITER_SYSTEM = `You generate diverse STUDENT QUESTIONS for a study-assistant chatbot.
You will be given a category brief and an audience. Write EXACTLY ${PROMPTS_PER_BATCH} different user prompts that fit the brief.
Each prompt must sound like a real student typed it (1–4 sentences), be self-contained (no "see the passage above"),
and differ in intent from the others — not paraphrases. Output ONLY a JSON array of the prompt strings.`;

(async () => {
  ensureDirs();
  const rawFile = `${DATA_DIR}/raw.jsonl`;
  const existing = fs.existsSync(rawFile) ? readJsonl(rawFile) : [];
  const total = { openai: { input: 0, output: 0 }, anthropic: { input: 0, output: 0 } };
  const need = CANDIDATES - existing.length;
  const batches = Math.ceil(need / PROMPTS_PER_BATCH);
  console.log(`Target ${TARGET} kept / ~${CANDIDATES} candidates; ${existing.length} already raw → generating ${batches} prompt batches…`);

  // Track which family each raw record belongs to (persisted with the record).
  let familyCounter = existing.length ? Math.max(...existing.map((r) => r.seedFamily ?? 0)) : 0;

  for (let b = 0; b < batches; b++) {
    // Alternate prompt-writer between teachers and rotate category × audience
    // deterministically so coverage is spread evenly across the dataset.
    const writer = b % 2 === 0 ? "openai" : "anthropic";
    const category = CATEGORY_POOL[(b * 3) % CATEGORY_POOL.length];
    const audience = AUDIENCE_POOL[(b * 5) % AUDIENCE_POOL.length];

    let prompts;
    try {
      const { content, tokenUsage } = await callTeacher(writer, {
        system: PROMPT_WRITER_SYSTEM,
        user: `Category brief: ${category.brief}\nAudience: ${audience}\nWrite the JSON array now.`,
        maxTokens: 1200,
        temperature: 1.0,
      });
      total[writer].input += tokenUsage.input;
      total[writer].output += tokenUsage.output;
      prompts = parseJsonArray(content).filter((p) => typeof p === "string" && p.length >= 10 && p.length <= 600).slice(0, PROMPTS_PER_BATCH);
    } catch (err) {
      console.warn(`Prompt batch ${b + 1}/${batches} failed (${String(err).slice(0, 120)}) — skipping.`);
      continue;
    }

    // Answers: single-teacher voice (openai), under Beacon's own system prompt,
    // at a modest temperature so answers stay factual and consistent.
    for (const prompt of prompts) {
      const family = b; // every prompt from this batch shares a family
      try {
        const { content: answer, tokenUsage } = await callTeacher("openai", {
          system: BEACON_SYSTEM,
          user: prompt,
          maxTokens: 1200,
          temperature: 0.6,
        });
        total.openai.input += tokenUsage.input;
        total.openai.output += tokenUsage.output;

        // Review (the OTHER teacher): flag problems, don't propose a rewrite —
        // mixed-style rewrites become inconsistent targets.
        let review = null;
        try {
          const { content: reviewText, tokenUsage: rt } = await callTeacher("anthropic", {
            system: "You are a strict dataset reviewer. Reply ONLY a JSON object {\"verdict\":\"accept\"|\"reject\",\"reason\":\"...\"}.",
            user: `User question:\n${prompt}\n\nAssistant answer:\n${answer}\n\nReject if: factually wrong, refuses without cause, ignores the question, sycophantic agreement with a false premise, or leaks "As an AI" boilerplate.`,
            maxTokens: 200,
            temperature: 0,
          });
          total.anthropic.input += rt.input;
          total.anthropic.output += rt.output;
          const m = reviewText.match(/\{[\s\S]*\}/);
          review = m ? JSON.parse(m[0]) : null;
        } catch { /* review is best-effort; curator also filters */ }

        writeJsonl(rawFile, [{
          seedFamily: family,
          category: category.key,
          prompt,
          answer,
          reviewVerdict: review?.verdict ?? "unknown",
          reviewReason: review?.reason?.slice(0, 200) ?? null,
          teacher: "openai",
          minedAt: Date.now(),
        }]);
      } catch (err) {
        console.warn(`Answer failed for one prompt (${String(err).slice(0, 100)}) — skipping.`);
      }
    }
    process.stdout.write(`  batches ${b + 1}/${batches} — raw lines: ${readJsonl(rawFile).length}\n`);
    await sleep(500); // be polite to both APIs
  }

  const t = printCost("Generation", total);
  console.log(`Done. raw.jsonl now has ${readJsonl(rawFile).length} candidate examples (est. spend $${t.toFixed(2)}).`);
  console.log("Next: node --env-file=.env.local training/02-curate.mjs");
})();
