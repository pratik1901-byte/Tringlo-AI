// ============================================================
// Editing an existing workspace's voice provider configuration
// ============================================================
//
// The point of this suite: the importer that workspace creation uses must work
// just as well a month later, over values that are already saved, without the
// workspace being recreated — and without one workspace ever reaching another.
//
// Sarvam is simulated. No call is placed and no deployment is created,
// replaced or activated.
// ============================================================

process.env.SARVAM_API_KEY = "platform-key-must-never-leak";
process.env.SARVAM_ORG_ID = "org-id";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("provider-editing");

// Any request to Sarvam is recorded. Writes to Sarvam would be a failure here.
interface Hit { url: string; method: string }
const hits: Hit[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  hits.push({ url, method: init?.method ?? "GET" });
  if (!url.startsWith("https://apps.sarvam.ai/")) {
    return new Response(JSON.stringify({ error: "unexpected host" }), { status: 500 });
  }
  return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const db = await import("@/lib/db");
const { saveWorkspaceProvider, providerConfigFor, publicProviderConfig, markProviderVerified } = await import("@/lib/providers/config");
const { parseSarvamSnippet } = await import("@/lib/providers/sarvam/snippet-import");
const editor = await import("@/lib/providers/draft");
type VoiceProviderDraft = import("@/lib/providers/draft").VoiceProviderDraft;
const providerRoute = await import("@/app/api/integrations/provider/route");
const inboundRoute = await import("@/app/api/inbound/settings/route");
const { saveInboundDraft } = await import("@/lib/inbound/service");
const { hashSessionToken } = await import("@/lib/auth/sessions");
const { NextRequest } = await import(new URL("../node_modules/next/server.js", import.meta.url).href);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const ORG = "https://apps.sarvam.ai/api";

// ---------------- two workspaces, one of them long-standing ----------------
const now = new Date().toISOString();
const A = "ws_alpha";
const B = "ws_beta";
db.saveTenant({ id: A, name: "Alpha Finance", createdAt: now });
db.saveTenant({ id: B, name: "Beta Logistics", createdAt: now });
db.saveWebhookBaseUrl("https://tringlo.example.com");

// A signed-in owner for each, so the routes run exactly as they really do.
const sessionFor = (tenantId: string, email: string, token: string) => {
  db.saveUser({
    id: `user_${tenantId}`, tenantId, email, name: "Owner", role: "owner",
    passwordHash: "x", createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0,
  });
  db.saveSession({
    id: `s_${tenantId}`, tokenHash: hashSessionToken(token), userId: `user_${tenantId}`, tenantId,
    createdAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), lastSeenAt: now, client: "test",
  });
  db.grantMembership({ userId: `user_${tenantId}`, tenantId, role: "owner" });
  return { authorization: `Bearer ${token}` };
};
const authA = sessionFor(A, "owner-a@example.com", "token-alpha-0000000000000000000");
const authB = sessionFor(B, "owner-b@example.com", "token-beta-00000000000000000000");

const request = (url: string, auth: Record<string, string>, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    headers: { ...auth, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

// Workspace A as it stands before any editing: agent A, no campaign settings.
saveWorkspaceProvider(A, {
  outbound: { appId: "Agent-A", appVersion: 4, connectionId: "conn-a", phoneNumber: "+918000000001", agentName: null, agentVariables: ["customer_name"] },
}, "setup");
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B", appVersion: 9, connectionId: "conn-b", phoneNumber: "+918000000002", agentName: null, agentVariables: [] },
}, "setup");

// ---------------- 1 + 2. the editor opens on what is saved ----------------
section("Opening the editor on an existing workspace");
const savedA = publicProviderConfig(A);
const draftA = editor.draftFromSaved({
  outbound: savedA.outbound as never,
  batch: savedA.batch as never,
  inbound: savedA.inbound as never,
  inboundSettings: null,
});
check("The editor opens with the saved agent already filled in", draftA.single.appId === "Agent-A", draftA.single);
check("…the saved version", draftA.single.appVersion === "4");
check("…the saved connection", draftA.single.connectionId === "conn-a");
check("…and the saved caller number", draftA.single.phoneNumber === "+918000000001");
check("A workspace with no campaign settings opens with 'same as single calls' ticked", draftA.batch.sameAsSingle === true);
check("Inbound opens switched off when the workspace has none", draftA.inbound.on === false);
check("Opening the editor writes nothing", providerConfigFor(A)!.outbound!.appId === "Agent-A" && hits.length === 0, hits.length);
check("The draft it builds is complete enough to save unchanged", editor.draftProblems(draftA).length === 0, editor.draftProblems(draftA));

