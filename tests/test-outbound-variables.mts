// ============================================================
// The outbound request, as Sarvam would receive it
// ============================================================
//
// The suite above checks which variables are chosen. This one checks what
// actually leaves: the payload is intercepted at `fetch`, so the real service
// builds the real request and nothing reaches Sarvam. No call is placed, and
// the only credential in play is a fake one set for this process.
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("outbound-variables");

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
const { saveWorkspaceProvider, resolveOutbound } = await import("@/lib/providers/config");
const { sarvamVoiceService } = await import("@/lib/providers/sarvam/voice-agents");
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
const AMRITA = "Amrita---We-4517816a-a47a";
const AMRITA_VARIABLES = ["customer_name", "phone_number", "appointment_department"];
const WELLNESS = "ws_wellness";
const TENWEB = "ws_tenweb";

db.saveTenant({ id: WELLNESS, name: "Wellness Hospital", createdAt: now });
db.saveTenant({ id: TENWEB, name: "TenWeb", createdAt: now });
db.saveAgentConfig(WELLNESS, { companyName: "Wellness Hospital", productName: "Appointments", industry: "Healthcare" });
db.saveAgentConfig(TENWEB, { companyName: "TenWeb", productName: "KhushiBot", industry: "Web services" });

saveWorkspaceProvider(
  WELLNESS,
  { outbound: { appId: AMRITA, appVersion: 2, connectionId: "conn-wellness", phoneNumber: "+918064269111", agentName: "Amrita", agentVariables: AMRITA_VARIABLES } },
  "setup"
);
saveWorkspaceProvider(
  TENWEB,
  { outbound: { appId: "Agent-TenWeb", appVersion: 4, connectionId: "conn-tenweb", phoneNumber: "+918064269194", agentName: "Khushi", agentVariables: [...SALES_AGENT_VARIABLES] } },
  "setup"
);

const place = async (tenantId: string, companyName: string) => {
  // Throws when the workspace is not configured, which is what the call path
  // does; a suite that got that far would be testing the wrong thing.
  const provider = resolveOutbound(tenantId);
  return sarvamVoiceService.startOutboundCall({
    provider,
    tenantId,
    leadId: "lead_1",
    leadName: "Ananya Rao",
    leadPhone: "+919845012210",
    companyName,
    agentConfig: db.getAgentConfig(tenantId),
    webhookBaseUrl: "https://example.test",
    callId: "call_1",
  });
};

// ---------------- Wellness Hospital ----------------
section("A single outbound call from Wellness Hospital");

const result = await place(WELLNESS, "Wellness Hospital");
const sent = lastSent as Sent | null;
const appConfig = (sent?.body.app_config ?? {}) as Record<string, unknown>;
const variables = (appConfig.agent_variables ?? {}) as Record<string, unknown>;
const names = Object.keys(variables);

check("The call was accepted", result.attemptId === "attempt_1", result);
check("It dialled on Amrita", appConfig.app_id === AMRITA, appConfig.app_id);
check("Every variable sent is one Amrita declares", names.every((name) => AMRITA_VARIABLES.includes(name)), names);

const REJECTED = [
  "productCategory", "lead_notes", "industryVertical", "companyName", "userName",
  "seller_company_name", "company_name", "product_name", "proposedNextStepDefault",
];
check("None of the variables Sarvam rejected is sent", REJECTED.filter((name) => names.includes(name)).length === 0, names);
check("The customer's name travels", variables.customer_name === "Ananya Rao", variables);
check("…and the number", variables.phone_number === "+919845012210", variables);
check("The request went to Sarvam's own host", (sent?.url ?? "").startsWith("https://apps.sarvam.ai/"), sent?.url);
check("The key travelled in a header, not the body", Boolean(sent?.apiKey) && !JSON.stringify(sent?.body).includes("test-key-not-a-real-credential"));

// ---------------- TenWeb, unchanged ----------------
section("TenWeb's calls are unchanged");

await place(TENWEB, "TenWeb");
const tenwebNames = Object.keys(((lastSent as Sent | null)?.body.app_config as Record<string, unknown> ?? {}).agent_variables as Record<string, unknown> ?? {});
check("TenWeb still dials on its own agent", (((lastSent as Sent | null)?.body.app_config ?? {}) as Record<string, unknown>).app_id === "Agent-TenWeb");
check("…and still sends its sales variables", tenwebNames.includes("productCategory") || tenwebNames.includes("industryVertical"), tenwebNames);
check("…none of which leaked from Wellness Hospital", !tenwebNames.includes("appointment_department"), tenwebNames);

// ---------------- a 422 that names the problem ----------------
section("When Sarvam still refuses");

nextResponse = {
  status: 422,
  body: {
    error: {
      message: `Invalid Parameter: Agent variables '{'customer_name', 'appointment_department'}' not found in agent variables of app '${AMRITA}'`,
      type: "invalid_parameter",
    },
  },
};

let refused: unknown = null;
try {
  await place(WELLNESS, "Wellness Hospital");
} catch (error) {
  refused = error;
}
const message = refused instanceof Error ? refused.message : String(refused);
check("The call is reported as refused, not placed", refused !== null);
check("The message names the variables the agent does not declare", /customer_name/.test(message) && /appointment_department/.test(message), message);
check("…and names the agent", message.includes(AMRITA), message);
check("…and says what to do about it", /Settings/.test(message) && /No call was placed/.test(message), message);
check("The API key is not in the message", !message.includes("test-key-not-a-real-credential"));

// ---------------- an unlisted workspace ----------------
section("A workspace that has not listed its variables");

nextResponse = { status: 200, body: { attempt_id: "attempt_2" } };
const UNLISTED = "ws_unlisted";
db.saveTenant({ id: UNLISTED, name: "Newly created", createdAt: now });
db.saveAgentConfig(UNLISTED, { companyName: "Newly created", productName: "Thing", industry: "Services" });
saveWorkspaceProvider(
  UNLISTED,
  { outbound: { appId: "Agent-Unknown", appVersion: 1, connectionId: "conn-unknown", phoneNumber: "+918000000099", agentName: null, agentVariables: [] } },
  "setup"
);

await place(UNLISTED, "Newly created");
const coreNames = Object.keys(((lastSent as Sent | null)?.body.app_config as Record<string, unknown> ?? {}).agent_variables as Record<string, unknown> ?? {});
check("It sends only the core few", coreNames.every((name) => ["customer_name", "phone_number", "company_name"].includes(name)), coreNames);
check("…not thirty sales variables", coreNames.length <= 3, coreNames.length);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
