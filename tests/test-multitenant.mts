// ============================================================
// Two workspaces, one Sarvam account — isolation test
// ============================================================
//
// Workspace A is TenWeb with Agent A. Workspace B is a different company with
// Agent B. They share Tringlo's single Sarvam organisation, workspace and API
// key, exactly as the architecture intends.
//
// Everything Sarvam would answer is SIMULATED; no call is placed. What is real
// is Tringlo's own routing, scoping and refusals.
// ============================================================

process.env.SARVAM_API_KEY = "platform-key";
process.env.SARVAM_ORG_ID = "org";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";
process.env.TRINGLO_WEBHOOK_TOKEN = "s".repeat(32);
process.env.ALLOW_CALLS_WITHOUT_WEBHOOK = "true";

// ---------------- simulated Sarvam ----------------
interface Hit { method: string; url: string; body: unknown }
// The project root, wherever the repository is checked out.
const PROJECT = (await import("node:url")).fileURLToPath(new URL("..", import.meta.url)).split("\\").join("/").replace(/\/$/, "");

const hits: Hit[] = [];
const deployments: Record<string, { status: string; phones: string[] }> = {};
let nextAttempt = 1;
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
  if (url.includes("/outbounds")) return json({ attempt_id: `att-${nextAttempt++}`, status: "accepted" });
  if (url.includes("/app-authoring/") && /\/deployments$/.test(url) && method === "POST") {
    const payload = body as { connection_configs: Array<{ phone_numbers: string[] }> };
    const id = `dep-${Object.keys(deployments).length + 1}`;
    deployments[id] = { status: "active", phones: payload.connection_configs[0].phone_numbers };
    return json({ deployment_id: id, status: "active" });
  }
  if (/\/deployments\?limit=/.test(url)) {
    return json({ items: Object.entries(deployments).map(([id, d]) => ({ deployment_id: id, status: d.status, phone_numbers: d.phones })) });
  }
  const status = url.match(/\/deployments\/([^/?]+)\/status$/);
  if (status && method === "PUT") {
    deployments[status[1]].status = (body as { action: string }).action === "pause" ? "paused" : "active";
    return json({ deployment_id: status[1], status: deployments[status[1]].status });
  }
  const one = url.match(/\/app-authoring\/.*\/deployments\/([^/?]+)$/);
  if (one) {
    if (!deployments[one[1]]) return json({ error: { message: "Not found" } }, 404);
    return json({ deployment_id: one[1], status: deployments[one[1]].status });
  }
  if (url.includes("/cohorts/upload") || url.includes("/cohorts/stream")) return json({ cohort_id: "coh", status: "completed" });
  if (url.includes("/webhooks?")) return json({ items: [] });
  if (url.includes("/interactions")) return json({ items: [] });
  return json({ error: "unhandled" }, 404);
}) as typeof fetch;

// ---------------- harness ----------------
// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("multitenant");

const db = await import("@/lib/db");
const { SALES_AGENT_VARIABLES } = await import("@/lib/providers/sarvam/variables");
const { saveWorkspaceProvider, providerConfigFor } = await import("@/lib/providers/config");
const { runStartupMigrations } = await import("@/lib/db/migrations");
const { placeCall } = await import("@/lib/calls/place-call");
const { buildAgentKnowledgeContext } = await import("@/lib/rag");
const { hashSessionToken } = await import("@/lib/auth/sessions");
const inbound = await import("@/lib/inbound/service");
const { applySarvamEvent } = await import("@/lib/calls/service");
const { NextRequest } = await import(new URL("../node_modules/next/server.js", import.meta.url).href);

