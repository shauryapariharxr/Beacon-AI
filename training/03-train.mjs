// Step 3 — Train: upload the curated JSONL to Together and launch a LoRA SFT job.
//
//   node --env-file=.env.local training/03-train.mjs [epochs]
//
// epochs: default 3 (Together's quickstart default). Job states:
// pending → queued → running → uploading → completed | error | cancelled.
// Queue wait is typically under an hour; a ~1k-example run trains in minutes
// once running. On completion, registry IDs are saved to
// training/artifacts/job-latest.json for 04-deploy.mjs.
//
// Cost model: Together LoRA SFT ≈ $0.34/M training tokens with a $4 minimum
// per job — so this run will cost ~$4. Rerunning spawns a NEW billed job;
// the script refuses obvious duplicates by listing existing jobs first.

import fs from "node:fs";
import path from "node:path";
import Together from "together-ai";
import { ensureDirs, ARTIFACTS_DIR, DATA_DIR } from "./lib.mjs";

const EPOCHS = process.argv[2] ? parseInt(process.argv[2], 10) : 3;
const BASE_MODEL = "Qwen/Qwen3.5-9B"; // cheap band, LoRA-tunable, deployable
const SUFFIX = "beacon-distill";

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });
if (!process.env.TOGETHER_API_KEY) {
  console.error("Missing TOGETHER_API_KEY in .env.local");
  process.exit(1);
}

(async () => {
  ensureDirs();
  const trainFile = path.join(DATA_DIR, "train.jsonl");
  const validFile = path.join(DATA_DIR, "valid.jsonl");
  if (!fs.existsSync(trainFile)) {
    console.error("No train.jsonl — run 02-curate.mjs first.");
    process.exit(1);
  }

  // Upload (Together dedupes identical file contents automatically).
  console.log("Uploading train.jsonl…");
  let fileId;
  try {
    const f = await together.files.upload({
      file: fs.createReadStream(trainFile),
      purpose: "fine-tune",
    });
    fileId = f.id;
    console.log(`  file id: ${fileId}`);
  } catch (err) {
    console.error("Upload failed:", err.message);
    process.exit(1);
  }

  let validId = null;
  if (fs.existsSync(validFile)) {
    try {
      const f = await together.files.upload({
        file: fs.createReadStream(validFile),
        purpose: "fine-tune",
      });
      validId = f.id;
      console.log(`  valid file id: ${validId}`);
    } catch { /* valid set is optional for training */ }
  }

  // Poll file ingestion until COMPLETED (upload returns before validation).
  const waitForFile = async (id) => {
    for (let i = 0; i < 60; i++) {
      const meta = await together.files.retrieve(id);
      if (meta.processing_status === "COMPLETED") return true;
      if (meta.processing_status === "INVALID_FORMAT" || meta.processing_status === "FAILED") {
        console.error("Dataset rejected:", JSON.stringify(meta.validation_report ?? meta, null, 2));
        return false;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error("File processing timed out");
  };
  if (!(await waitForFile(fileId))) process.exit(1);
  if (validId) await waitForFile(validId);

  // Guard against accidental duplicate jobs.
  try {
    const existing = await together.fineTuning.list();
    const mine = (existing.data ?? []).filter((j) => j.status === "queued" || j.status === "running" || j.status === "pending");
    if (mine.length > 0) {
      console.warn(`You already have ${mine.length} active job(s): ${mine.map((j) => j.id).join(", ")}`);
      const go = process.argv.includes("--force");
      if (!go) {
        console.warn("Refusing to spawn a duplicate. Pass --force to proceed anyway.");
        process.exit(1);
      }
    }
  } catch { /* listing is best-effort */ }

  console.log(`Launching LoRA SFT on ${BASE_MODEL} (${EPOCHS} epochs)…`);
  const job = await together.fineTuning.create({
    training_file: fileId,
    ...(validId ? { validation_file: validId } : {}),
    model: BASE_MODEL,
    n_epochs: EPOCHS,
    n_checkpoints: 1,
    train_on_inputs: "auto", // mask prompt tokens from the loss
    lora: true,
    suffix: SUFFIX,
    learning_rate: 1e-5,
    warmup_ratio: 0,
  });
  console.log(`  job id: ${job.id}  (billed: ~$4 minimum)`);
  console.log("  monitor: https://api.together.ai fine-tuning dashboard");

  // Poll until terminal state (cap 6 hours — queue waits are usually < 1h).
  const terminal = new Set(["completed", "error", "cancelled"]);
  const deadline = Date.now() + 6 * 60 * 60 * 1000;
  let status = await together.fineTuning.retrieve(job.id);
  while (!terminal.has(status.status)) {
    if (Date.now() > deadline) throw new Error(`Job still ${status.status} after 6h`);
    process.stdout.write(`  ${new Date().toISOString().slice(11, 19)} ${status.status}\n`);
    await new Promise((r) => setTimeout(r, 60_000));
    status = await together.fineTuning.retrieve(job.id);
  }
  if (status.status !== "completed") {
    console.error(`Job ended with status: ${status.status}`);
    process.exit(1);
  }

  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "job-latest.json"),
    JSON.stringify({
      jobId: job.id,
      baseModel: BASE_MODEL,
      epochs: EPOCHS,
      modelObjectId: status.model_object_id ?? status.api_model_object_id,
      modelObjectName: status.model_object_name ?? status.api_model_object_name,
      finishedAt: Date.now(),
    }, null, 2)
  );
  console.log(`\nDone. Model object id: ${status.model_object_id ?? status.api_model_object_id}`);
  console.log("Next: node --env-file=.env.local training/04-deploy.mjs");
})();
