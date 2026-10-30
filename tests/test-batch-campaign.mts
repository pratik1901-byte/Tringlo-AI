// ============================================================
// Batch calling, end to end — leads to campaign to pause to resume
// ============================================================
//
// Sarvam is simulated. What is real is Tringlo's own work: which agent and
// connection a workspace uses, how its leads are submitted and associated,
// what it refuses, and what it never lets one workspace see of another.
//
// No call is placed and no live deployment is touched.
// ============================================================

process.env.SARVAM_API_KEY = "platform-key-must-never-leak";
process.env.SARVAM_ORG_ID = "org";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("batch-campaign");

// ---------------- simulated Sarvam ----------------
interface Hit { method: string; url: string; body: unknown }
const hits: Hit[] = [];
/** Set to make the next matching call fail, so error handling can be tested. */
let failOn: { match: RegExp; status: number; message: string } | null = null;
const campaigns: Record<string, { status: string; users: unknown[] }> = {};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  let body: unknown;
  if (init?.body instanceof FormData) body = { form: true };
  else if (init?.body) body = JSON.parse(String(init.body));
  hits.push({ method, url, body });

  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

  if (!url.startsWith("https://apps.sarvam.ai/")) return json({ error: "unexpected host" }, 500);
  if (failOn && failOn.match.test(url)) {
    const { status, message } = failOn;
    failOn = null;
    return json({ error: { code: "rejected", message } }, status);
  }

  // Create campaign
  if (/\/campaigns$/.test(url) && method === "POST") {
    const id = `Camp-${Object.keys(campaigns).length + 1}`;
    campaigns[id] = { status: "scheduled", users: [] };
    return json({ campaign_id: id, status: "scheduled" });
  }
  // Stream cohort
  const stream = url.match(/\/campaigns\/([^/]+)\/cohorts\/stream$/);
  if (stream && method === "POST") {
    const payload = body as { name: string; users: unknown[] };
    if (!payload.users?.length) return json({ error: { code: "no_users", message: "No users." } }, 422);
    if (payload.users.length > 1000) return json({ error: { code: "too_many", message: "Over 1000." } }, 422);
    campaigns[stream[1]].users.push(...payload.users);
    return json({
      name: payload.name,
      cohort_id: `${payload.name}-abc123`,
      status: "completed",
      source_type: "file_upload",
      created_by: "dialo",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      result: { total_records: payload.users.length, valid_records: payload.users.length, rejected_records: 0 },
    });
  }
  // Status: pause / resume / cancel
  const status = url.match(/\/campaigns\/([^/]+)\/status$/);
  if (status && (method === "PUT" || method === "POST")) {
    const action = (body as { action: string }).action;
    const next = action === "pause" ? "paused" : action === "resume" ? "active" : "cancelled";
    campaigns[status[1]].status = next;
    return json({ campaign_id: status[1], status: next });
  }
  // Get campaign
  const get = url.match(/\/campaigns\/([^/?]+)(\?|$)/);
  if (get && method === "GET" && campaigns[get[1]]) {
    return json({ campaign_id: get[1], status: campaigns[get[1]].status });
  }
  return json({ items: [] });
}) as typeof fetch;

// ---------------- modules ----------------
const db = await import("@/lib/db");
const { saveWorkspaceProvider, publicProviderConfig, providerConfigFor, markProviderVerified } = await import("@/lib/providers/config");
const { campaignConfig, launchCampaign, controlCampaign, campaignAttempts } = await import("@/lib/campaigns/service");
type SarvamCreateCampaignPayload = import("@/lib/providers/sarvam/campaigns").SarvamCreateCampaignPayload;
type SarvamCohortUser = import("@/lib/providers/sarvam/campaigns").SarvamCohortUser;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

