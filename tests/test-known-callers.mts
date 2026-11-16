// ============================================================
// Two inbound examples, two parsers
// ============================================================
//
// Sarvam documents two separate operations against a deployment: creating one,
// and adding known callers to one. They live on different services and have
// different shapes, so each gets its own reader — and neither is loosened to
// accommodate the other.
//
// Sarvam is simulated. No call is placed and no deployment is created or
// changed.
// ============================================================

process.env.SARVAM_API_KEY = "platform-key-must-never-leak";
process.env.SARVAM_ORG_ID = "org-id";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";

// A suite writes freely, so it must never see the live database.
// The project root, wherever the repository is checked out.
const PROJECT = (await import("node:url")).fileURLToPath(new URL("..", import.meta.url)).split("\\").join("/").replace(/\/$/, "");

const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("known-callers");

interface Hit { url: string; method: string; body: unknown }
const hits: Hit[] = [];
/** Set to make the next Sarvam call fail, for the error paths. */
let failNext: { status: number; message: string } | null = null;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  let body: unknown;
  if (init?.body instanceof FormData) {
    // The deployment cohort goes up as multipart; keep the parts for checking.
    const form = init.body as FormData;
    const parts: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      parts[key] = value instanceof Blob ? await value.text() : String(value);
    }
    body = parts;
  } else if (init?.body) {
    body = JSON.parse(String(init.body));
  }
  hits.push({ url, method, body });

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

  if (!url.startsWith("https://apps.sarvam.ai/")) return json({ error: "unexpected host" }, 500);
  if (failNext) {
    const { status, message } = failNext;
    failNext = null;
    return json({ error: { code: "rejected", message } }, status);
  }
  if (/\/cohorts\/upload$/.test(url)) {
    return json({ cohort_id: "coh-known-1", status: "completed", result: { total_records: 2, valid_records: 2, rejected_records: 0 } });
  }
  if (/\/deployments\/[^/]+$/.test(url) && method === "GET") return json({ deployment_id: "dep-live", status: "active" });
  return json({ items: [] });
}) as typeof fetch;

const { parseSarvamSnippet } = await import("@/lib/providers/sarvam/snippet-import");
const db = await import("@/lib/db");
const { saveWorkspaceProvider, publicProviderConfig, providerConfigFor } = await import("@/lib/providers/config");
const { syncKnownCallers } = await import("@/lib/inbound/service");
const { defaultInboundSettings } = await import("@/lib/inbound/types");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const S = "https://apps.sarvam.ai/api";
const CREATE_DEPLOYMENT = `curl --location '${S}/app-authoring/v1/orgs/org-123/workspaces/ws-123/deployments' \\
--header 'X-API-Key: sk_live_SECRET' \\
--data '{"name":"Support line","description":"Inbound","app_id":"Conversatio-inbound","app_version":11,
  "connection_configs":[{"connection_id":"conn-in","phone_numbers":["+918064269194"]}],
  "inbound_config":{"start_time":"09:00:00","end_time":"18:00:00","allowed_days":["Monday"],"timezone":"Asia/Kolkata"},
  "webhook_config":{"url":"https://example.com/in"}}'`;
const KNOWN_CALLERS = `curl --location '${S}/scheduling/v1/orgs/org-123/workspaces/ws-123/deployments/Tringlo-AI-9f3c21aa-77be/cohorts/stream' \\
--header 'X-API-Key: sk_live_SECRET' \\
--data '{"name":"known-callers","users":[
  {"user_phone_number":"+919800000001","user_identifier":"cust-1","app_variables":{"customer_name":"Asha"}},
  {"user_phone_number":"+919800000002","app_variables":{"customer_name":"Bhanu"}}]}'`;

// ---------------- 1. the deployment example still works ----------------
section("Create Deployment, unchanged");
const deployment = parseSarvamSnippet("inbound_deployment", CREATE_DEPLOYMENT);
check("A valid create-deployment example is accepted", deployment.ok, deployment.problems);
check("…giving the agent, version, connection and number", deployment.fields.appId === "Conversatio-inbound" && deployment.fields.appVersion === 11 && deployment.fields.connectionId === "conn-in" && deployment.fields.phoneNumber === "+918064269194", deployment.fields);
check("…and the answering hours", deployment.fields.startTime === "09:00" && deployment.fields.endTime === "18:00");
check("The pasted API key is not kept", !JSON.stringify(deployment.fields).includes("SECRET"));