const ragRoute = await import("@/app/api/integrations/sarvam/rag/route");
const recordsRoute = await import("@/app/api/records/route");
const contactsRoute = await import("@/app/api/contacts/route");
const metricsRoute = await import("@/app/api/metrics/route");
const leadsRoute = await import("@/app/api/leads/route");
const followUpsRoute = await import("@/app/api/follow-ups/route");
const campaignsRoute = await import("@/app/api/campaigns/route");
const customersRoute = await import("@/app/api/customers/route");
const inboundAnalyticsRoute = await import("@/app/api/inbound/analytics/route");
const providerRoute = await import("@/app/api/integrations/provider/route");
const agentConfigRoute = await import("@/app/api/agent-config/route");

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}  — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const now = new Date().toISOString();

// ---------------- two workspaces ----------------
const A = "ws_tenweb", B = "ws_brightpath";
db.saveTenant({ id: A, name: "TenWeb", createdAt: now });
db.saveTenant({ id: B, name: "BrightPath Logistics", createdAt: now });
db.saveWebhookBaseUrl("https://tringlo.example.com");

const auth = (tenantId: string, token: string) => {
  const userId = `user_${tenantId}`;
  db.saveUser({ id: userId, tenantId, email: `${tenantId}@x.test`, name: tenantId, passwordHash: "x", role: "owner", createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0 });
  db.saveSession({ id: `s_${tenantId}`, tokenHash: hashSessionToken(token), userId, tenantId, createdAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), lastSeenAt: now, client: "test" });
  db.grantMembership({ userId, tenantId, role: "owner" });
  return { authorization: `Bearer ${token}` };
};
const authA = auth(A, "token-a-000000000000000000000000");
const authB = auth(B, "token-b-000000000000000000000000");

// Deliberately different companies, different products, different agents.
db.saveAgentConfig(A, { companyName: "TenWeb", productName: "KhushiBot", productDescription: "An AI learning companion for children aged 3 to 7.", faqs: "Q: What age is KhushiBot for?\nA: Children aged three to seven." });
db.saveAgentConfig(B, { companyName: "BrightPath Logistics", productName: "RouteSense", productDescription: "Fleet routing software for cold-chain delivery.", faqs: "Q: Does RouteSense track temperature?\nA: Yes, per vehicle." });

saveWorkspaceProvider(A, {
  outbound: { appId: "Agent-A", appVersion: 4, connectionId: "conn-a", phoneNumber: "+918064269194", agentName: "Priya", agentVariables: [...SALES_AGENT_VARIABLES] },
  inbound: { appId: "Agent-A-inbound", appVersion: 11, connectionId: "conn-a", agentVariables: [...SALES_AGENT_VARIABLES] },
}, "test");
saveWorkspaceProvider(B, {
  outbound: { appId: "Agent-B", appVersion: 2, connectionId: "conn-b", phoneNumber: "+918099990000", agentName: "Arjun", agentVariables: [...SALES_AGENT_VARIABLES] },
  inbound: { appId: "Agent-B-inbound", appVersion: 3, connectionId: "conn-b", agentVariables: [...SALES_AGENT_VARIABLES] },
}, "test");

const lead = (id: string, tenantId: string, name: string, phone: string) =>
  db.saveLead({ id, tenantId, name, phone, callingDate: "", callingTime: "", timezone: "Asia/Kolkata", createdAt: now, status: "queued", suppressed: false } as never);
// The SAME number in both workspaces: two different people, two memories.
lead("lead_a", A, "Pratik", "+919800000001");
lead("lead_b", B, "Ravi", "+919800000001");

// ================= 1. outbound uses each workspace's own agent =================
console.log("\n=== Outbound: agent and company per workspace ===");
const callA = await placeCall({ leadId: "lead_a", leadPhone: "+919800000001", leadName: "Pratik", tenantId: A, origin: "manual" } as never);
const callB = await placeCall({ leadId: "lead_b", leadPhone: "+919800000001", leadName: "Ravi", tenantId: B, origin: "manual" } as never);
check("Both workspaces could place a call", callA.ok && callB.ok, { a: callA, b: callB });

