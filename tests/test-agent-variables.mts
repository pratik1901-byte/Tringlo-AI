// ============================================================
// Per-agent variables — what each workspace's agent may be sent
// ============================================================
//
// Sarvam refuses a whole call over one variable the agent does not declare:
//
//   422 Invalid Parameter — Agent variables '{'productCategory', …}' not found
//   in agent variables of app 'Amrita---We-4517816a-a47a'
//
// So what Tringlo sends has to come from the agent that is dialling, not from
// whichever agent happened to be built first. This suite covers single calls,
// campaigns and the workspaces that were configured before per-agent lists
// existed.
//
// Sarvam is never called here: the payload is built and read. The database is
// a throwaway one — see tests/isolated-db.
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("agent-variables");

const {
  SALES_AGENT_VARIABLES,
  buildSarvamAgentVariables,
  declaredVariableNames,
  hasDeclaredVariables,
  undeclaredVariablesFrom,
  validateOutgoingVariables,
} = await import("@/lib/providers/sarvam/variables");
const { saveWorkspaceProvider, providerConfigFor, resolveBatch } = await import("@/lib/providers/config");
const { validateCampaignCsv } = await import("@/lib/campaigns/csv");
const { runStartupMigrations, resetMigrationGuardForTests } = await import("@/lib/db/migrations");
const db = await import("@/lib/db");

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

// What Amrita, the Wellness Hospital agent, actually declares.
const AMRITA_VARIABLES = ["customer_name", "phone_number", "appointment_department"];
const AMRITA = "Amrita---We-4517816a-a47a";

// The sales agent the first workspaces were built around.
const TENWEB = "ws_tenweb";
const WELLNESS = "ws_wellness";
const BRIGHT = "ws_bright";

for (const [id, name] of [[TENWEB, "TenWeb"], [WELLNESS, "Wellness Hospital"], [BRIGHT, "BrightPath Logistics"]]) {
  db.saveTenant({ id, name, createdAt: now });
}
db.saveAgentConfig(TENWEB, { companyName: "TenWeb", productName: "KhushiBot", industry: "Web services" });
db.saveAgentConfig(WELLNESS, { companyName: "Wellness Hospital", productName: "Appointments", industry: "Healthcare" });
db.saveAgentConfig(BRIGHT, { companyName: "BrightPath Logistics", productName: "RouteSense", industry: "Logistics" });

const lead = {
  id: "lead_1", name: "Ananya Rao", phone: "+919845012210",
  company: "Brightline Homes", notes: "Asked about a check-up",
};

const build = (declared: string[] | null, tenantCompany: string) =>
  buildSarvamAgentVariables({
    lead,
    agentConfig: db.getAgentConfig(WELLNESS),
    declaredVariables: declared,
    normalizedPhone: "+919845012210",
    companyName: tenantCompany,
    productName: "Appointments",
  }).variables;

// ---------------- the bug, directly ----------------
section("The variables that caused the 422");

const REJECTED = [
  "productCategory", "lead_notes", "industryVertical", "companyName", "userName",
  "phone_number", "seller_company_name", "company_name", "customer_name",
  "product_name", "proposedNextStepDefault",
];

const unlisted = build(null, "Wellness Hospital");
check(
  "A workspace that has not listed its variables sends none of the sales agent's",
  REJECTED.every((name) => !(name in unlisted)),
  Object.keys(unlisted)
);
check("…and sends nothing at all", Object.keys(unlisted).length === 0, Object.keys(unlisted));

const amrita = build(AMRITA_VARIABLES, "Wellness Hospital");
check("With Amrita's own list, every name sent is one she declares", Object.keys(amrita).every((name) => AMRITA_VARIABLES.includes(name)), Object.keys(amrita));
check("…none of the eleven Sarvam rejected is sent", REJECTED.filter((name) => name in amrita && !AMRITA_VARIABLES.includes(name)).length === 0, Object.keys(amrita));
check("…the customer's name is still sent", amrita.customer_name === "Ananya Rao", amrita);
check("…and the number", amrita.phone_number === "+919845012210", amrita);