// ---------------- 2 + 3. the known-caller example has its own parser ----------------
section("Known-Caller List, its own operation");
const known = parseSarvamSnippet("known_callers", KNOWN_CALLERS);
check("A valid known-caller example is accepted", known.ok, known.problems);
check("…and is no longer called an invalid deployment-creation request", !known.problems.some((p) => /Create Deployment endpoint/i.test(p)), known.problems);
check("The deployment ID is read out of the URL", known.fields.deploymentId === "Tringlo-AI-9f3c21aa-77be", known.fields);
const recognised = (known.fields.recognisedFields ?? []) as string[];
check("It reports the fields it understood", recognised.includes("users[].user_phone_number") && recognised.includes("users[].app_variables"), recognised);
check("…including the identifier and the cohort name", recognised.includes("users[].user_identifier") && recognised.includes("name"), recognised);
check("It says Sarvam refuses user_identifier on a deployment", known.warnings.some((w) => /user_identifier/.test(w)), known.warnings);

// Before the fix this exact snippet was refused; prove the old route still refuses it.
const throughOldParser = parseSarvamSnippet("inbound_deployment", KNOWN_CALLERS);
check("The create-deployment parser still refuses it, as it should", !throughOldParser.ok && throughOldParser.problems.some((p) => /Create Deployment endpoint/i.test(p)));
const deploymentThroughNew = parseSarvamSnippet("known_callers", CREATE_DEPLOYMENT);
check("…and the known-caller parser refuses a create-deployment request", !deploymentThroughNew.ok && deploymentThroughNew.problems.some((p) => /deployment cohort endpoint/i.test(p)));

// ---------------- 4. endpoint validation was not weakened ----------------
section("Endpoint validation");
for (const [label, kind, url] of [
  ["a campaign cohort", "known_callers", `${S}/scheduling/v1/orgs/o/workspaces/w/campaigns/c/cohorts/stream`],
  ["a non-Sarvam host", "known_callers", "https://evil.example.com/api/scheduling/v1/orgs/o/workspaces/w/deployments/d/cohorts/stream"],
  ["the outbound endpoint", "known_callers", `${S}/outbounds/v1/orgs/o/workspaces/w/outbounds`],
  ["a deployment cohort", "upload_cohort", `${S}/scheduling/v1/orgs/o/workspaces/w/deployments/d/cohorts/stream`],
] as const) {
  const result = parseSarvamSnippet(kind, `curl '${url}' --data '{"name":"x","users":[]}'`);
  check(`${label} is refused by the ${kind} parser`, !result.ok, result.problems);
  check("…with nothing to write", Object.keys(result.fields).length === 0, result.fields);
}

// ---------------- 5. a placeholder deployment id is never kept ----------------
section("Placeholder deployment IDs");
for (const placeholder of ["{deployment_id}", "deployment_id", "<your-deployment-id>", "your-deployment-id"]) {
  const result = parseSarvamSnippet("known_callers", `curl '${S}/scheduling/v1/orgs/o/workspaces/w/deployments/${placeholder}/cohorts/stream' --data '{"name":"c","users":[]}'`);
  check(`"${placeholder}" is not kept as a deployment ID`, result.ok && !("deploymentId" in result.fields), result.fields);
}
const placeholderResult = parseSarvamSnippet("known_callers", `curl '${S}/scheduling/v1/orgs/o/workspaces/w/deployments/{deployment_id}/cohorts/stream' --data '{"name":"c","users":[]}'`);
check("…and the structure is still validated, so it can be pasted before a deployment exists", placeholderResult.ok);
check("…with an explanation of where the real one comes from", placeholderResult.warnings.some((w) => /placeholder/i.test(w) && /this workspace/i.test(w)), placeholderResult.warnings);

