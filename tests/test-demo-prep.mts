// ============================================================
// Demo preparation — hospital enablement, caller name, isolation
// ============================================================
//
// The changes that get the demo ready, each pinned down:
//
//   - Selecting Wellness Hospital must open the hospital panel, which means it
//     must be enabled — by an explicit, id-based migration, never by the mere
//     act of reading a profile.
//   - TenWeb must NOT become a hospital.
//   - A hospital's agent must never be swept into the sales variable schema.
//   - TenWeb's caller-name variable is restored, for that workspace only.
//   - Saving one workspace never changes another.
//
// Isolated throwaway database; no provider is contacted and no call is placed.
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("demo-prep");

const TENWEB = "tenant_tenweb";
const WELLNESS = "tenant_wellness";
const OTHER = "tenant_other";

// The env the demo migration reads — set before the migration module loads.
process.env.TRINGLO_HOSPITAL_WORKSPACES = WELLNESS;
process.env.TRINGLO_CALLER_NAME_WORKSPACES = TENWEB;
process.env.TRINGLO_HOSPITAL_AGENT_NAME = "Maya";

const db = await import("@/lib/db");
const { saveWorkspaceProvider, providerConfigFor, publicProviderConfig } = await import("@/lib/providers/config");
const { runStartupMigrations, resetMigrationGuardForTests } = await import("@/lib/db/migrations");
const { isHospitalWorkspace } = await import("@/lib/hospital/context");
const { hospitalProfile } = await import("@/lib/hospital/service");
const { SALES_AGENT_VARIABLES } = await import("@/lib/providers/sarvam/variables");

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
for (const [id, name] of [[TENWEB, "TenWeb"], [WELLNESS, "Wellness Hospital"], [OTHER, "Another Co"]]) {
  db.saveTenant({ id, name, createdAt: now });
  db.saveAgentConfig(id, { companyName: name, productName: "Thing", industry: "X" });
}

// TenWeb: a sales agent that has ended up declaring nothing (schemaSource "none").
saveWorkspaceProvider(
  TENWEB,
  { outbound: { appId: "Conversatio-834500dd-d3c1", appVersion: 3, connectionId: "conn-tw", phoneNumber: "+918064269194", agentName: "Priya", agentVariables: [], variableMappings: [] } },
  "setup"
);
// Force the "none" state the live workspace is in (declares no variables).
db.saveProviderConfig({ ...providerConfigFor(TENWEB)!, outbound: { ...providerConfigFor(TENWEB)!.outbound!, variableSchemaSource: "none" } });

// Wellness: a hospital agent (Amrita), schema source UNSET — the migration
// would otherwise stamp it with the sales schema.
saveWorkspaceProvider(
  WELLNESS,
  { outbound: { appId: "Amrita---We-4517816a-a47a", appVersion: 2, connectionId: "conn-wh", phoneNumber: "+918064269111", agentName: "Amrita", agentVariables: [], variableMappings: [] } },
  "setup"
);
// A hospital profile exists but is NOT enabled yet (the live state).
hospitalProfile(WELLNESS, "Wellness Hospital");
db.saveHospitalProfile({ ...db.getHospitalProfile(WELLNESS)!, enabled: false });
// The genuinely-legacy state the live workspace is in: no schema source at
// all, which is what would otherwise sweep it into the sales schema. And a
// batch config saved by an older path that omits agentVariables entirely —
// the exact shape that crashed the provider-config endpoint.
db.saveProviderConfig({
  ...providerConfigFor(WELLNESS)!,
  outbound: { ...providerConfigFor(WELLNESS)!.outbound!, variableSchemaSource: undefined },
  batch: {
    appId: "Amrita---We-4517816a-a47a", appVersion: 2, appType: "agent", connectionId: "conn-wh",
    phoneNumbers: ["+918064269111"], attemptsPerSecond: 1, cohortMode: "stream",
    retry: { maxRetries: 2, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
    schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "18:00", days: ["Monday"] },
  } as never,
});

