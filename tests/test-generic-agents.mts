// ============================================================
// Agents of any kind — what Tringlo sends, and what it does not
// ============================================================
//
// The failure this exists to prevent, in one sentence: an agent that declares
// none of customer_name, phone_number or company_name was refused a call,
// because Tringlo sent them anyway.
//
//   "The Sarvam agent Amrita---We-4517816a-a47a does not declare
//    customer_name, phone_number, company_name."
//
// So this suite builds real outbound requests for agents from several
// industries — a hospital, a recruiter, a school, the original sales agent —
// and checks that each receives exactly what its own configuration says and
// nothing else, while the provider's own transport fields always travel.
//
// The request is intercepted at `fetch`: the real service builds it and
// nothing reaches Sarvam. No call is placed. The database is a throwaway one.
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("generic-agents");

process.env.SARVAM_API_KEY = "test-key-not-a-real-credential";
process.env.SARVAM_ORG_ID = "org_test";
process.env.SARVAM_WORKSPACE_ID = "ws_test";

interface Sent {
  url: string;
  body: Record<string, unknown>;
  apiKey: string | null;
}

let lastSent: Sent | null = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { attempt_id: "attempt_1" } };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  lastSent = {
    url: String(input),
    body: JSON.parse(String(init?.body ?? "{}")),
    apiKey: headers.get("api-subscription-key") ?? headers.get("x-api-key"),
  };
  return new Response(JSON.stringify(nextResponse.body), {
    status: nextResponse.status,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const db = await import("@/lib/db");
const { saveWorkspaceProvider, resolveOutbound, resolveBatch, providerConfigFor } = await import("@/lib/providers/config");
const { sarvamVoiceService } = await import("@/lib/providers/sarvam/voice-agents");
const { SALES_AGENT_VARIABLES } = await import("@/lib/providers/sarvam/variables");
const { resolveMappings, parseMappings } = await import("@/lib/providers/variable-mapping");
const { validateCampaignCsv } = await import("@/lib/campaigns/csv");

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

const now = new Date().toISOString();

/** Sets a workspace up with one agent and whatever it declares. */
const workspace = (
  id: string,
  name: string,
  company: Record<string, string>,
  outbound: Record<string, unknown>
) => {
  db.saveTenant({ id, name, createdAt: now });
  db.saveAgentConfig(id, company as never);
  saveWorkspaceProvider(id, { outbound: outbound as never }, "setup");
};

const callFrom = async (tenantId: string) => {
  const provider = resolveOutbound(tenantId);
  const config = db.getAgentConfig(tenantId);
  return sarvamVoiceService.startOutboundCall({
    provider,
    tenantId,
    leadId: "lead_1",
    leadName: "Ananya Rao",
    leadPhone: "+919845012210",
    leadCompany: "Brightline Homes",
    leadNotes: "Asked about an appointment",
    companyName: config.companyName ?? "",
    productName: config.productName,
    agentConfig: config,
    webhookBaseUrl: "https://example.test",
    callId: "call_1",
  });
};

const sentVariables = (): Record<string, unknown> | undefined => {
  const app = ((lastSent as Sent | null)?.body.app_config ?? {}) as Record<string, unknown>;
  return app.agent_variables as Record<string, unknown> | undefined;
};
const sentApp = () => (((lastSent as Sent | null)?.body.app_config ?? {}) as Record<string, unknown>);
const sentUser = () => (((lastSent as Sent | null)?.body.user_config ?? {}) as Record<string, unknown>);

// ============================================================
// 1. The regression: an agent that declares none of the three
// ============================================================
section("An agent that declares no custom variables at all");

const AMRITA = "Amrita---We-4517816a-a47a";
workspace(
  "ws_wellness",
  "Wellness Hospital",
  { companyName: "Wellness Hospital", productName: "Appointments", industry: "Healthcare" },
  { appId: AMRITA, appVersion: 2, connectionId: "conn-wellness", phoneNumber: "+918064269111", agentName: "Amrita", agentVariables: [] }
);

const placed = await callFrom("ws_wellness");
check("The call was placed", placed.attemptId === "attempt_1", placed);
check("No customer_name was sent", !("customer_name" in (sentVariables() ?? {})), sentVariables());
check("No phone_number was sent as a variable", !("phone_number" in (sentVariables() ?? {})), sentVariables());
check("No company_name was sent", !("company_name" in (sentVariables() ?? {})), sentVariables());
check("agent_variables is omitted entirely rather than sent empty", sentVariables() === undefined, sentApp());

// The provider's own contract is untouched.
check("The agent and version still travel", sentApp().app_id === AMRITA && sentApp().app_version === 2, sentApp());
check("The destination number travels in user_config", sentUser().user_phone_number === "+919845012210", sentUser());
const connection = (sentApp().connection_config ?? {}) as Record<string, unknown>;
check("The connection travels in connection_config", connection.connection_id === "conn-wellness", connection);
check("The number dialled from is the connection's, not the destination", connection.agent_phone_number === "+918064269111", connection);
check("The two numbers are kept apart", connection.agent_phone_number !== sentUser().user_phone_number);
check("The webhook still travels", Boolean((lastSent as Sent | null)?.body.webhook_config), (lastSent as Sent | null)?.body);

// ============================================================
// 2. Agents from other industries, each with its own names
// ============================================================
section("A hospital agent that declares its own names");

workspace(
  "ws_clinic",
  "City Clinic",
  { companyName: "City Clinic", productName: "Consultations", industry: "Healthcare" },
  {
    appId: "Clinic-Agent-1", appVersion: 1, connectionId: "conn-clinic", phoneNumber: "+918064269222", agentName: "Asha",
    agentVariables: ["patient_name", "appointment_date"],
    variableMappings: [
      { name: "patient_name", source: "lead.name" },
      { name: "appointment_date", source: "literal", value: "2026-11-02" },
    ],
  }
);
await callFrom("ws_clinic");
check("It receives patient_name", sentVariables()?.patient_name === "Ananya Rao", sentVariables());
check("…and appointment_date from its default", sentVariables()?.appointment_date === "2026-11-02", sentVariables());
check("…and nothing else", Object.keys(sentVariables() ?? {}).length === 2, sentVariables());
check("No sales variable appears", !("product_name" in (sentVariables() ?? {})), sentVariables());

section("A recruiter's agent");

workspace(
  "ws_recruit",
  "Hirewell",
  { companyName: "Hirewell", productName: "Placements", industry: "Recruitment" },
  {
    appId: "Recruiter-Agent-1", appVersion: 3, connectionId: "conn-recruit", phoneNumber: "+918064269333", agentName: "Ravi",
    agentVariables: ["candidate_name", "interview_time", "role_title"],
    variableMappings: [
      { name: "candidate_name", source: "lead.name" },
      { name: "interview_time", source: "literal", value: "Thursday 5 PM" },
      { name: "role_title", source: "lead.company" },
    ],
  }
);
await callFrom("ws_recruit");
check("It receives candidate_name", sentVariables()?.candidate_name === "Ananya Rao", sentVariables());
check("…interview_time", sentVariables()?.interview_time === "Thursday 5 PM", sentVariables());
check("…and role_title from the lead's company", sentVariables()?.role_title === "Brightline Homes", sentVariables());
check("No patient_name leaks from the clinic", !("patient_name" in (sentVariables() ?? {})), sentVariables());

section("An agent that uses customer_name because its own prompt does");

workspace(
  "ws_support",
  "Northwind Support",
  { companyName: "Northwind", productName: "Helpdesk", industry: "Customer support" },
  {
    appId: "Support-Agent-1", appVersion: 1, connectionId: "conn-support", phoneNumber: "+918064269444", agentName: "Sam",
    agentVariables: ["customer_name", "ticket_reference"],
    variableMappings: [
      { name: "customer_name", source: "lead.name" },
      { name: "ticket_reference", source: "lead.notes" },
    ],
  }
);
await callFrom("ws_support");
check("customer_name is sent when this agent declares it", sentVariables()?.customer_name === "Ananya Rao", sentVariables());
check("…and so is its own ticket_reference", sentVariables()?.ticket_reference === "Asked about an appointment", sentVariables());

// ============================================================
// 3. Case, optional values and required values
// ============================================================
section("Names are taken exactly as declared");

const cased = resolveMappings(
  [
    { name: "customerName", source: "lead.name" },
    { name: "Patient_Name", source: "lead.name" },
  ],
  { lead: { name: "Ananya Rao" } }
);
check("customerName is not turned into customer_name", "customerName" in cased.variables && !("customer_name" in cased.variables), cased.variables);
check("Capitalisation is preserved exactly", "Patient_Name" in cased.variables && !("patient_name" in cased.variables), cased.variables);

const optional = resolveMappings(
  [
    { name: "patient_name", source: "lead.name" },
    { name: "referred_by", source: "lead.company" },
  ],
  { lead: { name: "Ananya Rao" } } // no company
);
check("An optional mapping with no value is omitted, not sent empty", !("referred_by" in optional.variables), optional.variables);
check("…and is reported as omitted", optional.omitted.includes("referred_by"), optional);
check("…while the rest still go", optional.variables.patient_name === "Ananya Rao");

const required = resolveMappings(
  [{ name: "appointment_date", source: "csv.appointment_date", required: true }],
  { row: {} }
);
check("A required mapping with no value is reported", required.missingRequired.includes("appointment_date"), required);
check("…and nothing is invented for it", !("appointment_date" in required.variables), required.variables);

const defaulted = resolveMappings(
  [{ name: "appointment_date", source: "csv.appointment_date", value: "to be confirmed", required: true }],
  { row: {} }
);
check("A default satisfies a required mapping", defaulted.variables.appointment_date === "to be confirmed" && defaulted.missingRequired.length === 0, defaulted);

section("A required mapping stops the call before the provider does");

workspace(
  "ws_strict",
  "Strict Clinic",
  { companyName: "Strict Clinic", productName: "Consultations", industry: "Healthcare" },
  {
    appId: "Strict-Agent-1", appVersion: 1, connectionId: "conn-strict", phoneNumber: "+918064269555", agentName: "Dev",
    agentVariables: ["appointment_date"],
    variableMappings: [{ name: "appointment_date", source: "csv.appointment_date", required: true }],
  }
);
const before = lastSent;
let refused: unknown = null;
try {
  await callFrom("ws_strict");
} catch (error) {
  refused = error;
}
check("The call is refused", refused !== null);
check("…naming the mapping that needs attention", /appointment_date/.test(refused instanceof Error ? refused.message : ""), refused);
check("…and nothing was sent to the provider", lastSent === before);

// ============================================================
// 4. Malformed stored configuration
// ============================================================
section("Stored mappings are data, not a promise");

const parsed = parseMappings([
  { name: "patient_name", source: "lead.name" },
  { name: "", source: "lead.name" },
  { name: "bad_source", source: "something.invented" },
  { name: "from_sheet", source: "csv.appointment_date" },
  "not an object",
]);
check("A mapping with no name is discarded", !parsed.some((mapping) => mapping.name === ""), parsed);
check("A source Tringlo does not know is discarded", !parsed.some((mapping) => mapping.name === "bad_source"), parsed);
check("A sheet column source is kept", parsed.some((mapping) => mapping.source === "csv.appointment_date"), parsed);
check("Only the good ones survive", parsed.length === 2, parsed);

// ============================================================
// 5. The workspaces that were here first
// ============================================================
section("TenWeb and BrightPath keep what they had");

workspace(
  "ws_tenweb",
  "TenWeb",
  { companyName: "TenWeb", productName: "KhushiBot", industry: "Web services" },
  { appId: "Agent-TenWeb", appVersion: 4, connectionId: "conn-tenweb", phoneNumber: "+918064269194", agentName: "Khushi", agentVariables: [...SALES_AGENT_VARIABLES] }
);
await callFrom("ws_tenweb");
const tenweb = sentVariables() ?? {};
check("TenWeb still receives its sales variables", "customer_name" in tenweb && ("productCategory" in tenweb || "industryVertical" in tenweb), Object.keys(tenweb));
check("…built from the workspace's own company", tenweb.company_name === "TenWeb", tenweb);
check("…and nothing from the hospital", !("patient_name" in tenweb), Object.keys(tenweb));

workspace(
  "ws_bright",
  "BrightPath Logistics",
  { companyName: "BrightPath Logistics", productName: "RouteSense", industry: "Logistics" },
  { appId: "Agent-Bright", appVersion: 2, connectionId: "conn-bright", phoneNumber: "+918064269666", agentName: "Maya", agentVariables: ["customer_name", "company_name", "product_name"] }
);
await callFrom("ws_bright");
const bright = sentVariables() ?? {};
check("BrightPath receives exactly its three", Object.keys(bright).sort().join(",") === "company_name,customer_name,product_name", Object.keys(bright));
check("…with its own product", bright.product_name === "RouteSense", bright);

section("No workspace borrows another's configuration");

check("Each workspace keeps its own agent", providerConfigFor("ws_wellness")?.outbound?.appId === AMRITA && providerConfigFor("ws_clinic")?.outbound?.appId === "Clinic-Agent-1");
check(
  "…and its own variables",
  providerConfigFor("ws_wellness")?.outbound?.agentVariables.length === 0 &&
    providerConfigFor("ws_recruit")?.outbound?.agentVariables.includes("candidate_name") === true &&
    providerConfigFor("ws_tenweb")?.outbound?.agentVariables.includes("candidate_name") === false
);

// ============================================================
// 6. Campaigns
// ============================================================
section("Campaigns map a sheet to the campaign agent's own variables");

const clinicBatch = resolveBatch("ws_clinic");
check("A campaign on the same agent inherits its mapping", clinicBatch?.inherited === true && (clinicBatch?.batch.variableMappings ?? []).some((mapping) => mapping.name === "patient_name"), clinicBatch?.batch.variableMappings);

saveWorkspaceProvider(
  "ws_clinic",
  {
    batch: {
      appId: "Clinic-Campaign-Agent", appVersion: 1, appType: "agent", connectionId: "conn-clinic",
      phoneNumbers: ["+918064269222"], attemptsPerSecond: 1, cohortMode: "stream",
      agentVariables: ["patient_name", "appointment_date"],
      variableMappings: [
        { name: "patient_name", source: "csv.full_name" },
        { name: "appointment_date", source: "csv.visit_date", required: true },
      ],
      retry: { maxRetries: 2, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
      schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "19:00", days: ["Monday"] },
    },
  },
  "setup"
);
const ownBatch = resolveBatch("ws_clinic");
check("A campaign on a different agent does not inherit", ownBatch?.inherited === false && ownBatch?.batch.appId === "Clinic-Campaign-Agent", ownBatch?.batch.appId);
check("…and uses its own mapping", (ownBatch?.batch.variableMappings ?? []).some((mapping) => mapping.source === "csv.full_name"), ownBatch?.batch.variableMappings);

const csv = "phone_number,full_name,visit_date,productCategory\n+919845012210,Ananya Rao,2026-11-02,Dental\n";
const report = validateCampaignCsv(csv, ownBatch?.batch.agentVariables, ownBatch?.batch.variableMappings);
const roles = Object.fromEntries(report.columns.map((column) => [column.name, column.role]));
check("A mapped column is marked as sent", roles.full_name === "sent" && roles.visit_date === "sent", roles);
check("A column the agent knows nothing about is not sent", roles.productCategory === "undeclared_not_sent", roles);
check("The phone column is still the number to call", roles.phone_number === "phone", roles);

const notes = Object.fromEntries(report.columns.map((column) => [column.name, column.note]));
check("…and the mapped column says which variable it fills", /patient_name/.test(String(notes.full_name)), notes.full_name);

// ============================================================
// 7. Inbound stays its own thing
// ============================================================
section("Inbound configuration is separate from outbound variables");

const wellnessConfig = providerConfigFor("ws_wellness");
check("An outbound-only workspace needs no inbound deployment", wellnessConfig?.inbound === null || wellnessConfig?.inbound === undefined, wellnessConfig?.inbound);
check("…and still places calls", placed.attemptId === "attempt_1");

// ============================================================
// 8. When the provider refuses anyway
// ============================================================
section("A provider rejection is reported, never swallowed");

nextResponse = {
  status: 422,
  body: { error: { message: `Invalid Parameter: Agent variables '{'patient_name'}' not found in agent variables of app 'Clinic-Agent-1'`, type: "invalid_parameter" } },
};
let rejected: unknown = null;
try {
  await callFrom("ws_clinic");
} catch (error) {
  rejected = error;
}
const message = rejected instanceof Error ? rejected.message : "";
check("The call is reported as refused", rejected !== null);
check("…naming the variable the agent does not declare", /patient_name/.test(message), message);
check("…and the agent", /Clinic-Agent-1/.test(message), message);
check("No credential appears in the message", !message.includes("test-key-not-a-real-credential"));


// ============================================================
section("The Priya / TenWeb symptom: business context not reaching the agent");

const { businessContextReach } = await import("@/lib/providers/sarvam/variables");

workspace(
  "ws_tenweb",
  "TenWeb",
  { companyName: "TenWeb", productName: "KhushiBot", industry: "EdTech", agentName: "Priya" },
  { appId: "Conversatio-834500dd-d3c1", appVersion: 3, connectionId: "conn-tw", phoneNumber: "+918064269194", agentName: "Priya", agentVariables: [], variableMappings: [] }
);

lastSent = null;
nextResponse = { status: 200, body: { attempt_id: "attempt_tw" } };
const tw = await callFrom("ws_tenweb");
const twVars = sentApp().agent_variables;
check("The TenWeb call is placed", Boolean(tw.attemptId), tw);
check("…but NO business variables are sent — the agent runs on its own prompt", twVars === undefined, twVars);
check("businessContextReach reports the gap", businessContextReach([], []).reaches === false);

saveWorkspaceProvider(
  "ws_tenweb",
  { outbound: { appId: "Conversatio-834500dd-d3c1", appVersion: 3, connectionId: "conn-tw", phoneNumber: "+918064269194", agentName: "Priya", agentVariables: ["company_name", "product_name", "customer_name"], variableMappings: [] } as never },
  "setup"
);
lastSent = null;
await callFrom("ws_tenweb");
const fixed = sentApp().agent_variables as Record<string, string> | undefined;
check("Once the agent declares them, TenWeb's business reaches it", fixed?.company_name === "TenWeb", fixed);
check("…with its real product", fixed?.product_name === "KhushiBot", fixed);
check("…and still nothing undeclared", Boolean(fixed) && !("industryVertical" in (fixed as object)), fixed);
check("businessContextReach now reports it reaches", businessContextReach(["company_name"], []).reaches === true);

workspace(
  "ws_other2",
  "Brightline",
  { companyName: "Brightline Homes", productName: "Villas", agentName: "Asha" },
  { appId: "Other-Agent-99", appVersion: 1, connectionId: "conn-o", phoneNumber: "+918000000000", agentName: "Asha", agentVariables: ["company_name"], variableMappings: [] }
);
lastSent = null;
await callFrom("ws_other2");
const otherApp = sentApp().app_id;
const otherVars = sentApp().agent_variables as Record<string, string>;
check("Another workspace calls on its OWN agent, never TenWeb's", otherApp === "Other-Agent-99", otherApp);
check("…with its OWN business, not TenWeb's", otherVars?.company_name === "Brightline Homes", otherVars);
check("…and TenWeb's product never leaks across", !JSON.stringify(otherVars).includes("KhushiBot"), otherVars);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
