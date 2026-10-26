// Step 6 — Teardown: DELETE the dedicated endpoint (stops hourly GPU billing).
//
//   node --env-file=.env.local training/06-teardown.mjs
//
// The fine-tuned model itself stays in your Together registry (job-latest.json
// keeps its IDs) — only the deployed endpoint is removed. Redeploying later
// is just 04-deploy.mjs again.

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
  const epFile = path.join(ARTIFACTS_DIR, "endpoint.json");
  if (!fs.existsSync(epFile)) {
    console.log("No endpoint.json — nothing to tear down.");
    process.exit(0);
  }
  const ep = JSON.parse(fs.readFileSync(epFile, "utf8"));

  await together.beta.endpoints.update(ep.endpointId, {
    projectId: (await together.whoami()).project_id,
    trafficSplit: [],
  });
  await together.beta.endpoints.delete(ep.endpointId);
  fs.rmSync(epFile);
  console.log(`Endpoint ${ep.endpointId} deleted. Billing for the GPU replica has stopped.`);
  console.log("The fine-tuned model remains in your registry (see artifacts/job-latest.json).");
})();