const outbounds = hits.filter((h) => h.url.includes("/outbounds"));
const payloadA = outbounds[0].body as { app_config: { app_id: string; app_version: number; connection_config: { connection_id: string; agent_phone_number: string }; agent_variables: Record<string, string> }; webhook_config: { url: string; metadata: Record<string, string> } };
const payloadB = outbounds[1].body as typeof payloadA;
check("A called with Agent A, B with Agent B", payloadA.app_config.app_id === "Agent-A" && payloadB.app_config.app_id === "Agent-B", { a: payloadA.app_config.app_id, b: payloadB.app_config.app_id });
check("Each used its own version, connection and caller number",
  payloadA.app_config.app_version === 4 && payloadB.app_config.app_version === 2 &&
  payloadA.app_config.connection_config.connection_id === "conn-a" && payloadB.app_config.connection_config.connection_id === "conn-b" &&
  payloadA.app_config.connection_config.agent_phone_number === "+918064269194" && payloadB.app_config.connection_config.agent_phone_number === "+918099990000",
  { a: payloadA.app_config.connection_config, b: payloadB.app_config.connection_config });
check("A's agent was told about KhushiBot, never RouteSense", /KhushiBot/.test(JSON.stringify(payloadA.app_config.agent_variables)) && !/RouteSense|BrightPath/.test(JSON.stringify(payloadA.app_config.agent_variables)));
check("B's agent was told about RouteSense, never KhushiBot", /RouteSense/.test(JSON.stringify(payloadB.app_config.agent_variables)) && !/KhushiBot|TenWeb/.test(JSON.stringify(payloadB.app_config.agent_variables)));
check("Each call reported its own workspace in metadata", payloadA.webhook_config.metadata.workspace_id === A && payloadB.webhook_config.metadata.workspace_id === B);
check("Each registered its own webhook token", payloadA.webhook_config.url.includes(providerConfigFor(A)!.webhookToken) && payloadB.webhook_config.url.includes(providerConfigFor(B)!.webhookToken));
check("One shared API key authenticated both", hits.every((h) => !h.url.includes("platform-key")));
check("The agent each call ran on is recorded with it", db.getCallRecord(callA.ok ? callA.callId : "")!.providerAppId === "Agent-A" && db.getCallRecord(callB.ok ? callB.callId : "")!.providerAppId === "Agent-B");

// ================= 2. an unconfigured workspace refuses =================
console.log("\n=== A new workspace inherits nothing ===");
const C = "ws_new";
db.saveTenant({ id: C, name: "Newly onboarded", createdAt: now });
lead("lead_c", C, "Someone", "+919700000007");
const callC = await placeCall({ leadId: "lead_c", leadPhone: "+919700000007", leadName: "Someone", tenantId: C, origin: "manual" } as never);
check("A workspace with no provider config cannot call", !callC.ok && callC.reason === "provider_not_configured", callC);
check("…and says so plainly", !callC.ok && /not configured for this workspace/i.test(callC.message), !callC.ok ? callC.message : "");
check("…and never borrowed another workspace's agent", hits.filter((h) => h.url.includes("/outbounds")).length === 2);

// ================= 3. RAG isolation =================
console.log("\n=== Knowledge ===");
const ragA = buildAgentKnowledgeContext(A, db.getAgentConfig(A), ["product", "age"]);
const ragB = buildAgentKnowledgeContext(B, db.getAgentConfig(B), ["temperature", "fleet"]);
check("A's knowledge is TenWeb's only", /KhushiBot/.test(ragA.compactContext) && !/RouteSense|BrightPath/.test(ragA.compactContext), ragA.compactContext.slice(0, 120));
check("B's knowledge is BrightPath's only", /RouteSense/.test(ragB.compactContext) && !/KhushiBot|TenWeb/.test(ragB.compactContext), ragB.compactContext.slice(0, 120));