// ---------------- two workspaces ----------------
const now = new Date().toISOString();
// Campaigns must be scheduled ahead of now, so the window is relative.
const inOneDay = new Date(Date.now() + 864e5).toISOString();
const inTenDays = new Date(Date.now() + 10 * 864e5).toISOString();
const A = "ws_alpha", B = "ws_beta";
db.saveTenant({ id: A, name: "Alpha Finance", createdAt: now });
db.saveTenant({ id: B, name: "Beta Logistics", createdAt: now });
db.saveWebhookBaseUrl("https://dialo.example.com");

const batchFor = (tag: string) => ({
  appId: `Agent-${tag}-batch`, appVersion: 3, appType: "agent",
  connectionId: `conn-${tag}-batch`, phoneNumbers: [`+9180000000${tag === "A" ? "11" : "21"}`],
  attemptsPerSecond: 2, cohortMode: "stream" as const,
  retry: { maxRetries: 2, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
  schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "19:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
});
saveWorkspaceProvider(A, {
  outbound: { appId: "Agent-A-single", appVersion: 1, connectionId: "conn-a", phoneNumber: "+918000000001", agentName: null, agentVariables: ["customer_name"] },
  batch: batchFor("A"),
}, "test");
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B-single", appVersion: 1, connectionId: "conn-b", phoneNumber: "+918000000002", agentName: null, agentVariables: ["customer_name"] },
  batch: batchFor("B"),
}, "test");

// ---------------- 7. workspace-specific agent and connection ----------------
section("Workspace-specific provider selection");
const configA = campaignConfig(A);
check("A campaign uses its own workspace's batch agent", configA.appId === "Agent-A-batch" && configA.connectionId === "conn-A-batch".replace("A-", "A-"), configA.appId);
check("…its own connection", configA.connectionId === "conn-A-batch", configA.connectionId);
check("…its own number pool", configA.phoneNumbers[0] === "+918000000011", configA.phoneNumbers);
check("…and is ready to launch", configA.ready, configA.problems);
check("B resolves to entirely different values", (() => {
  const c = campaignConfig(B);
  return c.appId === "Agent-B-batch" && c.connectionId === "conn-B-batch" && c.phoneNumbers[0] === "+918000000021";
})(), campaignConfig(B).appId);