// ---------------- names are names ----------------
section("Variable names are taken exactly as written");

const cased = build(["customerName"], "Wellness Hospital");
check("customerName is filled when it is the declared name", cased.customerName === "Ananya Rao", cased);
check("…and customer_name is not sent alongside it", !("customer_name" in cased), Object.keys(cased));

const snake = build(["customer_name"], "Wellness Hospital");
check("customer_name is not turned into customerName", "customer_name" in snake && !("customerName" in snake), Object.keys(snake));

const userName = build(["userName"], "Wellness Hospital");
check("userName is the customer, and is not confused with user_name", userName.userName === "Ananya Rao" && !("user_name" in userName), Object.keys(userName));

// ---------------- optional, unknown and required ----------------
section("Optional, unknown and required values");

const optional = buildSarvamAgentVariables({
  lead: { id: "lead_2", name: "Kiran Shah", phone: "+919811122233" },
  agentConfig: db.getAgentConfig(WELLNESS),
  // campaign_name is declared but this is not a campaign call, so it has no
  // value. lead_notes is deliberately not used here: it doubles as the carrier
  // for business context when an agent declares no richer names, so it is
  // filled even for a lead with no notes.
  declaredVariables: [...AMRITA_VARIABLES, "campaign_name"],
  normalizedPhone: "+919811122233",
  companyName: "Wellness Hospital",
}).variables;
check("An optional value with nothing to say is left out", !("campaign_name" in optional), optional);
check("…and the rest still go", optional.customer_name === "Kiran Shah", optional);

const unknown = buildSarvamAgentVariables({
  lead,
  agentConfig: db.getAgentConfig(WELLNESS),
  declaredVariables: AMRITA_VARIABLES,
  normalizedPhone: "+919845012210",
  companyName: "Wellness Hospital",
  customVariables: { not_a_real_variable: "x", appointment_department: "Cardiology" },
}).variables;
check("A variable the agent does not declare is dropped", !("not_a_real_variable" in unknown), Object.keys(unknown));
check("…and one it does declare is kept", unknown.appointment_department === "Cardiology", unknown);

const placeholder = validateOutgoingVariables({ patient_name: "<customer_name>" });
check("A value that is still a placeholder is refused before the call", !placeholder.valid, placeholder);
check("…and real values are not", validateOutgoingVariables({ patient_name: "Ananya Rao" }).valid);
check("A call is no longer refused for want of customer_name", validateOutgoingVariables({}).valid);

check("An unlisted workspace is known to be unlisted", hasDeclaredVariables([]) === false && hasDeclaredVariables(AMRITA_VARIABLES) === true);
check("Blank entries in a list do not count as a declaration", hasDeclaredVariables(["  ", ""]) === false);

// ---------------- reading Sarvam's rejection ----------------
section("Sarvam's 422, read back");

const message =
  "Invalid Parameter: Agent variables '{'productCategory', 'lead_notes', 'industryVertical'}' not found in agent variables of app 'Amrita---We-4517816a-a47a'";
const named = undeclaredVariablesFrom(message);
check("The rejected names are read out of the message", named.join(",") === "productCategory,lead_notes,industryVertical", named);
check("Nothing is invented from a message without them", undeclaredVariablesFrom("Something else went wrong").length === 0);
check("…or from a non-string", undeclaredVariablesFrom(undefined).length === 0);

// ---------------- per workspace, and nowhere else ----------------
section("Each workspace's own agent");

saveWorkspaceProvider(
  TENWEB,
  {
    outbound: { appId: "Agent-TenWeb", appVersion: 4, connectionId: "conn-tenweb", phoneNumber: "+918064269194", agentName: "Khushi", agentVariables: [...SALES_AGENT_VARIABLES] },
  },
  "setup"
);
saveWorkspaceProvider(
  WELLNESS,
  {
    outbound: { appId: AMRITA, appVersion: 2, connectionId: "conn-wellness", phoneNumber: "+918064269111", agentName: "Amrita", agentVariables: AMRITA_VARIABLES },
  },
  "setup"
);
saveWorkspaceProvider(
  BRIGHT,
  {
    outbound: { appId: "Agent-Bright", appVersion: 2, connectionId: "conn-bright", phoneNumber: "+918000000002", agentName: "Maya", agentVariables: ["customer_name", "company_name", "phone_number", "product_name"] },
  },
  "setup"
);