const ragReq = (token: string | null, body: unknown) =>
  ragRoute.POST(new NextRequest(`http://localhost/api/integrations/sarvam/rag${token ? `?k=${token}` : ""}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
const ragAsA = await ragReq(providerConfigFor(A)!.webhookToken, { query: "what is the product" });
const ragAsAJson = await ragAsA.json();
check("Mid-call RAG with A's token returns A's knowledge", ragAsA.status === 200 && /KhushiBot/.test(ragAsAJson.context) && !/RouteSense/.test(ragAsAJson.context));
const forgedRag = await ragReq(providerConfigFor(A)!.webhookToken, { query: "what is the product", company_id: B, company_name: "BrightPath Logistics", tenant_id: B });
const forgedRagJson = await forgedRag.json();
check("A body claiming to be B is ignored — still A's knowledge", !/RouteSense|BrightPath/.test(JSON.stringify(forgedRagJson)), JSON.stringify(forgedRagJson).slice(0, 160));
check("The server-wide token cannot read any workspace's knowledge", (await ragReq(process.env.TRINGLO_WEBHOOK_TOKEN!, { query: "product" })).status === 401);
check("No token at all is refused", (await ragReq(null, { query: "product" })).status === 401);

// ================= 4. inbound routing =================
console.log("\n=== Inbound ===");
const line = { startTime: "00:00", endTime: "23:59", days: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] as never, timezone: "Asia/Kolkata", handoffNumber: null, afterHoursMessage: null };
const enA = await inbound.enableInbound(A, { ...line, phoneNumber: "+918064269194" });
const enB = await inbound.enableInbound(B, { ...line, phoneNumber: "+918099990000" });
check("Both lines went live on their own deployments", enA.ok && enB.ok && enA.settings.deploymentId !== enB.settings.deploymentId, { a: enA.settings.deploymentId, b: enB.settings.deploymentId });
const depA = enA.settings.deploymentId!, depB = enB.settings.deploymentId!;
const createA = hits.filter((h) => h.method === "POST" && /\/deployments$/.test(h.url)).map((h) => h.body as { app_id: string; app_version: number });
check("Each deployment runs its own workspace's inbound agent", createA[0].app_id === "Agent-A-inbound" && createA[0].app_version === 11 && createA[1].app_id === "Agent-B-inbound" && createA[1].app_version === 3, createA);

const inboundCall = (deployment: string, interaction: string, caller: string) => ({
  app_id: "x", deployment_id: deployment, interaction_id: interaction, user_phone_number: caller, agent_phone_number: "+910000000000",
  duration: 30, start_datetime: now, end_datetime: now,
  interaction_transcript: [{ role: "agent", en_text: "Hello." }, { role: "user", en_text: "A question." }],
  final_agent_variables: { call_summary: "They asked a question.", call_reason: "product_question", resolution_status: "resolved" },
});
applySarvamEvent(inboundCall(depA, "int-a1", "+919800000001") as never);
applySarvamEvent(inboundCall(depB, "int-b1", "+919800000001") as never);
const recA = db.getCallRecordByAttemptId("int-a1")!, recB = db.getCallRecordByAttemptId("int-b1")!;
check("Each inbound call landed in its own workspace", recA.tenantId === A && recB.tenantId === B, { a: recA.tenantId, b: recB.tenantId });
check("The same caller number is a different contact in each", recA.leadId !== recB.leadId && db.getLead(recA.leadId)!.tenantId === A && db.getLead(recB.leadId)!.tenantId === B);
applySarvamEvent(inboundCall("dep-does-not-exist", "int-x1", "+919800000001") as never);
check("An unmappable deployment creates nothing", !db.getCallRecordByAttemptId("int-x1"));
applySarvamEvent({ attempt_id: "camp-x", campaign_id: "no-such-campaign", user_identifier: "whoever", connectivity_status: "connected" } as never);
check("An unknown campaign id creates nothing", !db.getCallRecordByAttemptId("camp-x"));

// ================= 5. memory =================
console.log("\n=== Customer memory ===");
const profilesA = db.getCustomerProfiles(A), profilesB = db.getCustomerProfiles(B);
check("Each workspace has its own customer for the same number", profilesA.length === 1 && profilesB.length === 1 && profilesA[0].id !== profilesB[0].id);
check("A's memory items are invisible to B", db.getMemoryItems(B, profilesA[0].id).length === 0);
const customersA = await (await customersRoute.GET(new Request(`http://localhost/api/customers?phone=%2B919800000001`, { headers: authA }))).json();
const customersB = await (await customersRoute.GET(new Request(`http://localhost/api/customers?phone=%2B919800000001`, { headers: authB }))).json();
check("The customers API returns only the caller's own workspace", customersA.customers.every((c: { id: string }) => c.id !== profilesB[0].id) && customersB.customers.every((c: { id: string }) => c.id !== profilesA[0].id));

// ================= 6. cross-workspace API access =================
console.log("\n=== Cross-workspace API access ===");
// Some routes read request.nextUrl, so every call goes through NextRequest.
const get = async (route: { GET: (r: never) => Promise<Response> }, url: string, headers: Record<string, string>) => (await route.GET(new NextRequest(url, { headers }) as never)).json();
const recordsA = await get(recordsRoute as never, "http://localhost/api/records?limit=200", authA);
const recordsB = await get(recordsRoute as never, "http://localhost/api/records?limit=200", authB);
check("Records: A sees only A's calls", recordsA.records.every((r: { tenantId: string }) => r.tenantId === A) && recordsA.records.length > 0);
check("Records: B sees only B's calls", recordsB.records.every((r: { tenantId: string }) => r.tenantId === B) && recordsB.records.length > 0);
const contactsA = await get(contactsRoute as never, "http://localhost/api/contacts", authA);
check("Contacts: A never sees B's lead", JSON.stringify(contactsA).includes("lead_b") === false);
const leadsA = await get(leadsRoute as never, "http://localhost/api/leads", authA);
check("Leads: scoped", leadsA.leads.every((l: { tenantId: string }) => l.tenantId === A));
const followA = await get(followUpsRoute as never, "http://localhost/api/follow-ups", authA);
check("Follow-ups: scoped", (followA.followUps ?? []).every((f: { tenantId: string }) => f.tenantId === A));
const campaignsA = await get(campaignsRoute as never, "http://localhost/api/campaigns", authA);
check("Campaigns: scoped", (campaignsA.campaigns ?? []).every((c: { tenantId: string }) => c.tenantId === A));
const metricsA = await get(metricsRoute as never, "http://localhost/api/metrics", authA);
const metricsB = await get(metricsRoute as never, "http://localhost/api/metrics", authB);
check("Analytics: each workspace counts only its own calls", metricsA.metrics.totalCalls === 1 && metricsB.metrics.totalCalls === 1, { a: metricsA.metrics.totalCalls, b: metricsB.metrics.totalCalls });
const inboundA = await get(inboundAnalyticsRoute as never, "http://localhost/api/inbound/analytics", authA);
check("Inbound analytics: one inbound call each", inboundA.analytics.totals.inboundCalls === 1, inboundA.analytics.totals.inboundCalls);

// A record id from B is reported as missing to A, not as forbidden.
const otherRecord = await recordsRoute.GET(new NextRequest(`http://localhost/api/records?id=${recB.id}`, { headers: authA }) as never);
check("A asking for B's call by id gets 404", otherRecord.status === 404);
const renameOther = await leadsRoute.PATCH(new NextRequest("http://localhost/api/leads", { method: "PATCH", headers: { ...authA, "content-type": "application/json" }, body: JSON.stringify({ id: "lead_b", name: "Hijacked" }) }) as never);
check("A cannot rename B's lead", renameOther.status === 404 && db.getLead("lead_b")!.name === "Ravi");

// ================= 7. configuration isolation =================
console.log("\n=== Configuration ===");
const provA = await (await providerRoute.GET(new Request("http://localhost/api/integrations/provider", { headers: authA }))).json();
check("Provider settings show this workspace's agent", provA.outbound.appId === "Agent-A");
check("No API key, org or Sarvam workspace is ever returned", !JSON.stringify(provA).includes("platform-key") && !JSON.stringify(provA).includes("sarvam-ws") && !JSON.stringify(provA).includes("webhookToken"));
await providerRoute.PUT(new Request("http://localhost/api/integrations/provider", { method: "PUT", headers: { ...authA, "content-type": "application/json" }, body: JSON.stringify({ outbound: { appId: "Agent-A2", appVersion: 5, connectionId: "conn-a", phoneNumber: "+918064269194", agentName: "Priya", agentVariables: [...SALES_AGENT_VARIABLES] } }) }));
check("Changing A's agent is a configuration change only", providerConfigFor(A)!.outbound!.appId === "Agent-A2" && providerConfigFor(B)!.outbound!.appId === "Agent-B");
const profileA = await (await agentConfigRoute.GET(new NextRequest("http://localhost/api/agent-config", { headers: authA }) as never)).json();
check("Company profile is per workspace", profileA.agentConfig.companyName === "TenWeb");
await agentConfigRoute.PUT(new NextRequest("http://localhost/api/agent-config", { method: "PUT", headers: { ...authA, "content-type": "application/json" }, body: JSON.stringify({ agentConfig: { companyName: "TenWeb Renamed" } }) }) as never);
check("Editing A's profile leaves B's alone", db.getAgentConfig(A).companyName === "TenWeb Renamed" && db.getAgentConfig(B).companyName === "BrightPath Logistics");

// ================= 8. webhook forgery =================
console.log("\n=== Forged webhooks ===");
const webhookRoute = await import("@/app/api/webhooks/sarvam/inbound/route");
const forged = await webhookRoute.POST(new NextRequest(`http://localhost/api/webhooks/sarvam/inbound?k=${providerConfigFor(B)!.webhookToken}`, { method: "POST", body: JSON.stringify(inboundCall(depA, "int-forged", "+919800000001")), headers: { "content-type": "application/json" } }) as never);
void forged;
const forgedRecord = db.getCallRecordByAttemptId("int-forged");
check("B's token cannot move A's call into B", !forgedRecord || forgedRecord.tenantId === A, forgedRecord?.tenantId);
const noToken = await webhookRoute.POST(new NextRequest("http://localhost/api/webhooks/sarvam/inbound", { method: "POST", body: JSON.stringify(inboundCall(depA, "int-untokened", "+919800000001")), headers: { "content-type": "application/json" } }) as never);
check("A webhook with no token is rejected", noToken.status === 401 && !db.getCallRecordByAttemptId("int-untokened"));

// The on-start hook may only ask about its own line.
const contextRoute = await import("@/app/api/webhooks/sarvam/inbound/context/route");
const wrongLine = await contextRoute.GET(new Request(`http://localhost/api/webhooks/sarvam/inbound/context?k=${providerConfigFor(B)!.webhookToken}&deployment_id=${depA}&user_phone_number=%2B919800000001`));
check("B's token cannot read A's caller context", wrongLine.status === 404);
const rightLine = await contextRoute.GET(new Request(`http://localhost/api/webhooks/sarvam/inbound/context?k=${providerConfigFor(A)!.webhookToken}&deployment_id=${depA}&user_phone_number=%2B919800000001`));
const rightLineJson = await rightLine.json();
check("A's token reads A's caller context", rightLine.status === 200 && !/BrightPath|RouteSense/.test(JSON.stringify(rightLineJson)));

// ================= 9. no secret leaks =================
console.log("\n=== Secrets ===");
const allResponses = JSON.stringify([provA, profileA, recordsA, contactsA, metricsA, inboundA, customersA, ragAsAJson]);
check("No API key in any API response", !allResponses.includes("platform-key"));
check("No webhook token in any API response", !allResponses.includes(providerConfigFor(A)!.webhookToken) && !allResponses.includes(process.env.TRINGLO_WEBHOOK_TOKEN!));
check("No Sarvam org or workspace id in any API response", !allResponses.includes("sarvam-ws"));

// ================= 10. the six verification fixes =================
console.log("\n=== Retired global webhook token ===");
const globalTokenPost = await webhookRoute.POST(new NextRequest(`http://localhost/api/webhooks/sarvam/inbound?k=${process.env.TRINGLO_WEBHOOK_TOKEN}`, { method: "POST", body: JSON.stringify(inboundCall(depA, "int-globaltoken", "+919800000001")), headers: { "content-type": "application/json" } }) as never);
check("The old server-wide token is refused", globalTokenPost.status === 401 && !db.getCallRecordByAttemptId("int-globaltoken"), globalTokenPost.status);
check("A workspace token is still accepted", Boolean(db.getCallRecordByAttemptId("int-a1")));

console.log("\n=== No legacy-workspace fallback ===");
const { scopeToTenant, ownedByTenant } = await import("@/lib/auth/guard");
const orphan = { id: "orphan", tenantId: null } as { id: string; tenantId: string | null };
check("A record with no workspace is in nobody's list", scopeToTenant([orphan], A).length === 0 && scopeToTenant([orphan], B).length === 0);
check("…and is owned by nobody", !ownedByTenant(orphan, A) && !ownedByTenant(orphan, B));
db.saveCallRecord({ ...db.getCallRecord(recA.id)!, id: "call_unscoped", tenantId: null, providerAttemptId: "att-unscoped" } as never);
const recordsAfterOrphan = await get(recordsRoute as never, "http://localhost/api/records?limit=200", authA);
check("An unscoped call is not served to the original workspace", !JSON.stringify(recordsAfterOrphan).includes("call_unscoped"));

console.log("\n=== Webhook logs are workspace-scoped ===");
const eventsA = db.getRawEvents(A, 200);
const eventsB = db.getRawEvents(B, 200);
check("A's deliveries carry A's workspace", eventsA.length > 0 && eventsA.every((e) => e.tenantId === A), eventsA.length);
check("B's deliveries carry B's workspace", eventsB.length > 0 && eventsB.every((e) => e.tenantId === B), eventsB.length);
check("A cannot see B's deliveries", !eventsA.some((e) => e.tenantId === B));
const allEvents = db.getAllRawEvents(500);
const unmappable = allEvents.filter((e) => e.attemptId === "int-x1");
check("An unmappable delivery is assigned to no workspace", unmappable.length > 0 && unmappable.every((e) => !e.tenantId), unmappable.map((e) => e.tenantId));

console.log("\n=== Deployment ID is an explicit override ===");
const beforeDeployment = db.getInboundSettings(B)!.deploymentId;
const draft = { phoneNumber: "+918064269194", startTime: "00:00", endTime: "23:59", days: ["Monday"] as never, timezone: "Asia/Kolkata", handoffNumber: null, afterHoursMessage: null };
const pasted = inbound.saveInboundDraft(A, { ...draft, deploymentId: "Tringlo-AI-pasted-1234" });
check("An administrator can paste a deployment ID", pasted.ok && db.getInboundSettings(A)!.deploymentId === "Tringlo-AI-pasted-1234", pasted.problems);
check("…it touches only that workspace", db.getInboundSettings(B)!.deploymentId === beforeDeployment);
check("…and its status is re-checked rather than assumed live", db.getInboundSettings(A)!.deploymentStatus === "creating" && db.getInboundSettings(A)!.webhookUrl === null);
const stolen = inbound.saveInboundDraft(A, { ...draft, deploymentId: beforeDeployment! });
check("A deployment already serving another workspace is refused", !stolen.ok && /another workspace/i.test(stolen.problems[0] ?? ""), stolen.problems);
const malformed = inbound.saveInboundDraft(A, { ...draft, deploymentId: "no spaces allowed!" });
check("A malformed deployment ID is refused", !malformed.ok, malformed.problems);
const untouched = inbound.saveInboundDraft(A, draft);
check("Saving without the field leaves the deployment alone", untouched.ok && db.getInboundSettings(A)!.deploymentId === "Tringlo-AI-pasted-1234");
const cleared = inbound.saveInboundDraft(A, { ...draft, deploymentId: "" });
check("Clearing it hands management back to Tringlo", cleared.ok && db.getInboundSettings(A)!.deploymentId === null);
// Put A's real deployment back for anything after this.
inbound.saveInboundDraft(A, { ...draft, deploymentId: depA });

console.log("\n=== Empty company name ===");
const D = "ws_nameless";
db.saveTenant({ id: D, name: "Nameless", createdAt: now });
db.saveAgentConfig(D, { productName: "Something", productDescription: "A product with no company name set.", industry: "Testing" });
const ragD = buildAgentKnowledgeContext(D, db.getAgentConfig(D), ["product"]);
check("No dangling 'representing .'", !/representing \.|representing\s*$/m.test(ragD.compactContext), ragD.compactContext.slice(0, 200));
check("No empty 'Company: .' line", !/Company:\s*\./.test(ragD.compactContext));
check("It still says it is an AI", /you are an AI assistant/.test(ragD.compactContext));

console.log("\n=== Credentials come from the platform, not the environment ===");
const attemptsSource = (await import("node:fs")).readFileSync(PROJECT + "/src/lib/providers/sarvam/attempts.ts", "utf8");
check("attempts.ts no longer reads SARVAM_API_KEY", !/SARVAM_API_KEY/.test(attemptsSource));


console.log("\n=== A blank client override never wipes the stored company name ===");
// Workspace A has companyName "TenWeb". The browser's agent-config store is
// empty right after a reload, so the call modal sends { companyName: "" }.
// That blank must not erase the saved name and refuse the call.
const blankOverride = await placeCall({
  leadId: "lead_blank", leadPhone: "+919811111111", leadName: "Pratik", tenantId: A, origin: "manual",
  agentConfig: { companyName: "", productName: "", salesObjective: "" },
} as never);
check("The call is placed despite an empty override", blankOverride.ok === true, blankOverride.ok ? "" : (blankOverride as { reason?: string }).reason);
check("…and it was NOT refused for a missing company name", (blankOverride as { reason?: string }).reason !== "missing_company_name");

// A genuine non-empty override still takes effect (unsaved edits for a test call).
const realOverride = await placeCall({
  leadId: "lead_real", leadPhone: "+919822222222", leadName: "Pratik", tenantId: A, origin: "manual",
  agentConfig: { companyName: "TenWeb Edited" },
} as never);
check("A real override is still honoured", realOverride.ok === true, realOverride.ok ? "" : (realOverride as { reason?: string }).reason);

// A workspace with genuinely no company name is still refused — the guard stays.
// Give it a provider so the call reaches the company-name check (that check
// runs after the provider check).
saveWorkspaceProvider(D, { outbound: { appId: "X-1", appVersion: 1, connectionId: "c", phoneNumber: "+918000000000", agentName: null, agentVariables: [], variableMappings: [] } } as never, "setup");
const trulyNameless = await placeCall({
  leadId: "lead_n", leadPhone: "+919833333333", leadName: "X", tenantId: D, origin: "manual",
} as never);
check("A workspace with no saved company name is still refused", trulyNameless.ok === false && (trulyNameless as { reason?: string }).reason === "missing_company_name", trulyNameless);

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
