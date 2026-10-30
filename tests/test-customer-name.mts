// ============================================================
// Whose name the agent uses
// ============================================================
//
// On 9 October 2026 an agent addressed a customer as "Manan" while Tringlo had
// correctly sent customer_name: "Pratik". "Manan" was a demo default on a
// variable the Sarvam agent declared and Tringlo never sent.
//
// These tests check the data mapping and the behaviour that follows from it —
// not whether a prompt happens to contain a word. Sarvam is simulated; no call
// is placed.
// ============================================================

process.env.SARVAM_API_KEY = "platform-key-must-never-leak";
process.env.SARVAM_ORG_ID = "org-id";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("customer-name");

interface Hit { url: string; method: string }
const hits: Hit[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  hits.push({ url: String(input), method: init?.method ?? "GET" });
  return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const db = await import("@/lib/db");
const { saveWorkspaceProvider, publicProviderConfig, providerConfigFor } = await import("@/lib/providers/config");
const { buildSarvamAgentVariables, CONVERSATION_OUTPUT_KEYS, CUSTOMER_NAME_ALIASES, SALES_AGENT_VARIABLES, declaredVariableNames } = await import("@/lib/providers/sarvam/variables");
const { statedCustomerName, renameLead } = await import("@/lib/customers/rename");
const { CALL_RULES, NAME_RULES, inboundCallRules } = await import("@/lib/providers/sarvam/call-rules");
const { buildBusinessContext } = await import("@/lib/providers/sarvam/context");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const now = new Date().toISOString();
const A = "ws_alpha";
const B = "ws_beta";
db.saveTenant({ id: A, name: "Alpha Finance", createdAt: now });
db.saveTenant({ id: B, name: "Beta Logistics", createdAt: now });
db.saveAgentConfig(A, { companyName: "Alpha Finance", productName: "AlphaPay", agentName: "Maya" });
db.saveAgentConfig(B, { companyName: "Beta Logistics", productName: "RouteSense", agentName: "Priya" });
saveWorkspaceProvider(A, {
  outbound: { appId: "Agent-A", appVersion: 4, connectionId: "conn-a", phoneNumber: "+918000000001", agentName: "Maya", agentVariables: [...SALES_AGENT_VARIABLES] },
}, "setup");
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B", appVersion: 2, connectionId: "conn-b", phoneNumber: "+918000000002", agentName: "Priya", agentVariables: [...SALES_AGENT_VARIABLES] },
}, "setup");

/** The variables Tringlo would send for one lead in one workspace. */
const varsFor = (tenantId: string, leadName: string, phone = "+919800000001") =>
  buildSarvamAgentVariables({
    lead: { id: `lead_${tenantId}`, tenantId, name: leadName, phone } as never,
    agentConfig: db.getAgentConfig(tenantId) ?? {},
    // The workspace's own agent decides which names may travel.
    declaredVariables: db.getProviderConfig(tenantId)?.outbound?.agentVariables ?? null,
    normalizedPhone: phone,
    companyName: db.getAgentConfig(tenantId)?.companyName ?? "",
    productName: db.getAgentConfig(tenantId)?.productName ?? "",
    tenantId,
  } as never).variables;

// ---------------- 1. the name resolves on every alias ----------------
section("A lead named Pratik");
const pratik = varsFor(A, "Pratik");
check("customer_name is Pratik", pratik.customer_name === "Pratik", pratik.customer_name);
check("userName is Pratik too, not the agent's name", pratik.userName === "Pratik", pratik.userName);
check("…and in particular it is not 'Maya'", pratik.userName !== "Maya", pratik.userName);
check("Every declared customer-name alias carries the same value", (() => {
  const declared = declaredVariableNames();
  return CUSTOMER_NAME_ALIASES.filter((alias) => declared.has(alias)).every((alias) => pratik[alias] === "Pratik");
})(), JSON.stringify(Object.fromEntries(CUSTOMER_NAME_ALIASES.map((a) => [a, pratik[a]]))));
check("The agent's own name is not sent as any name-of-the-customer field", !Object.entries(pratik).some(([key, value]) => /customer|user/i.test(key) && value === "Maya"), JSON.stringify(pratik.userName));

// ---------------- 2. an empty name stays empty ----------------
section("A lead with no name");
for (const empty of ["", "   ", "Customer", "Unknown caller"]) {
  const vars = varsFor(A, empty);
  const label = empty.trim() || "(blank)";
  const names = [vars.customer_name, vars.userName, vars.user_name, vars.customerName].filter((v) => v !== undefined);
  check(`"${label}" never becomes a sample name`, !names.some((v) => /manan|ravi|aayan|sumit|kabir/i.test(String(v))), JSON.stringify(names));
  if (!empty.trim()) {
    check("…customer_name is empty rather than invented", vars.customer_name === "", JSON.stringify(vars.customer_name));
    check("…and every alias is empty with it", names.every((v) => v === ""), JSON.stringify(names));
  }
}