// ---------------- 8. sample callers are never imported ----------------
section("The example's callers are documentation");
check("No sample number survives the parse", !JSON.stringify(known.fields).includes("919800000001") && !JSON.stringify(known.fields).includes("919800000002"), known.fields);
check("No sample name survives either", !JSON.stringify(known.fields).includes("Asha") && !JSON.stringify(known.fields).includes("Bhanu"));
check("Nor the sample identifier", !JSON.stringify(known.fields).includes("cust-1"));
check("Nor the cohort name", !JSON.stringify(known.fields).includes("known-callers"));
check("It says the callers were discarded", known.warnings.some((w) => /example caller/i.test(w) && /own contacts/i.test(w)), known.warnings);

// ---------------- the workspaces ----------------
const now = new Date().toISOString();
const A = "ws_alpha", B = "ws_beta";
db.saveTenant({ id: A, name: "Alpha", createdAt: now });
db.saveTenant({ id: B, name: "Beta", createdAt: now });
db.saveAgentConfig(A, { companyName: "Alpha", productName: "AlphaPay" });
db.saveAgentConfig(B, { companyName: "Beta", productName: "BetaBox" });
saveWorkspaceProvider(A, {
  outbound: { appId: "Agent-A", appVersion: 4, connectionId: "conn-a", phoneNumber: "+918000000001", agentName: null, agentVariables: ["customer_name"] },
  inbound: { appId: "Agent-A-in", appVersion: 11, connectionId: "conn-a", agentVariables: ["customer_name"] },
}, "setup");
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B", appVersion: 2, connectionId: "conn-b", phoneNumber: "+918000000002", agentName: null, agentVariables: [] },
  inbound: { appId: "Agent-B-in", appVersion: 3, connectionId: "conn-b", agentVariables: [] },
}, "setup");

const line = (tenantId: string, deploymentId: string | null, enabled: boolean) =>
  db.saveInboundSettings({
    ...defaultInboundSettings(tenantId, "Asia/Kolkata"),
    enabled,
    deploymentId,
    phoneNumber: tenantId === A ? "+918064269100" : "+918064269200",
  });
line(A, "dep-alpha", true);
line(B, "dep-beta", true);

