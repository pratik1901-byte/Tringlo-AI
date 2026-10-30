// On-start context hook — authentication and resolution.
// Scratch database, simulated Sarvam, no calls placed.
process.env.SARVAM_API_KEY = "platform-key";
process.env.SARVAM_ORG_ID = "org";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";
process.env.DIALO_WEBHOOK_TOKEN = "g".repeat(32); // the retired global token

const deployments: Record<string, string> = {};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const json = (v: unknown, s = 200) => new Response(JSON.stringify(v), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("/app-authoring/") && /\/deployments$/.test(url) && (init?.method ?? "GET") === "POST") {
    const id = `dep-${Object.keys(deployments).length + 1}`;
    deployments[id] = "active";
    return json({ deployment_id: id, status: "active" });
  }
  if (/\/deployments\?limit=/.test(url)) return json({ items: Object.entries(deployments).map(([id, status]) => ({ deployment_id: id, status, phone_numbers: [] })) });
  const one = url.match(/\/app-authoring\/.*\/deployments\/([^/?]+)$/);
  if (one) return deployments[one[1]] ? json({ deployment_id: one[1], status: "active" }) : json({ error: { message: "Not found" } }, 404);
  const st = url.match(/\/deployments\/([^/?]+)\/status$/);
  if (st) return json({ deployment_id: st[1], status: "active" });
  if (url.includes("/cohorts/")) return json({ cohort_id: "c", status: "completed" });
  return json({ items: [] });
}) as typeof fetch;

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("hook");

const db = await import("@/lib/db");
const { SALES_AGENT_VARIABLES } = await import("@/lib/providers/sarvam/variables");
const { saveWorkspaceProvider, providerConfigFor } = await import("@/lib/providers/config");
const inbound = await import("@/lib/inbound/service");
const contextRoute = await import("@/app/api/webhooks/sarvam/inbound/context/route");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const now = new Date().toISOString();
const A = "ws_a", B = "ws_b";
const PHONE_A = "+919800000001", PHONE_B = "+919700000002";

db.saveWebhookBaseUrl("https://dialo.example.com");
for (const [id, name] of [[A, "TenWeb"], [B, "BrightPath"]]) db.saveTenant({ id, name, createdAt: now });
db.saveAgentConfig(A, { companyName: "TenWeb", productName: "KhushiBot", agentName: "Priya" });
db.saveAgentConfig(B, { companyName: "BrightPath", productName: "RouteSense", agentName: "Arjun" });
for (const [id, agent] of [[A, "Agent-A"], [B, "Agent-B"]]) {
  saveWorkspaceProvider(id, {
    outbound: { appId: agent, appVersion: 4, connectionId: "c", phoneNumber: "+918000000000", agentName: "Priya", agentVariables: [...SALES_AGENT_VARIABLES] },
    inbound: { appId: `${agent}-in`, appVersion: 11, connectionId: "c", agentVariables: [...SALES_AGENT_VARIABLES] },
  }, "test");
}
// A known caller in A only.
db.saveLead({ id: "lead_a", tenantId: A, name: "Pratik", phone: PHONE_A, callingDate: "", callingTime: "", timezone: "Asia/Kolkata", createdAt: now, status: "completed", suppressed: false } as never);
db.saveLead({ id: "lead_b", tenantId: B, name: "Ravi", phone: PHONE_B, callingDate: "", callingTime: "", timezone: "Asia/Kolkata", createdAt: now, status: "completed", suppressed: false } as never);

const line = { startTime: "00:00", endTime: "23:59", days: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] as never, timezone: "Asia/Kolkata", handoffNumber: "+919999999999", afterHoursMessage: null };
const enA = await inbound.enableInbound(A, { ...line, phoneNumber: "+918064269194" });
const enB = await inbound.enableInbound(B, { ...line, phoneNumber: "+918099990000" });
const depA = enA.settings.deploymentId!, depB = enB.settings.deploymentId!;
const tokenA = providerConfigFor(A)!.webhookToken, tokenB = providerConfigFor(B)!.webhookToken;

const hook = (token: string | null, params: Record<string, string>) => {
  const query = new URLSearchParams({ ...(token ? { k: token } : {}), ...params });
  return contextRoute.GET(new Request(`http://localhost/api/webhooks/sarvam/inbound/context?${query}`));
};

console.log("\n=== Authentication ===");
const okRes = await hook(tokenA, { deployment_id: depA, user_phone_number: PHONE_A });
const okJson = await okRes.json();
check("Valid workspace token → accepted", okRes.status === 200, okRes.status);
check("Wrong workspace token → rejected", (await hook(tokenB, { deployment_id: depA, user_phone_number: PHONE_A })).status === 404);
check("Retired global token → rejected", (await hook(process.env.DIALO_WEBHOOK_TOKEN!, { deployment_id: depA, user_phone_number: PHONE_A })).status === 401);
check("No token → rejected", (await hook(null, { deployment_id: depA, user_phone_number: PHONE_A })).status === 401);
check("Unknown deployment → rejected", (await hook(tokenA, { deployment_id: "dep-nope", user_phone_number: PHONE_A })).status === 404);
check("Made-up token → rejected", (await hook("ws_" + "0".repeat(48), { deployment_id: depA, user_phone_number: PHONE_A })).status === 401);

console.log("\n=== Resolution: deployment → workspace → context ===");
check("Known caller is named", okJson.customer_name === "Pratik", okJson.customer_name);
check("Known caller is marked known", okJson.caller_known === "yes");
check("The greeting is this workspace's company", /TenWeb/.test(okJson.inbound_greeting ?? "") && !/BrightPath/.test(JSON.stringify(okJson)), okJson.inbound_greeting);
check("Handoff facts come from this workspace's line", okJson.human_handoff_number === "+919999999999");

const unknown = await (await hook(tokenA, { deployment_id: depA, user_phone_number: "+919333333333" })).json();
check("Unknown caller gets no name", !unknown.customer_name, unknown.customer_name);
check("Unknown caller gets no invented memory", !unknown.previous_interaction && !unknown.customer_memory_context, { p: unknown.previous_interaction, c: unknown.customer_memory_context });
check("Unknown caller is marked unknown", unknown.caller_known === "no");
check("The agent is told to ask for the name once", /May I know your name/i.test(unknown.proposedNextStepDefault ?? ""), (unknown.proposedNextStepDefault ?? "").slice(0, 120));

console.log("\n=== Cross-workspace caller context ===");
const bAsksForOwn = await (await hook(tokenB, { deployment_id: depB, user_phone_number: PHONE_B })).json();
check("B sees its own caller", bAsksForOwn.customer_name === "Ravi", bAsksForOwn.customer_name);
check("B never sees A's company or product", !/TenWeb|KhushiBot|Priya/.test(JSON.stringify(bAsksForOwn)), JSON.stringify(bAsksForOwn).slice(0, 120));
// The same number known in A, asked for with B's token on B's line.
const crossed = await (await hook(tokenB, { deployment_id: depB, user_phone_number: PHONE_A })).json();
check("A's caller is a stranger to B", !crossed.customer_name && crossed.caller_known === "no", crossed.customer_name);
check("A cannot ask about B's line", (await hook(tokenA, { deployment_id: depB, user_phone_number: PHONE_B })).status === 404);

console.log("\n=== Secrets ===");
const everything = JSON.stringify([okJson, unknown, bAsksForOwn, crossed]);
check("No token in any response", !everything.includes(tokenA) && !everything.includes(tokenB) && !everything.includes(process.env.DIALO_WEBHOOK_TOKEN!));
check("No API key in any response", !everything.includes("platform-key"));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