// ---------------- 3. importing a new single-outbound agent ----------------
section("Section A — replacing the agent by pasting an example");
const outboundExample = `curl --location '${ORG}/outbounds/v1/orgs/o/workspaces/w/outbounds' \\
--header 'X-API-Key: sk_live_SECRET' \\
--data '{"app_config":{"app_id":"Agent-B-new","app_version":7,"connection_config":{"connection_id":"conn-new","agent_phone_number":"+918000000099"},"agent_variables":{"customer_name":"Asha"}},"user_config":{"user_phone_number":"+919800000001"},"webhook_config":{"url":"https://example.com/hook"}}'`;
const parsedOutbound = parseSarvamSnippet("instant_outbound", outboundExample);
check("A valid Instant Outbound example is accepted", parsedOutbound.ok, parsedOutbound.problems);
check("…and gives the new agent, version, connection and number", parsedOutbound.fields.appId === "Agent-B-new" && parsedOutbound.fields.appVersion === 7 && parsedOutbound.fields.connectionId === "conn-new" && parsedOutbound.fields.phoneNumber === "+918000000099", parsedOutbound.fields);
check("The pasted API key is not among them", !JSON.stringify(parsedOutbound.fields).includes("SECRET"));
check("Nor the customer's number, the variables or the webhook", !JSON.stringify(parsedOutbound.fields).includes("919800000001") && !JSON.stringify(parsedOutbound.fields).includes("Asha") && !JSON.stringify(parsedOutbound.fields).includes("example.com"));

// What the editor does with it: merge over the saved values.
const editedA: VoiceProviderDraft = {
  ...draftA,
  single: {
    appId: String(parsedOutbound.fields.appId),
    appVersion: String(parsedOutbound.fields.appVersion),
    connectionId: String(parsedOutbound.fields.connectionId),
    phoneNumber: String(parsedOutbound.fields.phoneNumber),
    agentVariables: "",
    mappings: [],
    useOwnGreeting: false,
  },
};
const payloadA = editor.draftToPayload(editedA);
const putA = await providerRoute.PUT(request("http://localhost/api/integrations/provider", authA, "PUT", {
  outbound: payloadA.outbound, batch: payloadA.batch, inbound: null,
}));
check("Saving the change is accepted", putA.status === 200, putA.status);
check("The workspace now uses the new agent", providerConfigFor(A)!.outbound!.appId === "Agent-B-new", providerConfigFor(A)!.outbound);
check("…at the new version, connection and number", (() => {
  const o = providerConfigFor(A)!.outbound!;
  return o.appVersion === 7 && o.connectionId === "conn-new" && o.phoneNumber === "+918000000099";
})(), providerConfigFor(A)!.outbound);
check("The workspace was not recreated — same row, same webhook token", providerConfigFor(A)!.tenantId === A && providerConfigFor(A)!.webhookToken.startsWith("ws_"));
check("Nothing was sent to Sarvam by saving", hits.length === 0, hits);

// ---------------- 13 + 14 + 18. the other workspace is untouched ----------------
section("One workspace cannot reach another");
check("Workspace B still has its own agent", providerConfigFor(B)!.outbound!.appId === "Agent-B", providerConfigFor(B)!.outbound);
check("…its own version, connection and number", (() => {
  const o = providerConfigFor(B)!.outbound!;
  return o.appVersion === 9 && o.connectionId === "conn-b" && o.phoneNumber === "+918000000002";
})());
check("…and a different webhook token", providerConfigFor(A)!.webhookToken !== providerConfigFor(B)!.webhookToken);

// B's own session must only ever edit B, whatever the body says.
const putAsB = await providerRoute.PUT(request("http://localhost/api/integrations/provider", authB, "PUT", {
  tenantId: A, companyId: A, workspace: A,
  outbound: { appId: "Hijacked", appVersion: 1, connectionId: "c", phoneNumber: "+918000000003" },
}));
check("B saving while naming A in the body is scoped to B", putAsB.status === 200, putAsB.status);
check("…so A is untouched", providerConfigFor(A)!.outbound!.appId === "Agent-B-new", providerConfigFor(A)!.outbound!.appId);
check("…and B changed its own row only", providerConfigFor(B)!.outbound!.appId === "Hijacked");
const unauthenticated = await providerRoute.PUT(
  new NextRequest("http://localhost/api/integrations/provider", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ outbound: { appId: "X", appVersion: 1, connectionId: "c", phoneNumber: "+91" } }) })
);
check("A request with no session is refused", unauthenticated.status === 401, unauthenticated.status);
// Put B back as it was.
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B", appVersion: 9, connectionId: "conn-b", phoneNumber: "+918000000002", agentName: null, agentVariables: [] },
}, "setup");

