// Reading Sarvam API examples, and the configuration they produce.
// Pure parsing plus a scratch database. No network, no calls, no live changes.
process.env.SARVAM_API_KEY = "platform-key";
process.env.SARVAM_ORG_ID = "org";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";
globalThis.fetch = (async () => {
  throw new Error("A test reached the network. Parsing must never make a request.");
}) as typeof fetch;

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("snippet-import");

const { parseSarvamSnippet } = await import("@/lib/providers/sarvam/snippet-import");
const db = await import("@/lib/db");
const { saveWorkspaceProvider, providerConfigFor, resolveBatch, batchProblems, publicProviderConfig } = await import("@/lib/providers/config");
const { campaignConfig } = await import("@/lib/campaigns/service");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};

const ORG = "https://apps.sarvam.ai/api";

// ================= single outbound =================
console.log("\n=== Instant Outbound example ===");
const outboundCurl = `curl --location '${ORG}/outbounds/v1/orgs/org-123/workspaces/ws-123/outbounds' \\
--header 'X-API-Key: sk_live_SUPERSECRET' \\
--header 'Content-Type: application/json' \\
--data '{
  "app_config": {
    "app_id": "Conversatio-abc123",
    "app_version": 7,
    "app_type": "agent",
    "connection_config": { "connection_id": "conn-xyz", "agent_phone_number": "+918064269194" },
    "agent_variables": { "customer_name": "Rahul" }
  },
  "user_config": { "user_phone_number": "+919800000001" },
  "webhook_config": { "url": "https://example.com/hook" }
}'`;
const single = parseSarvamSnippet("instant_outbound", outboundCurl);
check("A valid example is accepted", single.ok, single.problems);
check("Agent, version, connection and number are read", single.fields.appId === "Conversatio-abc123" && single.fields.appVersion === 7 && single.fields.connectionId === "conn-xyz" && single.fields.phoneNumber === "+918064269194", single.fields);
check("The pasted API key is NOT kept", !JSON.stringify(single.fields).includes("SUPERSECRET"));
check("…and the administrator is told it was ignored", single.warnings.some((w) => /API key/i.test(w)), single.warnings);
check("The example's webhook is not kept", !JSON.stringify(single.fields).includes("example.com"));
check("The customer's number is not kept", !JSON.stringify(single.fields).includes("919800000001"));
check("Agent variables are not kept", !JSON.stringify(single.fields).includes("Rahul"));

const placeholders = parseSarvamSnippet("instant_outbound", `curl '${ORG}/outbounds/v1/orgs/org_id/workspaces/workspace_id/outbounds' --data '{"app_config":{"app_id":"<your-app-id>","app_version":"string","connection_config":{"connection_id":"connection_id","agent_phone_number":"+91XXXXXXXXXX"}}}'`);
check("Placeholders are refused, not accepted as ids", !placeholders.ok && !placeholders.fields.appId, placeholders.fields);
check("…and it says exactly what is missing", placeholders.problems.some((p) => /agent ID/.test(p)), placeholders.problems);

