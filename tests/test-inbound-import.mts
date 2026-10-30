// ============================================================
// Inbound deployment import — parse, save, restore
// ============================================================
//
// The path an administrator actually takes when a workspace gets an inbound
// line: paste Sarvam's create-deployment request, paste the response it
// returned, then save. This suite follows one deployment ID from the paste to
// the saved settings and back into the editor's form.
//
// Nothing here reaches Sarvam. The importers are readers, and the database is
// a throwaway one — see tests/isolated-db.
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("inbound-import");

const { parseSarvamSnippet } = await import("@/lib/providers/sarvam/snippet-import");
const { draftFromSaved, draftToPayload, emptyDraft } = await import("@/lib/providers/draft");
const { createWorkspace } = await import("@/lib/workspaces/create");
const db = await import("@/lib/db");
const { providerConfigFor } = await import("@/lib/providers/config");

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const DEPLOYMENT = "Wellness-Hospital-7b3a9c1d-4e5f";
const APP_ID = "Amrita-Inbound-9f2c";
const CONNECTION = "conn-wellness-01";
const NUMBER = "+918064269111";
const URL = "https://apps.sarvam.ai/api/app-authoring/v1/orgs/org_1/workspaces/ws_1/deployments";

const REQUEST_BODY = `{
  "name": "Wellness Hospital inbound",
  "app_id": "${APP_ID}",
  "app_version": 3,
  "connection_configs": [{ "connection_id": "${CONNECTION}", "phone_numbers": ["${NUMBER}"] }],
  "inbound_config": {
    "start_time": "09:00:00",
    "end_time": "19:00:00",
    "allowed_days": ["Monday", "Tuesday"],
    "timezone": "Asia/Kolkata"
  }
}`;

const RESPONSE_BODY = `{
  "deployment_id": "${DEPLOYMENT}",
  "app_id": "${APP_ID}",
  "app_version": 3,
  "status": "active",
  "connection_configs": [{ "connection_id": "${CONNECTION}", "phone_numbers": ["${NUMBER}"] }],
  "inbound_config": { "start_time": "09:00:00", "end_time": "19:00:00", "allowed_days": ["Monday"], "timezone": "Asia/Kolkata" }
}`;

// ---------------- the create-deployment request ----------------
section("The create-deployment request, however it was copied");

const requestShapes: Array<[string, string]> = [
  ["cURL with --data", `curl --location '${URL}' --header 'x-api-key: sk_SECRET' --data '${REQUEST_BODY}'`],
  ["cURL with --json", `curl --json '${REQUEST_BODY}' '${URL}'`],
  ["Windows cURL, quotes escaped", `curl -X POST "${URL}" ^\n -d "${REQUEST_BODY.replace(/"/g, '\\"')}"`],
  ["the body on its own", REQUEST_BODY],
  ["inside a Markdown code fence", "```json\n" + REQUEST_BODY + "\n```"],
  ["inside a Python example", `url = "${URL}"\npayload = ${REQUEST_BODY}\nrequests.post(url, json=payload)`],
];

for (const [shape, snippet] of requestShapes) {
  const result = parseSarvamSnippet("inbound_deployment", snippet);
  check(
    `Read from ${shape}`,
    result.ok && result.fields.appId === APP_ID && result.fields.connectionId === CONNECTION && result.fields.phoneNumber === NUMBER,
    result.problems.join(" | ") || JSON.stringify(result.fields)
  );
}

const hours = parseSarvamSnippet("inbound_deployment", REQUEST_BODY);
check("Answering hours come through as the form holds them", hours.fields.startTime === "09:00" && hours.fields.endTime === "19:00", hours.fields);
check("The request is not expected to carry a deployment ID", hours.ok && !hours.fields.deploymentId, hours.fields);

const key = parseSarvamSnippet("inbound_deployment", `curl '${URL}' --header 'x-api-key: sk_live_SECRET' --data '${REQUEST_BODY}'`);
check("An API key in the example is dropped, not stored", JSON.stringify(key.fields).includes("sk_live_SECRET") === false);
check("…and the administrator is told it was ignored", key.warnings.some((warning) => /API key/i.test(warning)), key.warnings);

// ---------------- the deployment response ----------------
section("Sarvam's response");

const responseShapes: Array<[string, string]> = [
  ["the response on its own", RESPONSE_BODY],
  ["inside a Markdown code fence", "```json\n" + RESPONSE_BODY + "\n```"],
  ["under a line of prose", `Response (201 Created):\n${RESPONSE_BODY}`],
  ["wrapped in a data envelope", `{ "data": ${RESPONSE_BODY} }`],
  ["as one item of a list response", `{ "items": [${RESPONSE_BODY}] }`],
];