// ---------------- 4. create campaign ----------------
section("Section B — campaign settings from an example");
const campaignExample = `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{
  "name":"April batch","app_config":{"app_id":"Agent-Batch","app_version":3,"app_type":"agent","attempts_per_second":4,
  "connection_configs":[{"connection_id":"conn-batch","phone_numbers":["+918000000011","+918000000012"]}],
  "retry_config":{"max_retries":5,"retry_interval_minutes":15,"retry_on":{"busy":{"enabled":true},"no_answer":{"enabled":false},"failed":{"enabled":false},"short_duration":{"enabled":true,"threshold_seconds":30}}},
  "webhook_config":{"url":"https://example.com/c"}},
  "start_timestamp":"2027-04-01T09:00:00Z","end_timestamp":"2027-04-02T19:00:00Z",
  "allowed_schedule":{"timezone":"Asia/Kolkata","allowed_start_time":"11:00","allowed_end_time":"17:00","allowed_days":["Monday","Saturday"]}}'`;
const parsedCampaign = parseSarvamSnippet("create_campaign", campaignExample);
check("A valid Create Campaign example is accepted", parsedCampaign.ok, parsedCampaign.problems);
check("…giving the batch agent, version and rate", parsedCampaign.fields.appId === "Agent-Batch" && parsedCampaign.fields.appVersion === 3 && parsedCampaign.fields.attemptsPerSecond === 4, parsedCampaign.fields);
check("…the connection and the whole number pool", parsedCampaign.fields.connectionId === "conn-batch" && JSON.stringify(parsedCampaign.fields.phoneNumbers) === JSON.stringify(["+918000000011", "+918000000012"]));
check("…the retry rules", JSON.stringify(parsedCampaign.fields.retry) === JSON.stringify({ maxRetries: 5, intervalMinutes: 15, onBusy: true, onNoAnswer: false, onFailed: false, onShortDuration: true, shortDurationSeconds: 30 }), parsedCampaign.fields.retry);
check("…and the allowed hours, days and timezone", JSON.stringify(parsedCampaign.fields.schedule) === JSON.stringify({ timezone: "Asia/Kolkata", startTime: "11:00", endTime: "17:00", days: ["Monday", "Saturday"] }), parsedCampaign.fields.schedule);
check("The campaign's own name and dates are not workspace settings", !JSON.stringify(parsedCampaign.fields).includes("April batch") && !JSON.stringify(parsedCampaign.fields).includes("2027-04-01"));

const withBatch: VoiceProviderDraft = {
  ...editedA,
  batch: {
    ...editedA.batch,
    sameAsSingle: false,
    appId: "Agent-Batch", appVersion: "3", connectionId: "conn-batch",
    phoneNumbers: "+918000000011, +918000000012",
    attemptsPerSecond: "4", maxRetries: "5", retryInterval: "15",
    onBusy: true, onNoAnswer: false,
    startTime: "11:00", endTime: "17:00", days: ["Monday", "Saturday"], timezone: "Asia/Kolkata",
  },
};
const payloadB = editor.draftToPayload(withBatch);
const putBatch = await providerRoute.PUT(request("http://localhost/api/integrations/provider", authA, "PUT", {
  outbound: payloadB.outbound, batch: payloadB.batch, inbound: null,
}));
check("Campaign settings save against this workspace", putBatch.status === 200, putBatch.status);
const storedBatch = providerConfigFor(A)!.batch!;
check("…with their own agent, not the single-call one", storedBatch.appId === "Agent-Batch" && storedBatch.appVersion === 3, storedBatch);
check("…the number pool intact", JSON.stringify(storedBatch.phoneNumbers) === JSON.stringify(["+918000000011", "+918000000012"]));
check("…the retry rules and schedule", storedBatch.retry.maxRetries === 5 && storedBatch.schedule.startTime === "11:00" && storedBatch.schedule.days.length === 2, storedBatch.schedule);
check("Campaigns are now reported as configured in their own right", publicProviderConfig(A).status.batchOutbound === "saved", publicProviderConfig(A).status);
check("…and the single-call settings were not disturbed", providerConfigFor(A)!.outbound!.appId === "Agent-B-new");

