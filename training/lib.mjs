// Shared helpers for the Beacon fine-tuning pipeline.
//
// Everything here is plain Node (no build step): run with
//   node --env-file=.env.local training/01-generate-data.mjs
// The --env-file flag loads .env.local the same way the Next.js app does,
// so the pipeline and the app always read identical credentials.
//
// Data flow across the scripts:
//   01-generate-data.mjs → training/data/raw.jsonl         (teacher answers)
//   02-curate.mjs        → training/data/train.jsonl       (curated + split)
//                          training/data/valid.jsonl
//                          training/data/test.jsonl
//   03-train.mjs         → Together fine-tune job → registry IDs in
//                          training/artifacts/job-latest.json
//   04-deploy.mjs        → dedicated endpoint → artifacts/endpoint.json
//   05-eval.mjs          → artifacts/eval-report.txt (base vs tuned side by side)
//   06-teardown.mjs      → stops endpoint billing (run this!)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TRAINING_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(TRAINING_DIR, "data");
export const ARTIFACTS_DIR = path.join(TRAINING_DIR, "artifacts");

export function ensureDirs() {
  for (const dir of [DATA_DIR, ARTIFACTS_DIR]) fs.mkdirSync(dir, { recursive: true });
}

/** Read a JSONL file into an array of parsed objects (skips blank lines). */
export function readJsonl(file) {
  const text = fs.readFileSync(file, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Append objects to a JSONL file (create/overwrite when fresh=true). */
export function writeJsonl(file, objects, { fresh = false } = {}) {
  if (fresh) fs.writeFileSync(file, "");
  fs.appendFileSync(file, objects.map((o) => JSON.stringify(o)).join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Costs (USD, October 2026) — update these if pricing changes.
// Deliberately centralized: every script prints what it spent via printCost().
// ---------------------------------------------------------------------------

export const TEACHER_COST_PER_1M = {
  openai: { input: 0.3, output: 1.2 }, // gpt-4o-mini-ish current rates
  anthropic: { input: 0.8, output: 4.0 }, // claude haiku-class rates
};

/**
 * Runs a chat turn against one teacher provider with tiny retries.
 * Returns { content, tokenUsage } where tokenUsage = { input, output }.
 */
export async function callTeacher(provider, { system, user, maxTokens = 1600, temperature = 0.7 }) {
  const keyName = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`Missing ${keyName} in .env.local`);

  const url =
    provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : "https://api.anthropic.com/v1/messages";

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider === "openai"
            ? { Authorization: `Bearer ${apiKey}` }
            : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
        },
        body: JSON.stringify(
          provider === "openai"
            ? {
                model: "gpt-4o-mini",
                max_tokens: maxTokens,
                temperature,
                messages: system
                  ? [{ role: "system", content: system }, { role: "user", content: user }]
                  : [{ role: "user", content: user }],
              }
            : {
                model: "claude-haiku-4-5",
                max_tokens: maxTokens,
                temperature,
                ...(system ? { system } : {}),
                messages: [{ role: "user", content: user }],
              }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // 429/5xx are retryable with a short backoff; anything else fails fast.
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`Teacher ${res.status}: ${body.slice(0, 300)}`);
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw new Error(`Teacher ${res.status}: ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const content =
        provider === "openai"
          ? data.choices?.[0]?.message?.content
          : data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (!content) throw new Error("Teacher returned empty content");
      const usage = data.usage ?? {};
      return {
        content,
        tokenUsage: { input: usage.input_tokens ?? usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? usage.output_tokens ?? 0 },
      };
    } catch (err) {
      lastErr = err;
      if (!String(err.message).match(/Teacher (429|5\d\d)/)) throw err;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Parse a JSON array out of a teacher response (tolerates code fences). */
export function parseJsonArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array found in teacher response");
  return JSON.parse(candidate.slice(start, end + 1));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function printCost(label, totalTokens) {
  const openai = (totalTokens.openai.input / 1e6) * TEACHER_COST_PER_1M.openai.input +
    (totalTokens.openai.output / 1e6) * TEACHER_COST_PER_1M.openai.output;
  const anthropic = (totalTokens.anthropic.input / 1e6) * TEACHER_COST_PER_1M.anthropic.input +
    (totalTokens.anthropic.output / 1e6) * TEACHER_COST_PER_1M.anthropic.output;
  const total = openai + anthropic;
  console.log(`${label} estimated spend: OpenAI $${openai.toFixed(3)} + Anthropic $${anthropic.toFixed(3)} = $${total.toFixed(3)}`);
  return total;
}

/** System prompt every Beacon answer is generated under — the app's voice. */
export const BEACON_SYSTEM = `You are Beacon, a friendly study assistant for school and university students.
Answer accurately and completely, in clear simple language, in the tone of a patient tutor.
Structure longer answers with short paragraphs or numbered steps. Never invent facts;
if you are unsure, say so briefly and explain how the student could check.`;
