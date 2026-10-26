// Step 5 — Evaluate: base model vs fine-tuned model on the held-out test set.
//
//   node --env-file=.env.local training/05-eval.mjs
//
// Sends every test.jsonl prompt to BOTH the fine-tuned endpoint and the base
// model (serverless Together base), under the same system prompt, and writes
// training/artifacts/eval-report.txt with:
//   - length/format consistency stats
//   - win/loss vs base judged blind by the OPENAI teacher (not the answer
//     teacher — a second opinion, still an LLM judge, so spot-check manually)
// Reminder: the endpoint keeps billing while this runs. 50 test prompts by
// default (small, quick) — pass a number for more/fewer.

import fs from "node:fs";
import path from "node:path";
import Together from "together-ai";
import { ensureDirs, readJsonl, callTeacher, sleep, BEACON_SYSTEM, ARTIFACTS_DIR, DATA_DIR } from "./lib.mjs";

const N = process.argv[2] ? parseInt(process.argv[2], 10) : 50;

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });
if (!process.env.TOGETHER_API_KEY) {
  console.error("Missing TOGETHER_API_KEY in .env.local");
  process.exit(1);
}

(async () => {
  ensureDirs();
  const ep = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "endpoint.json"), "utf8"));
  const test = readJsonl(path.join(DATA_DIR, "test.jsonl")).slice(0, N);
  if (test.length === 0) {
    console.error("test.jsonl is empty — run 02-curate.mjs first, or evaluate on valid.jsonl.");
    process.exit(1);
  }

  const baseModel = ep.baseModel; // serverless Together endpoint for the base
  const tunedModel = ep.callModel;
  console.log(`Comparing ${test.length} test prompts:\n  tuned: ${tunedModel}\n  base:  ${baseModel}\n`);

  const inference = new Together({ apiKey: process.env.TOGETHER_API_KEY, baseURL: "https://api-inference.together.ai/v1" });

  const chat = async (model, messages, maxTokens = 1024) => {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await inference.chat.completions.create({ model, messages, max_tokens: maxTokens, temperature: 0.6 });
        return r.choices?.[0]?.message?.content ?? "";
      } catch (err) {
        if (a === 2) { console.warn(`  chat failed on ${model}: ${String(err).slice(0, 100)}`); return ""; }
        await sleep(2000 * (a + 1));
      }
    }
    return "";
  };

  const judge = async (prompt, a, b) => {
    // Blind pairwise: A/B order shuffled per row to cancel position bias.
    const swap = Math.random() < 0.5;
    const first = swap ? b : a;
    const { content } = await callTeacher("openai", {
      system: "You are an impartial judge. Two answers to the same student question. Reply ONLY a JSON object {\"winner\":\"first\"|\"second\"|\"tie\",\"reason\":\"one line\"}.",
      user: `Question: ${prompt}\n\nAnswer A: ${first.slice(0, 3000)}\n\nAnswer B: ${a === first ? b : a}\n\nJudge which better helps the student (accuracy first, then clarity). JSON only.`,
      maxTokens: 150,
      temperature: 0,
    });
    const m = content.match(/\{[\s\S]*\}/);
    let parsed = {};
    try { parsed = JSON.parse(m?.[0] ?? "{}"); } catch { /* tie on parse failure */ }
    let winner = parsed.winner ?? "tie";
    if (swap) winner = winner === "first" ? "second" : winner === "second" ? "first" : "tie";
    return winner; // normalized to this order: firstAnswer=a (tuned), second=b (base)
  };

  let wins = 0, losses = 0, ties = 0, judged = 0;
  let tunedLen = 0, baseLen = 0;
  const lines = [];

  for (let i = 0; i < test.length; i++) {
    const messages = test[i].messages;
    const promptMsg = messages.find((m) => m.role === "user")?.content ?? "";
    const chatMessages = messages.filter((m) => m.role !== "assistant"); // system+user only

    const tuned = await chat(tunedModel, chatMessages);
    const base = await chat(baseModel, chatMessages);
    tunedLen += tuned.length; baseLen += base.length;
    // Reference answer (from distillation target) for eyeballing the report.
    const ref = messages.find((m) => m.role === "assistant")?.content ?? "";

    let winner = "skip";
    if (tuned && base) {
      winner = await judge(promptMsg, tuned, base);
      judged++;
      if (winner === "first") wins++; else if (winner === "second") losses++; else ties++;
    }
    lines.push(`--- [${i + 1}] winner=${winner}\nCATEGORY: ${test[i].category}\nQ: ${promptMsg}\nTUNED: ${tuned.slice(0, 700)}\nBASE: ${base.slice(0, 700)}\nREF: ${ref.slice(0, 400)}\n`);
    process.stdout.write(`  ${i + 1}/${test.length} (${wins}W/${losses}L/${ties}T/${judged} judged)\r`);
    await sleep(300);
  }

  const winRate = judged ? (wins / judged) : 0;
  const report = [
    `Beacon fine-tune eval — ${new Date().toISOString()}`,
    `model: ${tunedModel}`,
    `test prompts: ${test.length} (judged: ${judged})`,
    `tuned win rate vs base (LLM judge): ${(winRate * 100).toFixed(1)}%   [${wins}W / ${losses}L / ${ties}T]`,
    `avg answer length: tuned ${(tunedLen / test.length).toFixed(0)} chars vs base ${(baseLen / test.length).toFixed(0)}`,
    ``,
    `NOTE: an LLM judge approximates preference; spot-check rows below manually.`,
    ``,
    ...lines,
  ].join("\n");
  fs.writeFileSync(path.join(ARTIFACTS_DIR, "eval-report.txt"), report);
  console.log(`\n\nWin rate vs base: ${(winRate * 100).toFixed(1)}% — full report: training/artifacts/eval-report.txt`);
  console.log("If the tuned model disappoints: check data quality first (02), THEN more epochs or data.");
  console.log("When done evaluating, run 06-teardown.mjs to stop endpoint billing.");
})();