// Inherited vs separate must be a visible choice, never a silent switch.
const reuse = editor.draftToPayload({ ...withBatch, batch: { ...withBatch.batch, sameAsSingle: true } });
check("Ticking 'same as single calls' copies the single-call values across", reuse.batch.appId === "Agent-B-new" && reuse.batch.phoneNumbers[0] === "+918000000099", reuse.batch);
check("Unticking it keeps the campaign's own values", payloadB.batch.appId === "Agent-Batch");

// ---------------- 5 + 6. cohort upload stays honestly unavailable ----------------
section("Upload cohort — recognised, still not enabled");
const cohortExample = `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/cmp-999/cohorts/upload' --form 'cohort_file=@"leads.csv"' --form 'cohort_transformation_file=@"t.json"'`;
const parsedCohort = parseSarvamSnippet("upload_cohort", cohortExample);
check("A valid Upload Cohort example is recognised", parsedCohort.ok, parsedCohort.problems);
check("…and says plainly that direct CSV upload is not enabled", parsedCohort.warnings.some((w) => /not enabled/i.test(w) && /Stream cohort/i.test(w)), parsedCohort.warnings);
check("The example's campaign ID is never stored as a workspace default", !JSON.stringify(parsedCohort.fields).includes("cmp-999"));
check("Lead submission still reports the honest state", publicProviderConfig(A).status.leadSubmission === "saved", publicProviderConfig(A).status.leadSubmission);
check("Streaming remains what is stored", providerConfigFor(A)!.batch!.cohortMode === "stream");
const forceUpload = saveWorkspaceProvider(A, { batch: { ...storedBatch, cohortMode: "upload" } }, "test");
check("Choosing CSV upload is still refused at save", !forceUpload.ok, forceUpload.problems);
check("…and the stored method is unchanged", providerConfigFor(A)!.batch!.cohortMode === "stream");

// ---------------- 7. pause / resume ----------------
section("Pause / resume — endpoint only");
const pauseExample = `curl --request PUT '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/cmp-555/status' --data '{"action":"pause"}'`;
const parsedPause = parseSarvamSnippet("pause_resume", pauseExample);
check("A valid Pause / Resume example is recognised", parsedPause.ok, parsedPause.problems);
check("The sample campaign ID is not saved as a workspace default", !JSON.stringify(parsedPause.fields).includes("cmp-555") && !JSON.stringify(providerConfigFor(A)).includes("cmp-555"));
check("…and it says the campaign is chosen per campaign", parsedPause.warnings.some((w) => /campaign you choose/i.test(w)), parsedPause.warnings);
check("An unsupported action is refused", !parseSarvamSnippet("pause_resume", `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns/c/status' --data '{"action":"detonate"}'`).ok);

// ---------------- 8 + 10. inbound deployment request ----------------
section("Section C — inbound deployment request");
const deploymentRequest = `curl '${ORG}/app-authoring/v1/orgs/o/workspaces/w/deployments' --data '{
  "name":"Line","app_id":"Agent-Inbound","app_version":11,
  "connection_configs":[{"connection_id":"conn-in","phone_numbers":["+918064269100"]}],
  "inbound_config":{"start_time":"08:00:00","end_time":"20:00:00","allowed_days":["Monday","Sunday"],"timezone":"Asia/Kolkata"},
  "webhook_config":{"url":"https://example.com/in"}}'`;
const parsedDeployment = parseSarvamSnippet("inbound_deployment", deploymentRequest);
check("A deployment request is accepted", parsedDeployment.ok, parsedDeployment.problems);
check("…giving the inbound agent, version, connection and number", parsedDeployment.fields.appId === "Agent-Inbound" && parsedDeployment.fields.appVersion === 11 && parsedDeployment.fields.connectionId === "conn-in" && parsedDeployment.fields.phoneNumber === "+918064269100", parsedDeployment.fields);
check("…and the answering hours, days and timezone", parsedDeployment.fields.startTime === "08:00" && parsedDeployment.fields.endTime === "20:00" && parsedDeployment.fields.timezone === "Asia/Kolkata" && Array.isArray(parsedDeployment.fields.days));
check("A request carries no deployment ID, and none is invented", !("deploymentId" in parsedDeployment.fields), parsedDeployment.fields);