// OTHER: a legacy sales workspace with no schema source — SHOULD get the
// legacy sales default, proving the migration still does its normal job.
saveWorkspaceProvider(
  OTHER,
  { outbound: { appId: "Other-1", appVersion: 1, connectionId: "conn-o", phoneNumber: "+918000000000", agentName: "Asha", agentVariables: [], variableMappings: [] } },
  "setup"
);
// A real legacy workspace predates the schema-source field.
db.saveProviderConfig({ ...providerConfigFor(OTHER)!, outbound: { ...providerConfigFor(OTHER)!.outbound!, variableSchemaSource: undefined } });

// ------------------------------------------------------------
section("Reading a profile never enables a hospital (the old bug)");

check("Wellness is not a hospital before the migration", isHospitalWorkspace(WELLNESS) === false);
// Read the profile a few times — the thing that used to create/activate one.
hospitalProfile(WELLNESS);
hospitalProfile(TENWEB);
db.getHospitalProfile(WELLNESS);
check("…and reading it changes nothing", isHospitalWorkspace(WELLNESS) === false);
check("TenWeb has no enabled hospital profile either", isHospitalWorkspace(TENWEB) === false);

// ------------------------------------------------------------
section("The demo migration");

resetMigrationGuardForTests();
runStartupMigrations();

check("Wellness Hospital is enabled (listed in the env)", isHospitalWorkspace(WELLNESS) === true);
check("TenWeb is NOT enabled (not listed)", isHospitalWorkspace(TENWEB) === false);
check("…and neither is the other workspace", isHospitalWorkspace(OTHER) === false);

// The hospital-skip: Wellness must NOT have been stamped with the sales schema.
const wellness = providerConfigFor(WELLNESS)!.outbound!;
check("The hospital agent was not given the sales schema", wellness.agentVariables.length === 0, wellness.agentVariables);
check("…and the hospital agent id is untouched", wellness.appId === "Amrita---We-4517816a-a47a");

// The normal legacy behaviour still happens for a non-hospital workspace.
const other = providerConfigFor(OTHER)!.outbound!;
check("A legacy sales workspace still gets the sales default", other.agentVariables.length === SALES_AGENT_VARIABLES.length, other.agentVariables.length);

// Caller name restored for TenWeb only.
const tenweb = providerConfigFor(TENWEB)!.outbound!;
check("TenWeb now declares customer_name", tenweb.agentVariables.includes("customer_name"), tenweb.agentVariables);
check("…its schema source is recorded", tenweb.variableSchemaSource === "declared", tenweb.variableSchemaSource);
check("…and its agent id/version are unchanged", tenweb.appId === "Conversatio-834500dd-d3c1" && tenweb.appVersion === 3);
check("The hospital agent was NOT given customer_name", !wellness.agentVariables.includes("customer_name"));

// Idempotent: running again changes nothing.
resetMigrationGuardForTests();
runStartupMigrations();
check("Running the migration twice is idempotent", providerConfigFor(TENWEB)!.outbound!.agentVariables.filter((v) => v === "customer_name").length === 1);
check("…and does not re-enable or duplicate anything", isHospitalWorkspace(WELLNESS) === true && isHospitalWorkspace(TENWEB) === false);

// ------------------------------------------------------------
section("The agent config endpoint survives a malformed batch");

// Before the fix this threw on batch.agentVariables.length and 500'd the whole
// endpoint, which is what showed "That did not work." with every section
// "Not set".
let threw = false;
let view: ReturnType<typeof publicProviderConfig> | null = null;
try {
  view = publicProviderConfig(WELLNESS);
} catch {
  threw = true;
}
check("publicProviderConfig does not crash on a batch missing agentVariables", !threw);
check("…outbound still loads its saved agent", view?.outbound?.appId === "Amrita---We-4517816a-a47a", view?.outbound?.appId);
check("…batch still loads, its missing variables read as empty", view?.batch?.appId === "Amrita---We-4517816a-a47a" && (view?.batch?.agentVariables ?? []).length === 0);
check("…inbound reads as not-configured (null), not a crash", (view?.inbound ?? null) === null);

section("The hospital agent is renamed to Maya, keeping its id");