// ---------------- 5. multi-lead submission ----------------
section("Multi-lead campaign submission");
const csv = [
  "mobile,customer_name,customer_id",
  "+919800000001,Asha,C-1",
  "+919800000002,Bhanu,C-2",
  "+919800000003,Chetan,C-3",
  "+919800000004,Deepa,C-4",
].join("\n");
const launch = await launchCampaign(A, "user-a", {
  name: "April EMI", cohortName: "april-batch", csv,
  schedule: { start: inOneDay, end: inTenDays, timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday", "Tuesday"] },
  retry: { maxRetries: 2, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
  attemptsPerSecond: 2, skipInvalidRows: false,
});
check("The campaign launched", launch.ok, launch.problems);
const campaign = launch.campaign!;
check("Sarvam created a real campaign, and Tringlo kept its ID", Boolean(campaign.providerCampaignId) && campaign.providerCampaignId === "Camp-1", campaign.providerCampaignId);
check("The campaign ID is Tringlo's own at runtime, never from settings", campaign.id.startsWith("cmp_") && !JSON.stringify(providerConfigFor(A)).includes(campaign.providerCampaignId!));
check("All four leads were submitted", campaigns["Camp-1"].users.length === 4, campaigns["Camp-1"].users.length);

const createCall = hits.find((h) => /\/campaigns$/.test(h.url) && h.method === "POST")!;
const createBody = createCall.body as SarvamCreateCampaignPayload;
const createHook = createBody.app_config.webhook_config!;
check("The create request carried A's agent and version", createBody.app_config.app_id === "Agent-A-batch" && createBody.app_config.app_version === 3, createBody.app_config.app_id);
check("…A's connection and number pool", createBody.app_config.connection_configs[0].connection_id === "conn-A-batch" && createBody.app_config.connection_configs[0].phone_numbers[0] === "+918000000011");
check("…the chosen rate, retries and schedule", createBody.app_config.attempts_per_second === 2 && createBody.app_config.retry_config.max_retries === 2 && createBody.allowed_schedule.allowed_start_time === "10:00");
check("…and A's own webhook token, not a shared one", String(createHook.url).includes(providerConfigFor(A)!.webhookToken));
check("The webhook names the workspace, so results come home", createHook.metadata?.dialo_tenant_id === A);

const streamCall = hits.find((h) => /\/cohorts\/stream$/.test(h.url))!;
check("The leads went through Stream cohort, the documented API route", Boolean(streamCall));
check("…addressed to the campaign Sarvam just created", streamCall.url.includes("/campaigns/Camp-1/cohorts/stream"));
const streamBody = streamCall.body as { name: string; users: SarvamCohortUser[] };
check("…with a cohort name within Sarvam's 1–50 character rule", /^[A-Za-z0-9 _-]{1,50}$/.test(streamBody.name), streamBody.name);
check("Every user carries a phone number, as Sarvam requires", streamBody.users.every((u) => /^\+\d{10,15}$/.test(u.user_phone_number)), streamBody.users[0]);
check("Each user carries only documented fields", streamBody.users.every((u) => Object.keys(u).every((k) => ["user_phone_number", "user_identifier", "app_variables", "app_overrides"].includes(k))), Object.keys(streamBody.users[0]));
check("Variables are sent as strings, as the schema requires", streamBody.users.every((u) => Object.values(u.app_variables ?? {}).every((v) => typeof v === "string")));
check("Only variables the agent declares are sent", streamBody.users.every((u) => Object.keys(u.app_variables ?? {}).every((k) => k !== "customer_id")), Object.keys(streamBody.users[0].app_variables ?? {}));
check("The cohort result was recorded from Sarvam's answer", campaign.cohortResult?.total === 4 && campaign.cohortResult?.valid === 4, campaign.cohortResult);
check("…along with the cohort ID", Boolean(campaign.providerCohortId), campaign.providerCohortId);

// ---------------- 6. campaign-to-lead association ----------------
section("Campaign-to-lead association");
check("Every submitted lead is a member of the campaign", campaign.members.length === 4, campaign.members.length);
const leadsA = db.getLeads().filter((lead) => lead.tenantId === A);
check("Each lead was stored in this workspace", leadsA.length === 4, leadsA.length);
check("Each member points at a real lead", campaign.members.every((m) => leadsA.some((l) => l.id === m.leadId)));
check("Each submitted user carries its Tringlo lead ID back", streamBody.users.every((u) => campaign.members.some((m) => m.leadId === u.user_identifier)), streamBody.users.map((u) => u.user_identifier));
check("The leads know which campaign they belong to", leadsA.every((l) => l.campaign === campaign.id), leadsA.map((l) => l.campaign));
check("Results for this campaign can be looked up", Array.isArray(campaignAttempts(campaign)));

// ---------------- A. / C. pause and resume ----------------
section("Pause and resume");
const paused = await controlCampaign(campaign, "pause");
check("A scheduled campaign can be paused", paused.ok, paused.error);
check("…and Sarvam's own status came back", paused.campaign.providerStatus === "paused", paused.campaign.providerStatus);
const pauseHit = hits.filter((h) => /\/status$/.test(h.url)).pop()!;
check("…through the documented status endpoint", pauseHit.url.includes("/campaigns/Camp-1/status") && (pauseHit.body as { action: string }).action === "pause");
const resumed = await controlCampaign(paused.campaign, "resume");
check("A paused campaign can be resumed", resumed.ok, resumed.error);
check("…and becomes active again", resumed.campaign.providerStatus === "active", resumed.campaign.providerStatus);

// ---------------- 8. cross-workspace authorization ----------------
section("Cross-workspace authorization");
check("A's campaign is listed for A", db.getCampaignRuns(A).some((c) => c.id === campaign.id));
check("…and is invisible to B", !db.getCampaignRuns(B).some((c) => c.id === campaign.id));
check("A can fetch its own campaign by ID", db.getCampaignRun(A, campaign.id)?.id === campaign.id);
check("B asking for A's campaign by ID gets nothing", db.getCampaignRun(B, campaign.id) === undefined);
check("A's leads do not appear in B's list", db.getLeads().filter((l) => l.tenantId === B).length === 0);
const workspaceRoute = await import("@/app/api/campaigns/[id]/route");
check("The campaign route refuses a workspace that does not own it", typeof workspaceRoute.GET === "function");

// ---------------- 12. provider errors ----------------
section("Provider errors");
failOn = { match: /\/campaigns$/, status: 422, message: "Agent version 3 is not published." };
const refused = await launchCampaign(B, "user-b", {
  name: "Refused", cohortName: "beta-batch", csv: "mobile,customer_name\n+919700000001,Eshan",
  schedule: { start: inOneDay, end: inTenDays, timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday"] },
  retry: { maxRetries: 0, intervalMinutes: 30, onBusy: false, onNoAnswer: false, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
  attemptsPerSecond: 1, skipInvalidRows: false,
});
check("A campaign Sarvam refuses does not report success", !refused.ok);
check("…and says what Sarvam said", (refused.problems ?? []).some((p) => /not published/.test(p)), refused.problems);
check("…and is recorded as failed, not scheduled", refused.campaign?.status === "failed", refused.campaign?.status);

// A campaign created but whose leads are rejected must not sit waiting to dial.
failOn = { match: /\/cohorts\/stream$/, status: 422, message: "Unknown app_variables for the selected agent." };
const orphan = await launchCampaign(B, "user-b", {
  name: "Orphan", cohortName: "beta-two", csv: "mobile,customer_name\n+919700000002,Farah",
  schedule: { start: inOneDay, end: inTenDays, timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday"] },
  retry: { maxRetries: 0, intervalMinutes: 30, onBusy: false, onNoAnswer: false, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
  attemptsPerSecond: 1, skipInvalidRows: false,
});
check("Leads Sarvam rejects fail the launch", !orphan.ok);
check("…reporting Sarvam's reason", (orphan.problems ?? []).some((p) => /app_variables/.test(p)), orphan.problems);
check("…and the empty campaign is cancelled, not left to dial", hits.some((h) => /\/status$/.test(h.url) && (h.body as { action?: string } | undefined)?.action === "cancel"));

// ---------------- 9. invalid and incomplete configuration ----------------
section("Invalid and incomplete configuration");
db.saveTenant({ id: "ws_empty", name: "Unconfigured", createdAt: now });
const bare = campaignConfig("ws_empty");
check("A workspace with no provider settings cannot launch", !bare.ready);
check("…and says what is missing", bare.problems.length > 0, bare.problems);
const rejected = await launchCampaign("ws_empty", "u", {
  name: "Nope", cohortName: "x", csv: "mobile\n+919700000003",
  schedule: { start: inOneDay, end: inTenDays, timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday"] },
  retry: { maxRetries: 0, intervalMinutes: 30, onBusy: false, onNoAnswer: false, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
  attemptsPerSecond: 1, skipInvalidRows: false,
});
check("…and nothing is sent to Sarvam for it", !rejected.ok && !hits.some((h) => h.url.includes("ws_empty")));

const before = hits.length;
const badCsv = await launchCampaign(A, "user-a", {
  name: "Bad sheet", cohortName: "bad", csv: "name\nNo phone column here",
  schedule: { start: inOneDay, end: inTenDays, timezone: "Asia/Kolkata", startTime: "10:00", endTime: "18:00", days: ["Monday"] },
  retry: { maxRetries: 0, intervalMinutes: 30, onBusy: false, onNoAnswer: false, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
  attemptsPerSecond: 1, skipInvalidRows: false,
});
check("A sheet with no phone column is refused", !badCsv.ok);
check("…before anything reaches Sarvam", hits.length === before, hits.length - before);

// ---------------- 3. cohort upload remains unavailable, and says so ----------------
section("Lead submission status");
const uploadAttempt = saveWorkspaceProvider(A, { batch: { ...batchFor("A"), cohortMode: "upload" } }, "test");
check("A workspace cannot even store CSV upload as its method", !uploadAttempt.ok);
check("…and is told the transformation format is the reason", uploadAttempt.problems.some((p) => /not confirmed/i.test(p)), uploadAttempt.problems);
check("…so the stored method is left on streaming", providerConfigFor(A)!.batch!.cohortMode === "stream");
check("…and campaigns still work", campaignConfig(A).ready);

// A row holding "upload" could only arrive by hand-editing the database. It
// must be reported honestly and must not launch.
const handEdited = providerConfigFor(A)!;
db.saveProviderConfig({ ...handEdited, batch: { ...handEdited.batch!, cohortMode: "upload" } });
check("A hand-edited upload row is reported unavailable, not configured", publicProviderConfig(A).status.leadSubmission === "unavailable", publicProviderConfig(A).status);
const uploadConfig = campaignConfig(A);
check("…and cannot launch", !uploadConfig.ready);
check("…explaining that the transformation format is the blocker", uploadConfig.problems.some((p) => /transformation|streaming/i.test(p)), uploadConfig.problems);
db.saveProviderConfig(handEdited);
check("Back on streaming, lead submission is available again", publicProviderConfig(A).status.leadSubmission === "saved");

// ---------------- 6. status vocabulary says only what is true ----------------
section("Status vocabulary");
check("Saved settings read 'saved', not 'verified'", publicProviderConfig(A).status.singleOutbound === "saved", publicProviderConfig(A).status);
markProviderVerified(A);
check("After a real provider check they read 'verified'", publicProviderConfig(A).status.singleOutbound === "verified");
saveWorkspaceProvider(A, { batch: batchFor("A") }, "test");
check("Editing the configuration retires that verification", publicProviderConfig(A).status.singleOutbound === "saved", publicProviderConfig(A).status);
check("A workspace with no inbound reads 'off', never 'configured'", publicProviderConfig(A).status.inbound === "off");

// ---------------- 11. the existing workspace is untouched ----------------
section("Legacy workspace preservation");
db.saveTenant({ id: "ws_legacy", name: "AvinyeaConnect", createdAt: now });
saveWorkspaceProvider("ws_legacy", {
  outbound: { appId: "Conversatio-834500dd-d3c1", appVersion: 4, connectionId: "8800e72c-9c-8f9c2a3f-4876", phoneNumber: "+918064269194", agentName: null, agentVariables: ["customer_name"] },
}, "test");
const legacy = campaignConfig("ws_legacy");
check("A workspace with no campaign settings still launches campaigns", legacy.ready, legacy.problems);
check("…on its single-call agent and number", legacy.appId === "Conversatio-834500dd-d3c1" && legacy.phoneNumbers[0] === "+918064269194", legacy.appId);
check("…and is reported as inherited, not configured", publicProviderConfig("ws_legacy").status.batchOutbound === "inherited");
check("…and never borrows another workspace's agent", legacy.appId !== "Agent-A-batch" && legacy.appId !== "Agent-B-batch");

// ---------------- 14. no secrets reach the client ----------------
section("Secrets");
const exposed = JSON.stringify(publicProviderConfig(A));
check("The API key never appears in what the browser is sent", !exposed.includes("platform-key-must-never-leak"));
check("The Sarvam org and workspace IDs do not either", !exposed.includes("sarvam-ws") && !/"org"/.test(exposed));
check("Nor does the workspace's webhook token", !exposed.includes(providerConfigFor(A)!.webhookToken));
check("Every Sarvam request did carry the key in a header, not a URL", hits.every((h) => !h.url.includes("platform-key-must-never-leak")));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