// ---------------- 9. the deployment ID comes from the response ----------------
section("Deployment ID, from Sarvam's response");
const deploymentResponse = `{
  "deployment_id":"Tringlo-AI-9f3c21aa-77be","name":"Line","status":"active",
  "app_id":"Agent-Inbound","app_version":11,
  "connection_configs":[{"connection_id":"conn-in","phone_numbers":["+918064269100"]}],
  "inbound_config":{"start_time":"08:00:00","end_time":"20:00:00","allowed_days":["Monday"],"timezone":"Asia/Kolkata"}}`;
const parsedResponse = parseSarvamSnippet("deployment_response", deploymentResponse);
check("A deployment response is accepted", parsedResponse.ok, parsedResponse.problems);
check("…and yields the real deployment ID", parsedResponse.fields.deploymentId === "Tringlo-AI-9f3c21aa-77be", parsedResponse.fields);
check("…along with whatever else it states", parsedResponse.fields.appId === "Agent-Inbound" && parsedResponse.fields.phoneNumber === "+918064269100");
check("…and notes that saving does not change the line's state", parsedResponse.warnings.some((w) => /Saving does not change that/i.test(w)), parsedResponse.warnings);
const noId = parseSarvamSnippet("deployment_response", `{"name":"Line","status":"active","app_id":"Agent-Inbound","app_version":11}`);
check("A response without a deployment ID invents none", !noId.ok && !("deploymentId" in noId.fields), noId.fields);
check("…and says where to get one", noId.problems.some((p) => /deployment_id/.test(p)), noId.problems);
const listResponse = parseSarvamSnippet("deployment_response", `{"items":[{"deployment_id":"Tringlo-AI-one"},{"deployment_id":"Tringlo-AI-two"}]}`);
check("A response listing several deployments refuses to guess which", !listResponse.ok && !("deploymentId" in listResponse.fields), listResponse.problems);

// Saving the inbound line's settings, including the new deployment ID.
const inboundDraft: VoiceProviderDraft = {
  ...withBatch,
  inbound: {
    on: true, appId: "Agent-Inbound", appVersion: "11", connectionId: "conn-in",
    phoneNumber: "+918064269100", deploymentId: "Tringlo-AI-9f3c21aa-77be", handoffNumber: "+918000000055",
    startTime: "08:00", endTime: "20:00", days: ["Monday", "Tuesday"], timezone: "Asia/Kolkata",
  },
};
const inboundPayload = editor.draftToPayload(inboundDraft);
const putInbound = await inboundRoute.PUT(request("http://localhost/api/inbound/settings", authA, "PUT", {
  phoneNumber: inboundPayload.inbound!.phoneNumber,
  deploymentId: inboundPayload.inbound!.deploymentId,
  handoffNumber: inboundPayload.inbound!.handoffNumber,
  startTime: inboundPayload.inbound!.startTime,
  endTime: inboundPayload.inbound!.endTime,
  days: inboundPayload.inbound!.days,
  timezone: inboundPayload.inbound!.timezone,
}));
check("The inbound settings save", putInbound.status === 200, putInbound.status);
const inboundStored = db.getInboundSettings(A)!;
check("…with the new deployment ID", inboundStored.deploymentId === "Tringlo-AI-9f3c21aa-77be", inboundStored.deploymentId);
check("…and the number people will call", inboundStored.phoneNumber === "+918064269100");
check("Saving did not switch the line on", inboundStored.enabled === false, inboundStored.enabled);
check("…and created nothing at Sarvam", !hits.some((h) => h.method === "POST" || h.method === "PUT"), hits);