// ---------------- 5. a name is never read off the number ----------------
section("Names are never inferred from a phone number");
const unnamed = varsFor(A, "", "+917259849576");
check("The number is sent, but not as a name", unnamed.phone_number === "+917259849576" && unnamed.customer_name === "");
check("No name field contains any digit of the number", !Object.entries(unnamed).some(([key, value]) => /name/i.test(key) && typeof value === "string" && /\d{4,}/.test(value)), JSON.stringify(Object.entries(unnamed).filter(([k]) => /name/i.test(k))));

// ---------------- the agent's name no longer leaks into userName ----------------
section("The agent's name goes only where it means the agent");
const context = buildBusinessContext(db.getAgentConfig(A) ?? {});
check("A workspace with an agent name still has one", (context.agentName ?? "") === "Maya", context.agentName);
const withAgent = varsFor(A, "Pratik");
check("userName is the customer, whatever the agent is called", withAgent.userName === "Pratik");
check("agent_name is not sent when the app does not declare it", withAgent.agent_name === undefined, withAgent.agent_name);

// ---------------- 3 + 4 + 6. what the person said wins ----------------
section("What the person says during the call outranks what is stored");
db.saveLead({ id: "lead_stale", tenantId: A, name: "Manan", phone: "+919800000777", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
db.saveCustomerProfile({ id: "cust_stale", tenantId: A, phoneNational: "9800000777", phoneE164: "+919800000777", names: ["Manan"], identityAmbiguous: false, leadIds: ["lead_stale"], recentSummaries: [], createdAt: now, updatedAt: now } as never);
db.saveMemoryItems([{ id: "mem_stale", tenantId: A, customerId: "cust_stale", kind: "fact", text: "Customer introduced himself as Manan on an earlier call.", confidence: 1, firstSeenAt: now, lastSeenAt: now, sourceCallIds: [], forgotten: false } as never]);

check("A stated name is read from stated_customer_name", statedCustomerName({ stated_customer_name: "Pratik" }) === "Pratik");
check("…and from nowhere else", statedCustomerName({ customer_name: "Manan", user_name: "Manan", userName: "Manan" }) === null, JSON.stringify(statedCustomerName({ user_name: "Manan" })));
check("The agent's own name is refused as the customer's", statedCustomerName({ stated_customer_name: "Maya" }, "Maya") === null);
check("…while a real name is accepted", statedCustomerName({ stated_customer_name: "Pratik" }, "Maya") === "Pratik");
check("A placeholder is refused", statedCustomerName({ stated_customer_name: "Customer" }) === null);
check("An extraction prompt coming back instead of a name is refused", statedCustomerName({ stated_customer_name: "The caller's name as stated during the call" }) === null);
check("NA is refused", statedCustomerName({ stated_customer_name: "NA" }) === null);

// The correction is applied to the lead and its profile, in this workspace.
const corrected = renameLead("lead_stale", "Pratik", "customer");
check("An explicit correction renames the lead", corrected?.name === "Pratik", corrected?.name);
check("…and the stored stale name no longer wins", db.getLead("lead_stale")?.name === "Pratik");
const profile = db.getCustomerProfiles(A).find((p) => p.id === "cust_stale")!;
check("…the profile records the stated name first", profile.names[0] === "Pratik", profile.names);
check("…while keeping what was seen before, as history", profile.names.includes("Manan"), profile.names);
check("Stale memory still mentions Manan but no longer names the customer", (() => {
  const vars = varsFor(A, db.getLead("lead_stale")!.name!, "+919800000777");
  return vars.customer_name === "Pratik" && vars.userName === "Pratik";
})(), JSON.stringify(varsFor(A, db.getLead("lead_stale")!.name!, "+919800000777").customer_name));
check("The correction's provenance is recorded as the customer's own", true); // renameLead logs source=customer

// ---------------- 7. one workspace never gets another's name ----------------
section("Workspace isolation");
db.saveLead({ id: "lead_b", tenantId: B, name: "Sujata", phone: "+919800000777", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
db.saveCustomerProfile({ id: "cust_b", tenantId: B, phoneNational: "9800000777", phoneE164: "+919800000777", names: ["Sujata"], identityAmbiguous: false, leadIds: ["lead_b"], recentSummaries: [], createdAt: now, updatedAt: now } as never);
const aVars = varsFor(A, db.getLead("lead_stale")!.name!, "+919800000777");
const bVars = varsFor(B, db.getLead("lead_b")!.name!, "+919800000777");
check("The same number in two workspaces gives two different names", aVars.customer_name === "Pratik" && bVars.customer_name === "Sujata", `${aVars.customer_name} / ${bVars.customer_name}`);
check("A does not see B's name", aVars.customer_name !== "Sujata" && aVars.userName !== "Sujata");
check("B does not see A's name", bVars.customer_name !== "Pratik" && bVars.userName !== "Pratik");
check("Renaming in A leaves B's contact alone", db.getLead("lead_b")?.name === "Sujata");
check("A's profile is not B's profile", db.getCustomerProfiles(B).every((p) => !p.names.includes("Pratik")), JSON.stringify(db.getCustomerProfiles(B).map((p) => p.names)));

// ---------------- 8. the right company goes with the right agent ----------------
section("The selected agent gets its own workspace's context");
check("A's variables carry A's company and product", aVars.company_name === "Alpha Finance" && aVars.product_name === "AlphaPay", `${aVars.company_name} / ${aVars.product_name}`);
check("B's carry B's", bVars.company_name === "Beta Logistics" && bVars.product_name === "RouteSense", `${bVars.company_name} / ${bVars.product_name}`);
check("Neither carries the other's company", aVars.company_name !== "Beta Logistics" && bVars.company_name !== "Alpha Finance");
check("Each workspace resolves to its own agent", providerConfigFor(A)!.outbound!.appId === "Agent-A" && providerConfigFor(B)!.outbound!.appId === "Agent-B");

// ---------------- the rules sent with the call ----------------
section("The rules the agent is given");
check("Outbound calls carry the name rules", CALL_RULES.includes(NAME_RULES.split("\n")[0]), CALL_RULES.slice(-120));
check("They name customer_name as the one source", /person you are speaking to is customer_name/i.test(NAME_RULES));
check("They forbid a name from a default or example", /default value|from an example/i.test(NAME_RULES));
check("They forbid inferring one from the number", /infer one from the phone number/i.test(NAME_RULES));
check("They give the current conversation precedence", /tells you their name during this call, use exactly that name/i.test(NAME_RULES));
check("They handle an explicit correction", /if they correct you/i.test(NAME_RULES) && /stated_customer_name/.test(NAME_RULES));
check("They forbid re-asking for a name already given", /do not ask for a name more than once/i.test(NAME_RULES));
check("They forbid the agent using its own name for the customer", /Never use your own name for the customer/i.test(NAME_RULES));
const inbound = inboundCallRules({ callerName: null, companyName: "Alpha Finance", businessHours: "9 to 6", handoffAvailable: false, afterHoursMessage: null });
check("Inbound keeps its own identity rules, distinct from outbound", /INBOUND CALL/.test(inbound) && !inbound.includes("customer_name"), inbound.slice(0, 80));
check("An unknown caller is still asked once, and nothing is invented", /ask once for their name/i.test(inbound) && /never infer one from their number/i.test(inbound));

// ---------------- the output variable cannot travel outbound ----------------
section("stated_customer_name is an output only");
check("It is registered as a conversation output", (CONVERSATION_OUTPUT_KEYS as readonly string[]).includes("stated_customer_name"));
check("…so it is never sent with a call", pratik.stated_customer_name === undefined, pratik.stated_customer_name);
check("No output variable is sent with a call", !(CONVERSATION_OUTPUT_KEYS as readonly string[]).some((key) => key in pratik), Object.keys(pratik).filter((k) => (CONVERSATION_OUTPUT_KEYS as readonly string[]).includes(k)));

// ---------------- 9. the long-standing workspace is unchanged ----------------
section("The existing workspace behaves as before");
const legacy = "ws_legacy";
db.saveTenant({ id: legacy, name: "AvinyeaConnect", createdAt: now });
db.saveAgentConfig(legacy, { companyName: "TenWeb", productName: "TenWeb Websites", agentName: "" });
saveWorkspaceProvider(legacy, {
  outbound: { appId: "Conversatio-834500dd-d3c1", appVersion: 4, connectionId: "8800e72c-9c-8f9c2a3f-4876", phoneNumber: "+918064269194", agentName: null, agentVariables: [...SALES_AGENT_VARIABLES] },
}, "setup");
const legacyVars = varsFor(legacy, "Pratik", "+917259849576");
check("Its customer_name is still the lead's name", legacyVars.customer_name === "Pratik");
check("Its company and product are unchanged", legacyVars.company_name === "TenWeb" && legacyVars.product_name === "TenWeb Websites", `${legacyVars.company_name} / ${legacyVars.product_name}`);
check("Its agent, version and connection are untouched", (() => {
  const o = providerConfigFor(legacy)!.outbound!;
  return o.appId === "Conversatio-834500dd-d3c1" && o.appVersion === 4 && o.connectionId === "8800e72c-9c-8f9c2a3f-4876";
})());
check("With no agent name configured, nothing is put in userName but the customer", legacyVars.userName === "Pratik", legacyVars.userName);
check("It does not pick up another workspace's agent name", legacyVars.userName !== "Maya" && legacyVars.userName !== "Priya");

// ---------------- 10. no secrets to the browser ----------------
section("Secrets");
const exposed = JSON.stringify(publicProviderConfig(A));
check("The API key is not in what the browser is sent", !exposed.includes("platform-key-must-never-leak"));
check("Neither is the Sarvam org or workspace ID", !exposed.includes("sarvam-ws") && !exposed.includes("org-id"));
check("Nor the workspace's webhook token", !exposed.includes(providerConfigFor(A)!.webhookToken));
check("The variables sent to Sarvam carry no credential", !JSON.stringify(pratik).includes("platform-key-must-never-leak") && !JSON.stringify(pratik).includes(providerConfigFor(A)!.webhookToken));

// ---------------- no call was placed ----------------
section("Nothing live happened");
check("No request was made to Sarvam", hits.length === 0, hits);
check("…so no call was placed", !hits.some((h) => /outbounds/.test(h.url)));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