for (const [shape, snippet] of responseShapes) {
  const result = parseSarvamSnippet("deployment_response", snippet);
  check(`deployment_id read from ${shape}`, result.ok && result.fields.deploymentId === DEPLOYMENT, result.problems.join(" | ") || JSON.stringify(result.fields));
}

const fetched = parseSarvamSnippet("deployment_response", `curl --location '${URL}/${DEPLOYMENT}' --header 'x-api-key: k'`);
check("A fetched deployment gives its ID from the URL", fetched.ok && fetched.fields.deploymentId === DEPLOYMENT, fetched.problems.join(" | "));

const empty = parseSarvamSnippet("deployment_response", `{ "status": "active", "app_id": "${APP_ID}" }`);
check("A response with no deployment_id is refused", !empty.ok && !empty.fields.deploymentId);
check("…and says so in those words", empty.problems.some((problem) => /No deployment_id was found/.test(problem)), empty.problems);

const many = parseSarvamSnippet("deployment_response", `{ "items": [${RESPONSE_BODY}, ${RESPONSE_BODY.replace(DEPLOYMENT, "Other-Deployment-1111")}] }`);
check("A list of several deployments is refused rather than guessed", !many.ok && !many.fields.deploymentId, many.fields);

// ---------------- a deployment ID in the wrong box ----------------
section("A deployment ID pasted on its own");

for (const kind of ["inbound_deployment", "deployment_response"] as const) {
  const result = parseSarvamSnippet(kind, `  ${DEPLOYMENT}  `);
  check(`${kind}: refused rather than parsed as a command`, !result.ok);
  check(`${kind}: nothing is filled in on a guess`, result.fields.deploymentId === undefined, result.fields);
  check(`${kind}: the ID is offered for the field it belongs in`, result.fields.deploymentIdCandidate === DEPLOYMENT, result.fields);
  check(`${kind}: the message names that field`, result.problems.some((problem) => /Deployment ID field/i.test(problem)), result.problems);
}

const placeholder = parseSarvamSnippet("deployment_response", "deployment_id");
check("A documentation placeholder is not offered as an ID", placeholder.fields.deploymentIdCandidate === undefined, placeholder.fields);

// ---------------- the other importers are unaffected ----------------
section("The other examples still read as they did");

const outbound = parseSarvamSnippet(
  "instant_outbound",
  `curl --location 'https://apps.sarvam.ai/api/outbounds/v1/orgs/o/workspaces/w/outbounds' --data '{"app_config":{"app_id":"Agent-Out","app_version":2,"connection_config":{"connection_id":"conn-out","agent_phone_number":"+918064269194"}}}'`
);
check("Single outbound still reads", outbound.ok && outbound.fields.appId === "Agent-Out" && outbound.fields.connectionId === "conn-out", outbound.problems.join(" | "));

const campaign = parseSarvamSnippet(
  "create_campaign",
  `curl --location 'https://apps.sarvam.ai/api/scheduling/v1/orgs/o/workspaces/w/campaigns' --data '{"app_config":{"app_id":"Agent-Batch","app_version":4,"connection_configs":[{"connection_id":"conn-batch","phone_numbers":["+918064269195"]}]}}'`
);
check("Batch campaign still reads", campaign.ok && campaign.fields.appId === "Agent-Batch" && campaign.fields.connectionId === "conn-batch", campaign.problems.join(" | "));

const callers = parseSarvamSnippet(
  "known_callers",
  `curl --location 'https://apps.sarvam.ai/api/scheduling/v1/orgs/o/workspaces/w/deployments/${DEPLOYMENT}/cohorts/stream' --data '{"name":"Known callers","users":[{"user_phone_number":"+919800000001"}]}'`
);
check("The known-caller list still reads its own endpoint", callers.ok && callers.fields.deploymentId === DEPLOYMENT, callers.problems.join(" | "));
check("…and its example callers are still discarded", JSON.stringify(callers.fields).includes("9800000001") === false, callers.fields);

// ---------------- paste → form → saved → back into the form ----------------
section("From the paste to the saved workspace and back");

const draft = emptyDraft();
draft.single = { ...draft.single, appId: "Agent-Out", appVersion: "2", connectionId: "conn-out", phoneNumber: "+918064269194" };