// A deployment already answering for another workspace cannot be taken.
saveInboundDraft(B, {
  phoneNumber: "+918099990000", deploymentId: "Tringlo-AI-beta-owned",
  startTime: "09:00", endTime: "18:00", days: ["Monday"], timezone: "Asia/Kolkata",
  handoffNumber: null, afterHoursMessage: null,
} as never);
const stealDeployment = await inboundRoute.PUT(request("http://localhost/api/inbound/settings", authA, "PUT", {
  phoneNumber: "+918064269100", deploymentId: "Tringlo-AI-beta-owned",
  startTime: "08:00", endTime: "20:00", days: ["Monday"], timezone: "Asia/Kolkata",
}));
check("A deployment owned by another workspace is refused", stealDeployment.status === 400, stealDeployment.status);
check("…naming the reason", /another workspace/i.test(JSON.stringify(await stealDeployment.json())));
check("…and A keeps its own deployment", db.getInboundSettings(A)!.deploymentId === "Tringlo-AI-9f3c21aa-77be");
const stealNumber = await inboundRoute.PUT(request("http://localhost/api/inbound/settings", authA, "PUT", {
  phoneNumber: "+918099990000", startTime: "08:00", endTime: "20:00", days: ["Monday"], timezone: "Asia/Kolkata",
}));
check("An inbound number owned by another workspace is refused too", stealNumber.status === 400, stealNumber.status);

// ---------------- 11. a partial import keeps what it does not mention ----------------
section("Partial imports preserve what is already there");
const onlyAgent = parseSarvamSnippet("instant_outbound", `curl '${ORG}/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{"app_config":{"app_id":"Agent-Only","app_version":12}}'`);
check("An example with only the agent is reported incomplete", !onlyAgent.ok, onlyAgent.problems);
check("…but what it did contain is still read", onlyAgent.fields.appId === "Agent-Only" && onlyAgent.fields.appVersion === 12, onlyAgent.fields);
// The editor merges field by field, which is what keeps the rest alive.
const merged = {
  appId: onlyAgent.fields.appId ? String(onlyAgent.fields.appId) : inboundDraft.single.appId,
  appVersion: onlyAgent.fields.appVersion ? String(onlyAgent.fields.appVersion) : inboundDraft.single.appVersion,
  connectionId: onlyAgent.fields.connectionId ? String(onlyAgent.fields.connectionId) : inboundDraft.single.connectionId,
  phoneNumber: onlyAgent.fields.phoneNumber ? String(onlyAgent.fields.phoneNumber) : inboundDraft.single.phoneNumber,
};
check("Merging it keeps the stored connection ID", merged.connectionId === "conn-new", merged);
check("…and the stored caller number", merged.phoneNumber === "+918000000099");
check("…while taking the new agent and version", merged.appId === "Agent-Only" && merged.appVersion === "12");

// ---------------- 12. a rejected import changes nothing ----------------
section("Invalid imports overwrite nothing");
const beforeBad = JSON.stringify(providerConfigFor(A));
for (const bad of [
  "",
  `curl 'https://evil.example.com/api/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{"app_config":{"app_id":"Evil"}}'`,
  `curl '${ORG}/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{}'`,
  `curl '${ORG}/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{ broken'`,
  `curl '${ORG}/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{"app_config":{"app_id":"<your-app-id>","app_version":"string","connection_config":{"connection_id":"connection_id","agent_phone_number":"+91XXXXXXXXXX"}}}'`,
]) {
  const result = parseSarvamSnippet("instant_outbound", bad);
  const label = bad.slice(0, 30).replace(/\s+/g, " ") || "an empty box";
  check(`Refused, with nothing to write: ${label}`, !result.ok && Object.keys(result.fields).length === 0, result.fields);
}
check("The saved configuration is byte-for-byte unchanged", JSON.stringify(providerConfigFor(A)) === beforeBad);

// ---------------- 16. verification lapses when settings change ----------------
section("Provider verification");
markProviderVerified(A);
check("A real provider check marks the configuration verified", publicProviderConfig(A).status.singleOutbound === "verified", publicProviderConfig(A).status);
const afterEdit = editor.draftToPayload(inboundDraft);
await providerRoute.PUT(request("http://localhost/api/integrations/provider", authA, "PUT", {
  outbound: { ...afterEdit.outbound, appId: "Agent-Changed-Again" },
  batch: afterEdit.batch,
}));
check("Changing the agent retires that verification", publicProviderConfig(A).status.singleOutbound === "saved", publicProviderConfig(A).status);
check("…so nothing claims to be verified merely because an import parsed", publicProviderConfig(A).status.batchOutbound !== "verified");
check("An import on its own never marks anything verified", (() => {
  const fresh = parseSarvamSnippet("instant_outbound", outboundExample);
  return fresh.ok && !JSON.stringify(fresh.fields).includes("verified");
})());