db.saveLead({ id: "lead_a1", tenantId: A, name: "Asha", phone: "+919700000001", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
db.saveLead({ id: "lead_a2", tenantId: A, name: "Bhanu", phone: "+919700000002", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
db.saveLead({ id: "lead_b1", tenantId: B, name: "Chetan", phone: "+919700000003", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);

// ---------------- 6 + 9. the real send uses real workspace data ----------------
section("Sending known callers at runtime");
hits.length = 0;
const sent = await syncKnownCallers(A);
check("It sends this workspace's own contacts", sent.count === 2, sent);
const call = hits.find((h) => /\/cohorts\//.test(h.url))!;
check("…to a deployment cohort endpoint", /\/deployments\/dep-alpha\/cohorts\//.test(call.url), call?.url);
check("…resolving the deployment ID from this workspace's settings", call.url.includes("dep-alpha") && !call.url.includes("dep-beta"));
check("…and never a placeholder", !/\{deployment_id\}|deployment_id\//.test(call.url), call.url);
const parts = call.body as Record<string, string>;
check("The payload carries this workspace's real numbers", parts.cohort_file.includes("+919700000001") && parts.cohort_file.includes("+919700000002"), parts.cohort_file?.slice(0, 120));
check("…and not the other workspace's", !parts.cohort_file.includes("+919700000003"));
check("…nor any caller from the pasted example", !parts.cohort_file.includes("+919800000001") && !parts.cohort_file.includes("Asha, cust-1"));
check("The cohort it created is recorded against the workspace", db.getInboundSettings(A)?.knownCallersCohortId === "coh-known-1", db.getInboundSettings(A)?.knownCallersCohortId);
check("…with the count and the time it synced", db.getInboundSettings(A)?.knownCallersCount === 2 && Boolean(db.getInboundSettings(A)?.knownCallersSyncedAt));
check("…and no error", db.getInboundSettings(A)?.knownCallersError === null);
check("The other workspace's line was not touched", db.getInboundSettings(B)?.knownCallersCohortId === null, db.getInboundSettings(B)?.knownCallersCohortId);

// Errors are recorded, not swallowed.
hits.length = 0;
failNext = { status: 422, message: "Sarvam did not accept the contacts." };
let threw = false;
try { await syncKnownCallers(A); } catch { threw = true; }
check("A refusal from Sarvam is raised, not swallowed", threw);
check("…and recorded on the workspace's line", /did not accept/i.test(db.getInboundSettings(A)?.knownCallersError ?? ""), db.getInboundSettings(A)?.knownCallersError);

// ---------------- 7. no deployment, and no borrowing another's ----------------
section("A workspace with no deployment of its own");
db.saveTenant({ id: "ws_new", name: "New", createdAt: now });
db.saveAgentConfig("ws_new", { companyName: "New", productName: "Thing" });
line("ws_new", null, false);
db.saveLead({ id: "lead_n1", tenantId: "ws_new", name: "Dilip", phone: "+919700000004", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
hits.length = 0;
const none = await syncKnownCallers("ws_new");
check("Nothing is sent when the workspace has no deployment", none.count === 0, none);
check("…and no request was made at all", hits.length === 0, hits);
check("…and it did not fall back to another workspace's deployment", !hits.some((h) => /dep-alpha|dep-beta/.test(h.url)));

// ---------------- 11. existing inbound behaviour is unchanged ----------------
section("Existing inbound behaviour");
check("Workspace A keeps its inbound agent and version", providerConfigFor(A)!.inbound!.appId === "Agent-A-in" && providerConfigFor(A)!.inbound!.appVersion === 11);
check("Workspace B keeps its own", providerConfigFor(B)!.inbound!.appId === "Agent-B-in" && providerConfigFor(B)!.inbound!.appVersion === 3);
check("Their deployments are untouched", db.getInboundSettings(A)?.deploymentId === "dep-alpha" && db.getInboundSettings(B)?.deploymentId === "dep-beta");
check("Both lines are still as they were", db.getInboundSettings(A)?.enabled === true && db.getInboundSettings(B)?.enabled === true);
check("Each workspace has its own webhook token", providerConfigFor(A)!.webhookToken !== providerConfigFor(B)!.webhookToken);

// ---------------- 12. both imports exist in one place ----------------
section("Both importers, one implementation");
const fs = await import("node:fs");
const read = (file: string) => fs.readFileSync(`${PROJECT}/src/${file}`, "utf8");
const editorSource = read("components/providers/voice-provider-editor.tsx");
const wizardSource = read("components/auth/create-workspace-form.tsx");
const settingsSource = read("components/settings/voice-provider-editor-panel.tsx");
check("The shared editor offers the create-deployment import", editorSource.includes('kind="inbound_deployment"'));
check("…and the known-caller import", editorSource.includes('kind="known_callers"'));
check("Both the wizard and Settings render that one editor", wizardSource.includes("VoiceProviderSections") && settingsSource.includes("VoiceProviderSections"));
check("There is exactly one parser, not one per screen", !wizardSource.includes("parseSarvamSnippet") && !settingsSource.includes("parseSarvamSnippet"));

// ---------------- 10. secrets ----------------
section("Secrets");
const exposed = JSON.stringify(publicProviderConfig(A));
check("The API key is not in what the browser is sent", !exposed.includes("platform-key-must-never-leak"));
check("Neither is the Sarvam org or workspace ID", !exposed.includes("sarvam-ws") && !exposed.includes("org-id"));
check("Nor the workspace's webhook token", !exposed.includes(providerConfigFor(A)!.webhookToken));
check("No parsed example carries a credential", !JSON.stringify(known.fields).includes("sk_live") && !JSON.stringify(deployment.fields).includes("sk_live"));
check("Every Sarvam request sent the key in a header, never the URL", hits.every((h) => !h.url.includes("platform-key-must-never-leak")));

section("Nothing live happened");
check("No deployment was created or changed", !hits.some((h) => h.method === "POST" && /\/app-authoring\//.test(h.url)));
check("No call was placed", !hits.some((h) => /\/outbounds/.test(h.url)));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