check("Wellness Hospital holds Amrita's list", providerConfigFor(WELLNESS)?.outbound?.agentVariables.join(",") === AMRITA_VARIABLES.join(","));
check("TenWeb keeps the sales list", providerConfigFor(TENWEB)?.outbound?.agentVariables.length === SALES_AGENT_VARIABLES.length);
check("BrightPath keeps its own four", providerConfigFor(BRIGHT)?.outbound?.agentVariables.length === 4);
check(
  "One workspace's list cannot reach another",
  providerConfigFor(WELLNESS)?.outbound?.agentVariables.includes("productCategory") === false &&
    providerConfigFor(TENWEB)?.outbound?.agentVariables.includes("appointment_department") === false
);

const tenwebVariables = buildSarvamAgentVariables({
  lead,
  agentConfig: db.getAgentConfig(TENWEB),
  declaredVariables: providerConfigFor(TENWEB)?.outbound?.agentVariables,
  normalizedPhone: "+919845012210",
  companyName: "TenWeb",
  productName: "KhushiBot",
}).variables;
check("TenWeb still sends the sales variables it always did", "productCategory" in tenwebVariables || "industryVertical" in tenwebVariables, Object.keys(tenwebVariables));
check("…including the names its agent declares", tenwebVariables.customer_name === "Ananya Rao" && tenwebVariables.company_name === "TenWeb");

const brightVariables = buildSarvamAgentVariables({
  lead,
  agentConfig: db.getAgentConfig(BRIGHT),
  declaredVariables: providerConfigFor(BRIGHT)?.outbound?.agentVariables,
  normalizedPhone: "+919845012210",
  companyName: "BrightPath Logistics",
  productName: "RouteSense",
}).variables;
check("BrightPath sends exactly its four and no more", Object.keys(brightVariables).every((name) => ["customer_name", "company_name", "phone_number", "product_name"].includes(name)), Object.keys(brightVariables));

// ---------------- campaigns ----------------
section("Campaigns dial with the campaign agent's variables");

const inherited = resolveBatch(WELLNESS);
check("A campaign without its own settings inherits the agent's list", inherited?.batch.agentVariables.join(",") === AMRITA_VARIABLES.join(","), inherited?.batch.agentVariables);

saveWorkspaceProvider(
  WELLNESS,
  {
    batch: {
      appId: "Amrita-Campaigns-1234", appVersion: 1, appType: "agent", connectionId: "conn-wellness",
      phoneNumbers: ["+918064269111"], attemptsPerSecond: 1, cohortMode: "stream",
      agentVariables: ["customer_name", "phone_number", "camp_reminder_date"],
      retry: { maxRetries: 2, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
      schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "19:00", days: ["Monday"] },
    },
  },
  "setup"
);
const batchConfig = resolveBatch(WELLNESS);
check("A campaign agent may declare its own", batchConfig?.batch.agentVariables.includes("camp_reminder_date") === true, batchConfig?.batch.agentVariables);
check("…without changing the single-call agent's", providerConfigFor(WELLNESS)?.outbound?.agentVariables.includes("camp_reminder_date") === false);

const csv = "phone_number,customer_name,camp_reminder_date,productCategory\n+919845012210,Ananya Rao,2026-11-02,Dental\n";
const withAgent = validateCampaignCsv(csv, batchConfig?.batch.agentVariables);
const columnState = Object.fromEntries(withAgent.columns.map((column) => [column.name, column.role]));
check("A sheet column the campaign agent declares is carried", JSON.stringify(columnState).includes("camp_reminder_date"), columnState);
const carried = withAgent.valid[0]?.variables ?? {};
check("…and its value travels", carried.camp_reminder_date === "2026-11-02", carried);
check("A column the agent does not declare is not sent", !("productCategory" in carried), carried);

