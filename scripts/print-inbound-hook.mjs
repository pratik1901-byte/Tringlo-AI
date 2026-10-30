// ============================================================
// Tringlo AI — print a workspace's inbound on-start hook URL
// ============================================================
//
// Sarvam's on-start hook is configured in its dashboard, on the agent. There
// is no API for it, so the URL has to be pasted in by hand — and it carries
// the workspace's webhook token, which must never travel to a browser.
//
// This prints it on the server, for the operator sitting at the machine.
//
//   node scripts/print-inbound-hook.mjs
//
// The token is secret: anyone holding it can ask this workspace for a caller's
// context. Do not paste the URL anywhere but the agent's hook configuration.
// ============================================================

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dbFile = path.join(root, "data", "database.json");

if (!fs.existsSync(dbFile)) {
  console.error("No database found at data/database.json. Run this from the project root.");
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(dbFile, "utf8"));
const base = (db.webhookBaseUrl || "").replace(/\/+$/, "");

if (!base) {
  console.error("No public address is registered yet. Start the dev server (npm run dev) so the tunnel registers one.");
  process.exit(1);
}

const tenants = new Map((db.tenants ?? []).map((tenant) => [tenant.id, tenant.name]));
const configs = db.providerConfigs ?? [];
const lines = db.inboundSettings ?? [];

if (configs.length === 0) {
  console.error("No workspace has a voice provider configured yet.");
  process.exit(1);
}

console.log(`\nPublic address: ${base}`);
console.log("(A quick tunnel's address changes on every restart. Run scripts/setup-named-tunnel.ps1 for one that does not.)\n");

for (const config of configs) {
  const name = tenants.get(config.tenantId) ?? config.tenantId;
  const line = lines.find((entry) => entry.tenantId === config.tenantId);

  console.log(`── ${name} ──`);
  if (!line?.enabled || !line.deploymentId) {
    console.log("   Inbound is off for this workspace; no hook is needed.\n");
    continue;
  }

  console.log(`   Deployment: ${line.deploymentId}`);
  console.log("   On-start hook URL — paste into the agent's on-start hook in Sarvam:");
  console.log(`   ${base}/api/webhooks/sarvam/inbound/context?k=${config.webhookToken}`);
  console.log("   Method: POST. Send the caller's number (user_phone_number) and deployment_id.");
  console.log("   Map the response fields onto the agent's variables of the same names.\n");
}

console.log("Keep these URLs out of email, chat and the browser: each one is a workspace's key.\n");