check("The hospital outbound agent name is Maya", providerConfigFor(WELLNESS)!.outbound!.agentName === "Maya", providerConfigFor(WELLNESS)!.outbound!.agentName);
check("…but its Sarvam agent id is unchanged", providerConfigFor(WELLNESS)!.outbound!.appId === "Amrita---We-4517816a-a47a");
check("TenWeb's agent name is NOT touched", providerConfigFor(TENWEB)!.outbound!.agentName === "Priya", providerConfigFor(TENWEB)!.outbound!.agentName);

section("Saving one workspace never changes another");

const tenwebBefore = JSON.stringify(providerConfigFor(TENWEB));
saveWorkspaceProvider(
  WELLNESS,
  { outbound: { ...wellness, phoneNumber: "+918064269999" } },
  "staff",
);
check("Editing Wellness did not change TenWeb", JSON.stringify(providerConfigFor(TENWEB)) === tenwebBefore);
check("…and Wellness kept its own agent id", providerConfigFor(WELLNESS)!.outbound!.appId === "Amrita---We-4517816a-a47a");
check("…while the edit landed", providerConfigFor(WELLNESS)!.outbound!.phoneNumber === "+918064269999");


// ============================================================
section("Exact Sarvam config from data/workspace-setup.json");

const fs = await import("node:fs");
const path = await import("node:path");

saveWorkspaceProvider(
  WELLNESS,
  { batch: { appId: "Amrita---We-4517816a-a47a", appVersion: 1, appType: "agent", connectionId: "old-conn", phoneNumbers: ["+910000000000"], attemptsPerSecond: 1, cohortMode: "stream", agentVariables: ["x"], retry: { maxRetries: 5, intervalMinutes: 15, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 }, schedule: { timezone: "Asia/Kolkata", startTime: "08:00", endTime: "20:00", days: ["Monday"] } } as never },
  "setup"
);
saveWorkspaceProvider(
  WELLNESS,
  { inbound: { appId: "Amrita---We-4517816a-a47a", appVersion: 2, connectionId: "old-conn", agentVariables: ["keep_me"] } as never },
  "setup"
);
const retryBefore = JSON.stringify(providerConfigFor(WELLNESS)!.batch!.retry);

fs.writeFileSync(
  path.join(process.cwd(), "data", "workspace-setup.json"),
  JSON.stringify({ workspaces: { [WELLNESS]: {
    inbound: { appId: "Amrita---We-4517816a-a47a", appVersion: 1, connectionId: "8800e72c-9c8f9c2a3f-4876" },
    batch: { appVersion: 4, connectionId: "8800e72c-9c8f9c2a3f-4876", phoneNumbers: ["+918064269489"] },
  } } })
);

resetMigrationGuardForTests();
runStartupMigrations();

const whInbound = providerConfigFor(WELLNESS)!.inbound!;
const whBatch = providerConfigFor(WELLNESS)!.batch!;
check("inbound version set from the file", whInbound.appVersion === 1, whInbound.appVersion);
check("inbound connection set from the file", whInbound.connectionId === "8800e72c-9c8f9c2a3f-4876");
check("inbound agent id preserved (Amrita)", whInbound.appId === "Amrita---We-4517816a-a47a");
check("inbound declared variables preserved", JSON.stringify(whInbound.agentVariables) === JSON.stringify(["keep_me"]), whInbound.agentVariables);
check("batch version merged to 4", whBatch.appVersion === 4, whBatch.appVersion);
check("batch phoneNumbers merged", JSON.stringify(whBatch.phoneNumbers) === JSON.stringify(["+918064269489"]));
check("batch retry rules PRESERVED through the merge", JSON.stringify(whBatch.retry) === retryBefore);
check("TenWeb untouched by a file that does not name it", providerConfigFor(TENWEB)!.outbound!.appId === "Conversatio-834500dd-d3c1");

fs.rmSync(path.join(process.cwd(), "data", "workspace-setup.json"));
resetMigrationGuardForTests();
runStartupMigrations();
check("A missing setup file changes nothing", providerConfigFor(WELLNESS)!.inbound!.appVersion === 1);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
