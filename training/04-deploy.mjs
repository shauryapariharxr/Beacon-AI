// Step 4 — Deploy the fine-tuned model to a Together dedicated endpoint.
//
//   node --env-file=.env.local training/04-deploy.mjs
//
// WARNING printed loudly: a min_replicas=1 GPU endpoint bills per HOUR
// (~$5.49/h for H100-class hardware on Qwen3.5 9B). This is the most
// expensive part of the whole experiment — train (~$4) < serve (> $5/hour).
// Never leave the endpoint running: run 06-teardown.mjs when done.
//
// Writes training/artifacts/endpoint.json with the model string the app
// would call (project-slug/endpoint-name).

import fs from "node:fs";
import path from "node:path";
import Together from "together-ai";
import { ensureDirs, ARTIFACTS_DIR } from "./lib.mjs";

const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });
if (!process.env.TOGETHER_API_KEY) {
  console.error("Missing TOGETHER_API_KEY in .env.local");
  process.exit(1);
}

(async () => {
  ensureDirs();
  const jobMeta = JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, "job-latest.json"), "utf8"));
  const modelObjectId = jobMeta.modelObjectId;
  if (!modelObjectId) {
    console.error("job-latest.json has no modelObjectId — did 03-train.mjs finish?");
    process.exit(1);
  }

  const { project_id: projectId } = await together.whoami();
  const modelName = `projects/${projectId}/models/${modelObjectId}`;

  console.log("⚠️  A dedicated endpoint bills per GPU-hour while up (~$5.49/h H100-class).");
  console.log("⚠️  Run 06-teardown.mjs as soon as you're done evaluating.\n");
  await new Promise((r) => setTimeout(r, 2500));

  const endpointName = "beacon-finetune";
  const endpoint = await together.beta.endpoints.create({
    projectId,
    name: endpointName,
  });

  // Config describes the base model's serving settings; list available ones.
  let configId;
  try {
    const configs = await together.beta.models.listConfigs({ model: jobMeta.baseModel });
    configId = (configs ?? [])[0]?.id;
    if (!configId) throw new Error("no configs returned");
  } catch (err) {
    console.error("Could not resolve a serving config for the base model:", String(err).slice(0, 200));
    console.error("List them manually with:  tg beta models configs", jobMeta.baseModel);
    process.exit(1);
  }

  const deployment = await together.beta.endpoints.deployments.create(endpoint.id, {
    projectId,
    name: "prod",
    model: modelName,
    config: `projects/${projectId}/configs/${configId}`,
    autoscaling: { minReplicas: 1, maxReplicas: 1 },
  });
  await together.beta.endpoints.update(endpoint.id, {
    projectId,
    trafficSplit: [{ deploymentId: deployment.id, weight: 1 }],
  });

  // Poll until DEPLOYMENT_STATE_READY (or cap 25 min).
  const deadline = Date.now() + 25 * 60 * 1000;
  let dep = await together.beta.endpoints.deployments.retrieve(deployment.id, { projectId, endpointId: endpoint.id });
  while (!/READY|ERROR|FAILED/i.test(dep.status?.state ?? "")) {
    if (Date.now() > deadline) throw new Error(`Deployment still ${dep.status?.state} after 25 min`);
    process.stdout.write(`  ${new Date().toISOString().slice(11, 19)} ${dep.status?.state}\n`);
    await new Promise((r) => setTimeout(r, 20_000));
    dep = await together.beta.endpoints.deployments.retrieve(deployment.id, { projectId, endpointId: endpoint.id });
  }
  if (!/READY/i.test(dep.status?.state ?? "")) {
    console.error("Deployment failed:", JSON.stringify(dep.status, null, 2));
    process.exit(1);
  }

  const callModel = `${jobMeta.baseModel.includes("/") ? "" : ""}${projectId}/${endpointName}`;
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, "endpoint.json"),
    JSON.stringify({
      endpointId: endpoint.id,
      deploymentId: deployment.id,
      callModel,
      baseModel: jobMeta.baseModel,
      deployedAt: Date.now(),
    }, null, 2)
  );
  console.log(`\nEndpoint ready. Inference model string: ${callModel}`);
  console.log("Next: 05-eval.mjs (compare base vs tuned), then 06-teardown.mjs.");
})();