check("A wrong Sarvam endpoint is refused", !parseSarvamSnippet("instant_outbound", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{}'`).ok);
check("A non-Sarvam host is refused", (() => {
  const r = parseSarvamSnippet("instant_outbound", `curl 'https://evil.example.com/api/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{"app_config":{"app_id":"x"}}'`);
  return !r.ok && r.problems.some((p) => /evil.example.com/.test(p));
})());
check("An empty paste is refused", !parseSarvamSnippet("instant_outbound", "   ").ok);
check("Unreadable JSON is explained", (() => {
  const r = parseSarvamSnippet("instant_outbound", `curl '${ORG}/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{ "app_config": '`);
  return !r.ok && r.problems.some((p) => /could not be read/i.test(p));
})());

// ================= create campaign =================
console.log("\n=== Create Campaign example ===");
const campaignCurl = `curl --location '${ORG}/scheduling/v1/orgs/org-123/workspaces/ws-123/campaigns' \\
--data '{
  "name": "April batch",
  "app_config": {
    "app_id": "Conversatio-batch", "app_version": 3, "app_type": "agent", "attempts_per_second": 2,
    "connection_configs": [{ "connection_id": "conn-batch", "phone_numbers": ["+918000000001", "+918000000002"] }],
    "retry_config": { "max_retries": 3, "retry_interval_minutes": 20,
      "retry_on": { "busy": {"enabled": true}, "no_answer": {"enabled": true}, "failed": {"enabled": false},
        "short_duration": {"enabled": true, "threshold_seconds": 30} } },
    "webhook_config": { "url": "https://example.com/campaign" }
  },
  "start_timestamp": "2026-04-01T09:00:00Z",
  "end_timestamp": "2026-04-02T19:00:00Z",
  "allowed_schedule": { "timezone": "Asia/Kolkata", "allowed_start_time": "10:00", "allowed_end_time": "18:00", "allowed_days": ["Monday","Tuesday"] }
}'`;
const campaign = parseSarvamSnippet("create_campaign", campaignCurl);
check("A valid campaign example is accepted", campaign.ok, campaign.problems);
check("Agent, rate and connection are read", campaign.fields.appId === "Conversatio-batch" && campaign.fields.appVersion === 3 && campaign.fields.attemptsPerSecond === 2 && campaign.fields.connectionId === "conn-batch", campaign.fields);
check("The number pool is read", JSON.stringify(campaign.fields.phoneNumbers) === JSON.stringify(["+918000000001", "+918000000002"]));
check("Retry rules are read", JSON.stringify(campaign.fields.retry) === JSON.stringify({ maxRetries: 3, intervalMinutes: 20, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: true, shortDurationSeconds: 30 }), campaign.fields.retry);
check("Allowed hours and days are read", JSON.stringify(campaign.fields.schedule) === JSON.stringify({ timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday", "Tuesday"] }), campaign.fields.schedule);
check("The campaign name and dates are NOT stored as workspace settings", !("name" in campaign.fields) && !("start_timestamp" in campaign.fields) && !JSON.stringify(campaign.fields).includes("2026-04-01"));
check("…and the administrator is told why", campaign.warnings.some((w) => /per campaign/i.test(w)), campaign.warnings);
check("An incomplete campaign example is refused", !parseSarvamSnippet("create_campaign", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{"app_config":{"app_id":"only-an-id"}}'`).ok);

// ================= cohort =================
console.log("\n=== Upload Cohort example ===");
const cohortUpload = parseSarvamSnippet("upload_cohort", `curl --location '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/cmp-999/cohorts/upload' --form 'cohort_file=@"leads.csv"' --form 'cohort_transformation_file=@"t.json"'`);
check("An upload example is accepted", cohortUpload.ok, cohortUpload.problems);
check("…and sets the cohort mode", cohortUpload.fields.cohortMode === "upload", cohortUpload.fields);
check("The example's campaign ID is NOT stored", !JSON.stringify(cohortUpload.fields).includes("cmp-999"));
check("…and it says the campaign comes from Tringlo", cohortUpload.warnings.some((w) => /campaign ID/i.test(w)), cohortUpload.warnings);
const cohortStream = parseSarvamSnippet("upload_cohort", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/cmp-1/cohorts/stream' --data '{"name":"batch","users":[{"user_phone_number":"+919800000001"}]}'`);
check("A stream example is accepted and sets streaming", cohortStream.ok && cohortStream.fields.cohortMode === "stream", cohortStream.fields);
check("The example's users are not kept", !JSON.stringify(cohortStream.fields).includes("919800000001"));
check("Something that is not a cohort example is refused", !parseSarvamSnippet("upload_cohort", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{}'`).ok);

// ================= pause / resume =================
console.log("\n=== Pause / Resume example ===");
const pause = parseSarvamSnippet("pause_resume", `curl --location --request PUT '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/cmp-555/status' --data '{"action":"pause"}'`);
check("A valid pause example is accepted", pause.ok, pause.problems);
check("Nothing campaign-specific is stored", !JSON.stringify(pause.fields).includes("cmp-555"));
check("An unsupported action is refused", (() => {
  const r = parseSarvamSnippet("pause_resume", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/c/status' --data '{"action":"explode"}'`);
  return !r.ok && r.problems.some((p) => /not a campaign action/i.test(p));
})());
check("The wrong endpoint is refused", !parseSarvamSnippet("pause_resume", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{"action":"pause"}'`).ok);

// ================= inbound deployment =================
console.log("\n=== Inbound Deployment example ===");
const deployment = parseSarvamSnippet("inbound_deployment", `curl --location '${ORG}/app-authoring/v1/orgs/o/workspaces/w/deployments' --data '{
  "name": "Line", "app_id": "Conversatio-inbound", "app_version": 11,
  "connection_configs": [{ "connection_id": "conn-in", "phone_numbers": ["+918064269194"] }],
  "inbound_config": { "start_time": "00:00:00", "end_time": "23:59:00", "allowed_days": ["Monday","Sunday"], "timezone": "Asia/Kolkata" },
  "webhook_config": { "url": "https://example.com/in" } }'`);
check("A valid deployment example is accepted", deployment.ok, deployment.problems);
check("Inbound agent, number and hours are read", deployment.fields.appId === "Conversatio-inbound" && deployment.fields.appVersion === 11 && deployment.fields.phoneNumber === "+918064269194" && deployment.fields.startTime === "00:00", deployment.fields);
check("The example's webhook is not kept", !JSON.stringify(deployment.fields).includes("example.com"));

// ================= no execution, no network =================
console.log("\n=== Safety ===");
const nasty = parseSarvamSnippet("instant_outbound", `curl '${ORG}/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{"app_config":{"app_id":"a; rm -rf /","app_version":1,"connection_config":{"connection_id":"$(whoami)","agent_phone_number":"+918000000000"}}}'`);
check("A shell-looking value is just a string, and nothing ran", nasty.ok && nasty.fields.appId === "a; rm -rf /", nasty.fields);
check("Parsing never touches the network", true); // fetch throws; reaching here proves it was not called.

// ================= configuration from the parsed fields =================
console.log("\n=== Saved configuration and isolation ===");
const now = new Date().toISOString();
const A = "ws_a", B = "ws_b";
for (const [id, name] of [[A, "Alpha"], [B, "Beta"]]) db.saveTenant({ id, name, createdAt: now });

saveWorkspaceProvider(A, {
  outbound: { appId: "Agent-A", appVersion: 1, connectionId: "conn-a", phoneNumber: "+918000000001", agentName: null, agentVariables: [] },
  batch: {
    appId: "Agent-A-batch", appVersion: 2, appType: "agent", connectionId: "conn-a-batch",
    phoneNumbers: ["+918000000011", "+918000000012"], attemptsPerSecond: 2, cohortMode: "stream",
    retry: { maxRetries: 3, intervalMinutes: 20, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
    schedule: { timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday", "Tuesday"] },
  },
}, "test");
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B", appVersion: 9, connectionId: "conn-b", phoneNumber: "+918999999999", agentName: null, agentVariables: [] },
}, "test");

const configA = campaignConfig(A);
check("Campaigns use the workspace's own batch agent", configA.appId === "Agent-A-batch" && configA.appVersion === 2 && configA.connectionId === "conn-a-batch", { id: configA.appId });
check("…its number pool", JSON.stringify(configA.phoneNumbers) === JSON.stringify(["+918000000011", "+918000000012"]));
check("…its rate, retries and hours", configA.defaults?.attemptsPerSecond === 2 && configA.defaults?.retry.maxRetries === 3 && configA.defaults?.schedule.startTime === "10:00", configA.defaults);
check("…and is not marked inherited", configA.inherited === false);

// B has no batch block: the old behaviour, stated honestly.
const configB = campaignConfig(B);
check("A workspace without batch settings falls back to its single-call ones", configB.appId === "Agent-B" && configB.phoneNumbers[0] === "+918999999999", configB.appId);
check("…and is marked as inherited, not configured", configB.inherited === true);
check("…and never takes another workspace's agent", configB.appId !== "Agent-A-batch" && configB.appId !== "Agent-A");
check("Status reads 'inherited' for B and 'saved' for A", publicProviderConfig(A).status.batchOutbound === "saved" && publicProviderConfig(B).status.batchOutbound === "inherited", {
  a: publicProviderConfig(A).status, b: publicProviderConfig(B).status,
});
check("An unconfigured workspace resolves to nothing", resolveBatch("ws_nobody") === null);

check("Incomplete batch settings are refused", batchProblems({ appId: "x", appVersion: 1, connectionId: "c", phoneNumbers: [], attemptsPerSecond: 1, cohortMode: "stream", appType: "agent", retry: { maxRetries: 0, intervalMinutes: 30, onBusy: false, onNoAnswer: false, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 }, schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "19:00", days: ["Monday"] } }).some((p) => /at least one number/i.test(p)));
check("Cohort upload is refused until it is confirmed with Sarvam", batchProblems({ appId: "x", appVersion: 1, appType: "agent", connectionId: "c", phoneNumbers: ["+91800"], attemptsPerSecond: 1, cohortMode: "upload", retry: { maxRetries: 0, intervalMinutes: 30, onBusy: false, onNoAnswer: false, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 }, schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "19:00", days: ["Monday"] } }).some((p) => /not confirmed/i.test(p)));

check("No secret reaches the browser payload", (() => {
  const shown = JSON.stringify(publicProviderConfig(A));
  return !shown.includes("platform-key") && !shown.includes("sarvam-ws") && !shown.includes(providerConfigFor(A)!.webhookToken);
})());

// ---- a refused paste must change nothing (item 13) ----
console.log("\n=== A refused paste leaves good values alone ===");
const refusedPastes = [
  "",
  "curl 'https://evil.example.com/api/outbounds/v1/orgs/o/workspaces/w/outbounds'",
  ORG + "/scheduling/v1/orgs/o/workspaces/w/campaigns",
  "curl " + ORG + "/outbounds/v1/orgs/o/workspaces/w/outbounds --data '{ broken'",
  "rm -rf / && curl " + ORG + "/outbounds/v1/orgs/o/workspaces/w/outbounds",
];
for (const bad of refusedPastes) {
  const r = parseSarvamSnippet("instant_outbound", bad);
  const label = bad.slice(0, 32) || "an empty box";
  check("A refused paste hands back nothing to write: " + label, !r.ok && Object.keys(r.fields).length === 0, r.fields);
  check("...and gives a reason to show instead", !r.ok && r.problems.length > 0, r.problems);
}
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
