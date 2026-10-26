# Fine-tune Beacon's own model (distillation pipeline)

This directory takes Beacon's domain (student questions) and the answer style
you want, generates ~1,000 examples with **OpenAI + Claude** as teachers, then
**fine-tunes Qwen3.5-9B** (LoRA) on Together AI to imitate that style. The
result is your own model answering like the big ones.

⚠️ Read [COSTS](#costs) before running — training is cheap (~$4); the
deployed endpoint is NOT (~$5.49/GPU-hour while up).

## Setup

Add three keys to `.env.local` (same file the app already uses):

```
OPENAI_API_KEY=sk-...        # teacher 1 (answers + eval judge)
ANTHROPIC_API_KEY=sk-ant-... # teacher 2 (prompt diversity + review)
TOGETHER_API_KEY=...         # training + serving host
```

## The pipeline

Run each step in order; every script is resumable and refuses to duplicate work.

```bash
# 1. Generate data: prompts in 8 task categories from both teachers,
#    answers from OpenAI under Beacon's system prompt, review pass by Claude.
node --env-file=.env.local training/01-generate-data.mjs 1000

# 2. Curate: drop reviewer-rejected/duplicate/degenerate records, split
#    80/10/10 BY seed-family (no leakage), output train/valid/test.jsonl
node --env-file=.env.local training/02-curate.mjs

# 3. Train: upload JSONL, launch LoRA SFT on Qwen/Qwen3.5-9B (~$4, 3 epochs).
#    Waits through the queue (usually < 1h) and saves registry IDs.
node --env-file=.env.local training/03-train.mjs

# 4. Deploy: stand up the dedicated endpoint. ⚠️ BILLS HOURLY.
node --env-file=.env.local training/04-deploy.mjs

# 5. Evaluate: blind pairwise tuned-vs-base on held-out prompts.
node --env-file=.env.local training/05-eval.mjs 50

# 6. Teardown — ALWAYS run this when done evaluating.
node --env-file=.env.local training/06-teardown.mjs
```

## Costs

| Step | Cost |
|---|---|
| Data generation (~1.15k candidates) | ~$1–3 (gpt-4o-mini + claude-haiku) |
| LoRA SFT training (3 epochs, ~1M tokens) | ~$4 (Together minimum) |
| Endpoint up while evaluating | ~$5.49 **per hour** |
| Total for one careful run | **~$10–12** |

Keep the endpoint up minutes, not days.

## Wiring the tuned model into Beacon (only if it WINS eval)

Once the tuned model beats the base in step 5 and you want it live:

1. Deploy the endpoint (04) and keep `training/artifacts/endpoint.json`.
2. Add a provider entry in `src/lib/providers.ts`:
   ```ts
   {
     name: "together",
     baseUrl: "https://api-inference.together.ai/v1",
     models: { flash: "<callModel>", smart: "<callModel>", coder: "<callModel>" },
     collectKeys: () => (process.env.TOGETHER_API_KEY ? [process.env.TOGETHER_API_KEY] : []),
   }
   ```
   `callModel` is the `project-slug/beacon-finetune` string.
3. Add `TOGETHER_API_KEY=...` (already there from training) and rotate your
   app's provider pool to prefer it.

Note an important expectation: SFT on ~1k examples teaches **style, format,
persona** — not GPT-level general capability. The realistic, affordable win
is a Beacon-branded voice that beats the base model on *your* eval prompts.

## Honest limits ("train my model like OpenAI and Claude")

Training a model that *matches* GPT/Claude requires (a) much more data,
(b) much more compute, and (c) a research team. This pipeline is the correct,
affordable *first rung* — the same shape real distillation programs use,
scaled to a $10 experiment. Scaling paths from here: 5k–10k examples
(data gen cost scales linearly), DPO on preference pairs, then
preference-tuning with real user data from your own chat history.

## Troubleshooting

- `file is not valid for fine-tuning` → 01/02 wrote malformed JSONL; rerun 02
  (it rebuilds the splits from raw.jsonl without re-spending teacher tokens).
- Job stuck in `queued` > 1h → normal during Together peak; the script waits.
- 429 from teachers → script retries with backoff; if rate limits persist, run
  01 with a smaller N and let it resume later (it appends, never restarts).
- Endpoint deploy fails on config ID → list valid ones manually with
  `tg beta models configs Qwen/Qwen3.5-9B` and patch 04-deploy.mjs.