const withoutAgent = validateCampaignCsv(csv);
const unlistedCarried = withoutAgent.valid[0]?.variables ?? {};
check("Without an agent's list, no column is carried as a variable", Object.keys(unlistedCarried).length === 0, unlistedCarried);

// ---------------- workspaces configured before per-agent lists ----------------
section("Workspaces that predate per-agent lists");

const LEGACY = "ws_legacy";
db.saveTenant({ id: LEGACY, name: "Built earlier", createdAt: now });
// Written the way a record looked before per-agent variables existed: a list
// of no names, and no statement of which of the four states that is. Saving
// through the editor today would record "none", which the migration leaves be.
db.saveProviderConfig({
  tenantId: LEGACY,
  outbound: { appId: "Agent-Legacy", appVersion: 1, connectionId: "conn-legacy", phoneNumber: "+918000000055", agentName: null, agentVariables: [] },
  batch: null,
  inbound: null,
  webhookToken: "token-legacy",
  seededFromEnv: true,
  createdAt: now,
  updatedAt: now,
  updatedBy: null,
} as never);
check("It starts with no list of its own", providerConfigFor(LEGACY)?.outbound?.agentVariables.length === 0);
check("…and says nothing about which state it is in", providerConfigFor(LEGACY)?.outbound?.variableSchemaSource === undefined);

resetMigrationGuardForTests();
runStartupMigrations();

const migrated = providerConfigFor(LEGACY)?.outbound?.agentVariables ?? [];
check("The migration writes down what it was already sending", migrated.join(",") === [...SALES_AGENT_VARIABLES].join(","), migrated.length);
check("…so nothing it sends changes", declaredVariableNames(migrated).has("productCategory"));
check("A workspace that had its own list is left alone", providerConfigFor(WELLNESS)?.outbound?.agentVariables.join(",") === AMRITA_VARIABLES.join(","));
check("…and is recorded as having declared it", providerConfigFor(WELLNESS)?.outbound?.variableSchemaSource === "declared");

// The failure this whole change exists to prevent: a workspace saved today
// with no custom variables must never be given a sales schema by migration.
const TODAY = "ws_today";
db.saveTenant({ id: TODAY, name: "Opened today", createdAt: now });
saveWorkspaceProvider(
  TODAY,
  { outbound: { appId: "Agent-Today", appVersion: 1, connectionId: "conn-today", phoneNumber: "+918000000066", agentName: null, agentVariables: [] } },
  "setup"
);
check("A workspace saved today records that it takes none", providerConfigFor(TODAY)?.outbound?.variableSchemaSource === "none");
resetMigrationGuardForTests();
runStartupMigrations();
check("…and the legacy migration leaves it alone", providerConfigFor(TODAY)?.outbound?.agentVariables.length === 0, providerConfigFor(TODAY)?.outbound?.agentVariables);

resetMigrationGuardForTests();
runStartupMigrations();
check("Running it twice changes nothing further", providerConfigFor(LEGACY)?.outbound?.agentVariables.length === SALES_AGENT_VARIABLES.length);

// ---------------- the agent id is the workspace's own ----------------
section("The agent dialling is the workspace's own");

check("Wellness Hospital dials on Amrita", providerConfigFor(WELLNESS)?.outbound?.appId === AMRITA);
check("TenWeb dials on its own agent", providerConfigFor(TENWEB)?.outbound?.appId === "Agent-TenWeb");
check(
  "An agent and a list from different workspaces are never paired",
  providerConfigFor(TENWEB)?.outbound?.appId !== providerConfigFor(WELLNESS)?.outbound?.appId &&
    providerConfigFor(TENWEB)?.outbound?.agentVariables.join(",") !== providerConfigFor(WELLNESS)?.outbound?.agentVariables.join(",")
);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
