// Workspace deletion and the browser-held-state leak. Scratch database.
process.env.SARVAM_API_KEY = "k";
process.env.SARVAM_ORG_ID = "o";
process.env.SARVAM_WORKSPACE_ID = "w";
globalThis.fetch = (async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("workspace");

const db = await import("@/lib/db");
const { saveWorkspaceProvider, providerConfigFor } = await import("@/lib/providers/config");
const { hashSessionToken } = await import("@/lib/auth/sessions");
const workspaceRoute = await import("@/app/api/account/workspace/route");
const agentConfigRoute = await import("@/app/api/agent-config/route");
const { NextRequest } = await import("C:/Dialo AI/node_modules/next/server.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const now = new Date().toISOString();
const A = "ws_keep", B = "ws_remove";

const seed = (tenantId: string, name: string, company: string, email: string, token: string, role: "owner" | "member" = "owner") => {
  db.saveTenant({ id: tenantId, name, createdAt: now });
  db.saveUser({ id: `user_${tenantId}`, tenantId, email, name, passwordHash: "x", role, createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0 });
  db.saveSession({ id: `s_${tenantId}`, tokenHash: hashSessionToken(token), userId: `user_${tenantId}`, tenantId, createdAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), lastSeenAt: now, client: "test" });
  db.grantMembership({ userId: `user_${tenantId}`, tenantId, role });
  db.saveAgentConfig(tenantId, { companyName: company, productName: `${company} product` });
  saveWorkspaceProvider(tenantId, { outbound: { appId: `agent-${tenantId}`, appVersion: 1, connectionId: "c", phoneNumber: "+918000000000", agentName: "A", agentVariables: [] } }, "test");
  db.saveLead({ id: `lead_${tenantId}`, tenantId, name: "Someone", phone: "+919800000001", callingDate: "", callingTime: "", timezone: "Asia/Kolkata", createdAt: now, status: "completed", suppressed: false } as never);
  db.saveCallRecord({ id: `call_${tenantId}`, tenantId, leadId: `lead_${tenantId}`, lead: db.getLead(`lead_${tenantId}`), provider: "sarvam", status: "connected", requestedAt: now, startedAt: now, endedAt: now, duration: 30, attempts: 1, providerAttemptId: `att_${tenantId}`, providerInteractionId: `20261009/${tenantId}-10:00:00-abcd`, humanHandoffStatus: "none", aiSummary: "A call." } as never);
  db.saveCustomerProfile({ id: `cust_${tenantId}`, tenantId, phoneNational: "9800000001", phoneE164: "+919800000001", names: ["Someone"], identityAmbiguous: false, leadIds: [`lead_${tenantId}`], recentSummaries: [], createdAt: now, updatedAt: now } as never);
  db.saveMemoryItems([{ id: `mem_${tenantId}`, tenantId, customerId: `cust_${tenantId}`, kind: "fact", text: `${company} secret`, confidence: 1, firstSeenAt: now, lastSeenAt: now, sourceCallIds: [], forgotten: false } as never]);
  return { authorization: `Bearer ${token}` };
};

const authA = seed(A, "Keep Co", "KeepCo", "keep@x.test", "token-keep-00000000000000000000");
const authB = seed(B, "Remove Co", "RemoveCo", "remove@x.test", "token-remove-0000000000000000");

const del = (headers: Record<string, string>, body: unknown) =>
  workspaceRoute.DELETE(new NextRequest("http://localhost/api/account/workspace", { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) }) as never);

console.log("\n=== Safeguards ===");
check("A wrong name is refused", (await del(authB, { confirmName: "wrong" })).status === 400 && Boolean(db.getTenant(B)));
check("No name at all is refused", (await del(authB, {})).status === 400 && Boolean(db.getTenant(B)));

db.saveInboundSettings({ ...((await import("@/lib/inbound/types")).defaultInboundSettings(B, "Asia/Kolkata")), enabled: true, deploymentId: "dep-live" });
const whileLive = await del(authB, { confirmName: "Remove Co" });
check("A workspace with inbound still on is refused", whileLive.status === 409 && Boolean(db.getTenant(B)), whileLive.status);
db.saveInboundSettings({ ...db.getInboundSettings(B)!, enabled: false });

db.saveUser({ ...db.getUsersForTenant(B)[0], role: "member" });
check("A member cannot delete the workspace", (await del(authB, { confirmName: "Remove Co" })).status === 403 && Boolean(db.getTenant(B)));
db.saveUser({ ...db.getUsersForTenant(B)[0], role: "owner" });

console.log("\n=== Deletion ===");
const res = await del(authB, { confirmName: "Remove Co" });
const body = await res.json();
check("The workspace is deleted", res.status === 200 && !db.getTenant(B), res.status);
check("Its leads, calls, customers and memory go with it",
  db.getLeads().every((l) => l.tenantId !== B) &&
  db.getCallRecords().every((r) => r.tenantId !== B) &&
  db.getCustomerProfiles(B).length === 0 &&
  db.getMemoryItems(B, `cust_${B}`).length === 0,
  body.counts);
check("Its provider configuration and profile go too", providerConfigFor(B) === null && Object.keys(db.getAgentConfig(B)).length === 0);
check("Its accounts and sessions go too", db.getUsersForTenant(B).length === 0);
check("The session cookie is cleared", (res.headers.get("set-cookie") ?? "").includes("Max-Age=0"));
check("It reports what it removed", body.counts?.leads === 1 && body.counts?.callRecords === 1 && body.counts?.customers === 1, body.counts);

console.log("\n=== The other workspace is untouched ===");
check("Its tenant, leads and calls remain", Boolean(db.getTenant(A)) && db.getLeads().some((l) => l.tenantId === A) && db.getCallRecords().some((r) => r.tenantId === A));
check("Its company profile remains", db.getAgentConfig(A).companyName === "KeepCo");
check("Its provider configuration remains", providerConfigFor(A)?.outbound?.appId === `agent-${A}`);
check("Its memory remains", db.getMemoryItems(A, `cust_${A}`).length === 1);
check("Its user can still sign in", db.getUsersForTenant(A).length === 1);

console.log("\n=== A new workspace starts blank ===");
const C = "ws_new";
db.saveTenant({ id: C, name: "Brand New", createdAt: now });
db.saveUser({ id: "user_c", tenantId: C, email: "c@x.test", name: "C", passwordHash: "x", role: "owner", createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0 });
db.saveSession({ id: "s_c", tokenHash: hashSessionToken("token-c-0000000000000000000000"), userId: "user_c", tenantId: C, createdAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), lastSeenAt: now, client: "test" });
db.grantMembership({ userId: "user_c", tenantId: C, role: "owner" });
const authC = { authorization: "Bearer token-c-0000000000000000000000" };
const configC = await (await agentConfigRoute.GET(new NextRequest("http://localhost/api/agent-config", { headers: authC }) as never)).json();
check("Its agent configuration is empty, not the other workspace's", !configC.agentConfig.companyName && !configC.agentConfig.productName, configC.agentConfig);
check("Nothing of KeepCo appears in it", !JSON.stringify(configC).includes("KeepCo"));

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