// Exactly what the editor does with each parse.
const requestFields = parseSarvamSnippet("inbound_deployment", `curl '${URL}' --data '${REQUEST_BODY}'`).fields;
const responseFields = parseSarvamSnippet("deployment_response", RESPONSE_BODY).fields;
draft.inbound = {
  ...draft.inbound,
  on: true,
  appId: String(requestFields.appId ?? ""),
  appVersion: String(requestFields.appVersion ?? ""),
  connectionId: String(requestFields.connectionId ?? ""),
  phoneNumber: String(requestFields.phoneNumber ?? ""),
  startTime: String(requestFields.startTime ?? draft.inbound.startTime),
  endTime: String(requestFields.endTime ?? draft.inbound.endTime),
  timezone: String(requestFields.timezone ?? draft.inbound.timezone),
  deploymentId: String(responseFields.deploymentId ?? ""),
};

const payload = draftToPayload(draft);
check("The deployment ID reaches the save payload", payload.inbound?.deploymentId === DEPLOYMENT, payload.inbound);
check("…and the agent ID is not confused with it", payload.inbound?.appId === APP_ID && payload.inbound?.appId !== payload.inbound?.deploymentId);
check("…nor the connection ID", payload.inbound?.connectionId === CONNECTION);
check("…nor the inbound number", payload.inbound?.phoneNumber === NUMBER);

const owner = db.saveUser({
  id: "user_owner", tenantId: "", email: "owner@example.test", name: "Owner",
  passwordHash: "x", role: "owner", createdAt: new Date().toISOString(),
  lastLoginAt: null, lockedUntil: null, failedAttempts: 0,
} as never);

// Built the way the creation wizard builds it: the same payload, from the
// same draft the pastes filled in.
const created = createWorkspace(
  {
    businessName: "Wellness Hospital",
    company: { companyName: "Wellness Hospital", productName: "Amrita", industry: "Healthcare" },
    outbound: { ...payload.outbound, agentName: "Amrita", agentVariables: [] },
    batch: payload.batch,
    inboundAgent: {
      appId: payload.inbound!.appId,
      appVersion: payload.inbound!.appVersion,
      connectionId: payload.inbound!.connectionId,
      agentVariables: [],
    },
    inboundLine: {
      phoneNumber: payload.inbound!.phoneNumber,
      startTime: payload.inbound!.startTime,
      endTime: payload.inbound!.endTime,
      days: payload.inbound!.days,
      timezone: payload.inbound!.timezone,
      handoffNumber: payload.inbound!.handoffNumber,
      afterHoursMessage: null,
      deploymentId: payload.inbound!.deploymentId,
    },
  } as never,
  owner.id
);
check("The workspace was created", created.ok === true, "problems" in created ? created.problems : "");

const tenantId = created.ok ? created.tenant.id : "";
const saved = db.getInboundSettings(tenantId);
check("The deployment ID is saved against this workspace", saved?.deploymentId === DEPLOYMENT, saved);
check("The inbound number is saved with it", saved?.phoneNumber === NUMBER, saved);
check("A new line is saved switched off, as it was before", saved?.enabled === false, saved);

const config = providerConfigFor(tenantId);
check("The inbound agent is saved in the provider config", config?.inbound?.appId === APP_ID, config?.inbound);
check("The provider config does not hold a deployment ID of its own", !JSON.stringify(config?.inbound ?? {}).includes(DEPLOYMENT), config?.inbound);

// What the Settings editor builds when it opens on this workspace.
const reopened = draftFromSaved({
  outbound: config?.outbound ?? null,
  batch: config?.batch ?? null,
  inbound: config?.inbound ?? null,
  inboundSettings: saved ?? null,
});
check("Reopening the editor shows the deployment ID", reopened.inbound.deploymentId === DEPLOYMENT, reopened.inbound);
check("…with the inbound line switched on", reopened.inbound.on === true, reopened.inbound);
check("…and the agent, connection and number in their own fields", reopened.inbound.appId === APP_ID && reopened.inbound.connectionId === CONNECTION && reopened.inbound.phoneNumber === NUMBER, reopened.inbound);
check("Saving again keeps the same deployment ID", draftToPayload(reopened).inbound?.deploymentId === DEPLOYMENT);

// ---------------- one deployment, one workspace ----------------
section("A deployment belongs to one workspace");

const { validateInboundInput } = await import("@/lib/inbound/service");
const other = db.saveTenant({ id: "ws_other", name: "Someone else", createdAt: new Date().toISOString() });
const taken = validateInboundInput(other.id, {
  phoneNumber: "+918064269222", startTime: "09:00", endTime: "18:00",
  days: ["Monday"], timezone: "Asia/Kolkata", deploymentId: DEPLOYMENT,
} as never);
check("Another workspace cannot claim the same deployment", taken.problems.length > 0, taken.problems);
check("…and the first workspace keeps it", db.getInboundSettings(tenantId)?.deploymentId === DEPLOYMENT);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