// ---------------- 15. no secrets reach the browser ----------------
section("Secrets");
const exposed = JSON.stringify(publicProviderConfig(A));
check("The API key is not in what the browser is sent", !exposed.includes("platform-key-must-never-leak"));
check("Neither is the Sarvam org or workspace ID", !exposed.includes("sarvam-ws") && !exposed.includes("org-id"));
check("Nor the workspace's webhook token", !exposed.includes(providerConfigFor(A)!.webhookToken));
const inboundPublic = JSON.stringify(await (await inboundRoute.GET(request("http://localhost/api/inbound/settings", authA, "GET"))).json());
check("The inbound settings the browser gets carry no token or key", !inboundPublic.includes(providerConfigFor(A)!.webhookToken) && !inboundPublic.includes("platform-key-must-never-leak"));

// ---------------- 17. the creation wizard still works ----------------
section("Workspace creation still works");
const freshDraft = editor.emptyDraft();
check("A new workspace starts from an empty draft", freshDraft.single.appId === "" && freshDraft.inbound.on === false);
check("…which is refused until it is filled in", editor.draftProblems(freshDraft).length > 0);
const filled: VoiceProviderDraft = {
  ...freshDraft,
  single: { appId: "Agent-New", appVersion: "2", connectionId: "conn-new-ws", phoneNumber: "+918000000077", agentVariables: "", mappings: [], useOwnGreeting: false },
};
check("…and accepted once the required fields are there", editor.draftProblems(filled).length === 0, editor.draftProblems(filled));
const newPayload = editor.draftToPayload(filled);
check("Its payload carries the single-call settings", newPayload.outbound.appId === "Agent-New" && newPayload.outbound.appVersion === 2);
check("…campaigns inheriting them by default", newPayload.batch.appId === "Agent-New" && newPayload.batch.phoneNumbers[0] === "+918000000077");
check("…and inbound left out entirely", newPayload.inbound === null);
const bootstrap = await import("@/app/api/auth/bootstrap/route");
check("The creation endpoint is still there, unchanged in shape", typeof bootstrap.POST === "function");

// ---------------- 10 (data). history survives an edit ----------------
section("History survives a configuration change");
db.saveLead({ id: "lead_keep", tenantId: A, name: "Asha", phone: "+919800000001", status: "queued", suppressed: false, createdAt: now } as never);
db.saveCampaignRun({
  id: "cmp_keep", tenantId: A, name: "Earlier", status: "completed", providerStatus: "ended",
  providerCampaignId: "Camp-earlier", cohortName: "c", providerCohortId: "coh-earlier", cohortStatus: "completed",
  cohortResult: { total: 1, valid: 1, rejected: 0 }, cohortMode: "stream",
  appId: "Agent-A", appVersion: 4, connectionId: "conn-a", phoneNumbers: ["+918000000001"],
  attemptsPerSecond: 1, retry: {} as never, schedule: {} as never,
  members: [{ leadId: "lead_keep", phone: "+919800000001", name: "Asha", hadMemory: false }],
  failureReason: null, webhookUrl: "https://tringlo.example.com/hook", createdBy: "u",
  createdAt: now, updatedAt: now, launchedAt: now, lastSyncedAt: null,
} as never);
await providerRoute.PUT(request("http://localhost/api/integrations/provider", authA, "PUT", {
  outbound: { appId: "Agent-Latest", appVersion: 15, connectionId: "conn-latest", phoneNumber: "+918000000088" },
}));
const keptCampaign = db.getCampaignRun(A, "cmp_keep")!;
check("An earlier campaign keeps the agent it ran on", keptCampaign.appId === "Agent-A" && keptCampaign.appVersion === 4, keptCampaign.appId);
check("…its Sarvam campaign and cohort IDs", keptCampaign.providerCampaignId === "Camp-earlier" && keptCampaign.providerCohortId === "coh-earlier");
check("…and its membership", keptCampaign.members.length === 1 && keptCampaign.members[0].leadId === "lead_keep");
check("The lead is still there", db.getLead("lead_keep")?.name === "Asha");
check("New calls will use the new agent", providerConfigFor(A)!.outbound!.appId === "Agent-Latest");

// ---------------- 19. nothing live happened ----------------
section("Nothing live was touched");
check("Every request made to Sarvam was a read", hits.every((h) => h.method === "GET"), hits);
check("Nothing was created, changed or dialled", !hits.some((h) => ["POST", "PUT", "PATCH", "DELETE"].includes(h.method)), hits);
check("…and no outbound-call endpoint was touched at all", !hits.some((h) => /\/outbounds|\/campaigns/.test(h.url)), hits);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
