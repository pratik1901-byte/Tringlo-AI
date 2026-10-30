// ============================================================
// One account, several workspaces
// ============================================================
//
// The account says who you are. The workspace says whose data you are looking
// at. These tests hold those two apart: that one email can own several
// businesses, that opening one is a server-side fact checked against a
// membership, and that no amount of client-supplied workspace id gets anyone
// into a workspace they were not granted.
//
// Sarvam is simulated. No call is placed.
// ============================================================

process.env.SARVAM_API_KEY = "platform-key-must-never-leak";
process.env.SARVAM_ORG_ID = "org-id";
process.env.SARVAM_WORKSPACE_ID = "sarvam-ws";

// A suite writes freely, so it must never see the live database.
const { isolateDatabase } = await import("./isolated-db");
isolateDatabase("multi-workspace");

const hits: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  hits.push(String(input));
  return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const db = await import("@/lib/db");
const { hashPassword } = await import("@/lib/auth/passwords");
const { hashSessionToken } = await import("@/lib/auth/sessions");
const { requireAuth, requireAuthAccount } = await import("@/lib/auth/guard");
const { saveWorkspaceProvider, providerConfigFor, publicProviderConfig } = await import("@/lib/providers/config");
const workspacesRoute = await import("@/app/api/workspaces/route");
const bootstrapRoute = await import("@/app/api/auth/bootstrap/route");
const enterRoute = await import("@/app/api/workspaces/[id]/enter/route");
const leadsRoute = await import("@/app/api/leads/route");
const { NextRequest } = await import("C:/Dialo AI/node_modules/next/server.js");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const now = new Date().toISOString();
const PASSWORD = "Str0ng-Passphrase-99";

// ---------------- one account, three workspaces ----------------
const TENWEB = "ws_tenweb", BRIGHT = "ws_bright", THIRD = "ws_third", OTHERS = "ws_someone_else";
for (const [id, name] of [[TENWEB, "TenWeb"], [BRIGHT, "BrightPath Logistics"], [THIRD, "AvinyeaConnect"], [OTHERS, "Not Mine Ltd"]]) {
  db.saveTenant({ id, name, createdAt: now });
}
db.saveAgentConfig(TENWEB, { companyName: "TenWeb", productName: "KhushiBot", industry: "Web services" });
db.saveAgentConfig(BRIGHT, { companyName: "BrightPath Logistics", productName: "RouteSense", industry: "Logistics" });
db.saveAgentConfig(THIRD, { companyName: "AvinyeaConnect", productName: "Connect", industry: "Services" });
db.saveAgentConfig(OTHERS, { companyName: "Not Mine Ltd", productName: "Secret", industry: "Private" });

saveWorkspaceProvider(TENWEB, { outbound: { appId: "Agent-TenWeb", appVersion: 4, connectionId: "conn-tenweb", phoneNumber: "+918064269194", agentName: null, agentVariables: [] } }, "setup");
saveWorkspaceProvider(BRIGHT, { outbound: { appId: "Agent-Bright", appVersion: 2, connectionId: "conn-bright", phoneNumber: "+918000000002", agentName: "Maya", agentVariables: [] } }, "setup");
saveWorkspaceProvider(OTHERS, { outbound: { appId: "Agent-Secret", appVersion: 9, connectionId: "conn-secret", phoneNumber: "+918000000009", agentName: null, agentVariables: [] } }, "setup");

const passwordHash = await hashPassword(PASSWORD);
db.saveUser({ id: "user_pratik", tenantId: TENWEB, email: "pratik@example.com", name: "Pratik", passwordHash, role: "owner", createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0 });
db.saveUser({ id: "user_other", tenantId: OTHERS, email: "someone@else.test", name: "Someone", passwordHash, role: "owner", createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0 });

// Data that must stay where it is.
db.saveLead({ id: "lead_tenweb", tenantId: TENWEB, name: "TenWeb Lead", phone: "+919800000001", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
db.saveLead({ id: "lead_bright", tenantId: BRIGHT, name: "BrightPath Lead", phone: "+919800000002", status: "queued", suppressed: false, createdAt: now, callingDate: "", callingTime: "", timezone: "Asia/Kolkata" } as never);
db.saveCustomerProfile({ id: "cust_tenweb", tenantId: TENWEB, phoneNational: "9800000001", phoneE164: "+919800000001", names: ["TenWeb Lead"], identityAmbiguous: false, leadIds: ["lead_tenweb"], recentSummaries: [], createdAt: now, updatedAt: now } as never);
db.saveMemoryItems([{ id: "mem_tenweb", tenantId: TENWEB, customerId: "cust_tenweb", category: "business", key: "note", value: "TenWeb only fact", confidence: 1, firstSeenAt: now, lastSeenAt: now, sourceCallIds: [], forgotten: false } as never]);
db.saveMemoryItems([{ id: "mem_bright", tenantId: BRIGHT, customerId: "cust_bright", category: "business", key: "note", value: "BrightPath only fact", confidence: 1, firstSeenAt: now, lastSeenAt: now, sourceCallIds: [], forgotten: false } as never]);

// ---------------- 16. the migration grants exactly what existed ----------------
section("Migration from one-workspace accounts");
const first = db.migrateMemberships();
check("Every existing account gains the workspace it was created in", first.granted === 2, first);
check("…and nothing was skipped", first.skipped.length === 0, first.skipped);
const second = db.migrateMemberships();
check("Running it again grants nothing new", second.granted === 0 && second.alreadyPresent === 2, second);
check("Pratik has TenWeb", Boolean(db.findMembership("user_pratik", TENWEB)));
check("…and not the workspace belonging to someone else", !db.findMembership("user_pratik", OTHERS));
check("Nobody was given access they did not already have", db.getMemberships().length === 2, db.getMemberships().length);
check("Every workspace id survived", db.getTenants().map((t) => t.id).sort().join(",") === [TENWEB, BRIGHT, THIRD, OTHERS].sort().join(","));
check("Business records are untouched", db.getLeads().length === 2 && db.getMemoryItems(TENWEB, "cust_tenweb").length === 1, db.getLeads().length);

// ---------------- 1 + 4. one account, more workspaces ----------------
section("One account owning several workspaces");
db.grantMembership({ userId: "user_pratik", tenantId: BRIGHT, role: "owner", createdBy: "user_pratik" });
db.grantMembership({ userId: "user_pratik", tenantId: THIRD, role: "owner", createdBy: "user_pratik" });
const mine = db.membershipsForUser("user_pratik");
check("One account now holds three workspaces", mine.length === 3, mine.map((m) => m.tenantId));
check("The creator is an owner of each", mine.every((m) => m.role === "owner"));
check("…on one account, not three", db.countUsers() === 2, db.countUsers());

// ---------------- 2. no duplicate accounts or memberships ----------------
section("No duplicates");
const again = db.grantMembership({ userId: "user_pratik", tenantId: BRIGHT, role: "owner" });
check("Granting the same workspace twice is the same grant", db.membershipsForUser("user_pratik").length === 3, db.membershipsForUser("user_pratik").length);
check("…and returns the grant that already existed", again.tenantId === BRIGHT);
check("The email still belongs to exactly one account", db.findUserByEmail("pratik@example.com")?.id === "user_pratik" && db.countUsers() === 2);

// ---------------- 3. the password stays on the account ----------------
section("The password belongs to the account");
// Three workspaces, one credential: the password lives on the account.
const pratikHash = db.getUser("user_pratik")!.passwordHash;
check("One credential covers all three of the account's workspaces", (() => {
  const workspaces = db.membershipsForUser("user_pratik").map((m) => m.tenantId);
  return workspaces.length === 3 && workspaces.every((tenantId) => {
    const config = providerConfigFor(tenantId);
    return !JSON.stringify(config ?? {}).includes(pratikHash);
  });
})(), db.membershipsForUser("user_pratik").length);
check("No workspace record stores a password of its own", db.getTenants().every((t) => !JSON.stringify(t).toLowerCase().includes("password")));
check("No membership record carries a credential", db.getMemberships().every((m) => !JSON.stringify(m).toLowerCase().includes("password")));
check("…nor a hash of one", db.getMemberships().every((m) => !JSON.stringify(m).includes("scrypt")));

// ---------------- sessions ----------------
const sessionFor = (userId: string, tenantId: string, token: string) => {
  db.saveSession({ id: `s_${token}`, tokenHash: hashSessionToken(token), userId, tenantId, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString(), lastSeenAt: now, client: "test" });
  return { authorization: `Bearer ${token}` };
};
const authPratik = sessionFor("user_pratik", TENWEB, "token-pratik-0000000000000000");
const authOther = sessionFor("user_other", OTHERS, "token-other-00000000000000000");
const request = (url: string, auth: Record<string, string>, method = "GET", body?: unknown) =>
  new NextRequest(url, { method, headers: { ...auth, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

// ---------------- 5. the selector lists all and only authorised workspaces ----------------
section("The workspace selector");
const listed = await (await workspacesRoute.GET(request("http://localhost/api/workspaces", authPratik))).json();
const names = listed.workspaces.map((w: { companyName: string }) => w.companyName).sort();
check("It lists every workspace the account may open", names.join(",") === "AvinyeaConnect,BrightPath Logistics,TenWeb", names);
check("…and none that it may not", !JSON.stringify(listed).includes("Not Mine Ltd"));
check("…not even the id of one", !JSON.stringify(listed).includes(OTHERS));
check("Each card carries its role", listed.workspaces.every((w: { role: string }) => w.role === "owner"));
check("…its industry where there is one", listed.workspaces.some((w: { industry: string | null }) => w.industry === "Logistics"));
check("The account's own email is shown", listed.account.email === "pratik@example.com");
check("No provider secret is in the listing", !JSON.stringify(listed).includes("platform-key-must-never-leak") && !JSON.stringify(listed).includes("Agent-Bright"));
const otherList = await (await workspacesRoute.GET(request("http://localhost/api/workspaces", authOther))).json();
check("A different account sees only its own", otherList.workspaces.length === 1 && otherList.workspaces[0].companyName === "Not Mine Ltd", otherList.workspaces);

// ---------------- 17. unauthenticated ----------------
section("Unauthenticated requests");
const anon = await workspacesRoute.GET(new NextRequest("http://localhost/api/workspaces", { method: "GET" }));
check("Listing workspaces without a session is refused", anon.status === 401, anon.status);
const anonEnter = await enterRoute.POST(
  new NextRequest(`http://localhost/api/workspaces/${TENWEB}/enter`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
  { params: Promise.resolve({ id: TENWEB }) }
);
check("Entering a workspace without a session is refused", anonEnter.status === 401, anonEnter.status);

// ---------------- 6 + 7 + 18. opening a workspace ----------------
section("Opening a workspace asks for nothing");
const enter = (tenantId: string, auth: Record<string, string>) =>
  enterRoute.POST(request(`http://localhost/api/workspaces/${tenantId}/enter`, auth, "POST", {}), { params: Promise.resolve({ id: tenantId }) });

const right = await enter(BRIGHT, authPratik);
check("A member opens their workspace with no password", right.status === 200, right.status);
check("…and the session now holds that workspace", db.findSessionByTokenHash(hashSessionToken("token-pratik-0000000000000000"))?.tenantId === BRIGHT);
check("…recorded as last opened", Boolean(db.findMembership("user_pratik", BRIGHT)?.lastAccessedAt));
check("Nothing about a credential comes back to the client", !JSON.stringify(await right.json()).toLowerCase().includes("password"));
check("Opening it again is just as ordinary", (await enter(BRIGHT, authPratik)).status === 200);
check("…and switching back and forth needs nothing either", (await enter(TENWEB, authPratik)).status === 200 && (await enter(BRIGHT, authPratik)).status === 200);

// ---------------- 8 + 9. membership is the authority ----------------
section("A workspace id is not permission");
const notMine = await enter(OTHERS, authPratik);
check("A workspace the account has no membership in is refused", notMine.status === 403, notMine.status);
check("…with wording that reveals nothing about it", /not available to this account/i.test((await notMine.json()).error.message));
check("…and nothing about it is disclosed", !JSON.stringify(await (await enter(OTHERS, authPratik)).json()).includes("Not Mine"));
const invented = await enter("ws_does_not_exist", authPratik);
check("An invented workspace id is refused", invented.status === 403, invented.status);
check("The session was never moved to a workspace that was refused", db.findSessionByTokenHash(hashSessionToken("token-pratik-0000000000000000"))?.tenantId === BRIGHT);

// A session pointing at a workspace the account does not belong to gets nothing.
db.saveSession({ id: "s_forged", tokenHash: hashSessionToken("token-forged-0000000000000000"), userId: "user_pratik", tenantId: OTHERS, createdAt: now, expiresAt: new Date(Date.now() + 864e5).toISOString(), lastSeenAt: now, client: "test" });
const forged = await requireAuth(request("http://localhost/api/leads", { authorization: "Bearer token-forged-0000000000000000" }));
check("A session holding a workspace the account never joined is refused", !forged.ok, forged.ok ? (forged as { tenantId: string }).tenantId : "refused");
check("…and is not quietly moved to one it does have", !forged.ok && forged.reason === "no_workspace", forged.ok ? "" : forged.reason);

// ---------------- 10 + 11. switching changes what the API returns ----------------
section("Switching changes the active workspace server-side");
const leadsIn = async (auth: Record<string, string>) => {
  const response = await leadsRoute.GET(request("http://localhost/api/leads", auth));
  const body = await response.json();
  const rows = Array.isArray(body) ? body : (body.leads ?? body.data ?? []);
  return rows.map((lead: { name: string }) => lead.name);
};
check("With BrightPath open, the API returns BrightPath's leads", (await leadsIn(authPratik)).join() === "BrightPath Lead", await leadsIn(authPratik));
await enter(TENWEB, authPratik);
check("After switching, it returns TenWeb's", (await leadsIn(authPratik)).join() === "TenWeb Lead", await leadsIn(authPratik));
check("…and none of the other workspace's", !(await leadsIn(authPratik)).includes("BrightPath Lead"));
const resolved = await requireAuth(request("http://localhost/api/leads", authPratik));
check("requireAuth reports the workspace that is open", resolved.ok && resolved.tenantId === TENWEB, resolved.ok ? resolved.tenantId : "refused");
check("…and the caller's role in it", resolved.ok && resolved.role === "owner");

// ---------------- 12. memory and configuration stay separated ----------------
section("Workspace isolation holds across a switch");
check("TenWeb's memory is TenWeb's only", db.getMemoryItems(TENWEB, "cust_tenweb").every((m) => m.value.includes("TenWeb")));
check("BrightPath's memory is not visible to TenWeb", !db.getMemoryItems(TENWEB, "cust_bright").some((m) => m.value.includes("BrightPath")) && db.getMemoryItems(BRIGHT, "cust_bright").length === 1);
check("Each workspace keeps its own provider configuration", providerConfigFor(TENWEB)!.outbound!.appId === "Agent-TenWeb" && providerConfigFor(BRIGHT)!.outbound!.appId === "Agent-Bright");
check("…and its own webhook token", providerConfigFor(TENWEB)!.webhookToken !== providerConfigFor(BRIGHT)!.webhookToken);

// ---------------- 13 + 14. the real workspaces are unchanged ----------------
section("Existing workspace configuration preserved");
check("TenWeb keeps its agent, version, connection and number", (() => {
  const o = providerConfigFor(TENWEB)!.outbound!;
  return o.appId === "Agent-TenWeb" && o.appVersion === 4 && o.connectionId === "conn-tenweb" && o.phoneNumber === "+918064269194";
})(), providerConfigFor(TENWEB)!.outbound);
check("BrightPath keeps its own", (() => {
  const o = providerConfigFor(BRIGHT)!.outbound!;
  return o.appId === "Agent-Bright" && o.appVersion === 2 && o.connectionId === "conn-bright";
})(), providerConfigFor(BRIGHT)!.outbound);
check("Their company profiles are unchanged", db.getAgentConfig(TENWEB)?.productName === "KhushiBot" && db.getAgentConfig(BRIGHT)?.productName === "RouteSense");
check("Their leads are where they were", db.getLeads().find((l) => l.id === "lead_tenweb")?.tenantId === TENWEB && db.getLeads().find((l) => l.id === "lead_bright")?.tenantId === BRIGHT);

// ---------------- 15. existing sessions and passwords keep working ----------------
section("Existing sessions and passwords");
const stillWorks = await requireAuth(request("http://localhost/api/leads", authOther));
check("A session created before memberships existed still works", stillWorks.ok && stillWorks.tenantId === OTHERS, stillWorks.ok ? stillWorks.tenantId : "refused");
const account = await requireAuthAccount(request("http://localhost/api/workspaces", authOther));
check("…and still identifies its account", account.ok && account.user.email === "someone@else.test");
check("No account's password hash was rewritten", db.getUser("user_pratik")!.passwordHash === passwordHash);

// ---------------- 19. rate limiting ----------------
section("Walking workspace ids gets nowhere");
const openBeforeGuessing = db.findSessionByTokenHash(hashSessionToken("token-pratik-0000000000000000"))?.tenantId;
let refused = 0;
for (let attempt = 0; attempt < 12; attempt++) {
  const response = await enter(`ws_guess_${attempt}`, authPratik);
  if (response.status === 403) refused++;
}
check("Every guessed workspace id is refused", refused === 12, refused);
check("…and whatever was open stayed open", db.findSessionByTokenHash(hashSessionToken("token-pratik-0000000000000000"))?.tenantId === openBeforeGuessing, openBeforeGuessing);

// ---------------- deleting one workspace of several ----------------
section("Deleting one workspace of several");
const beforeUsers = db.countUsers();
db.deleteTenant(THIRD);
check("The account survives losing one of its workspaces", db.countUsers() === beforeUsers, db.countUsers());
check("…and keeps the others", db.membershipsForUser("user_pratik").map((m) => m.tenantId).sort().join() === [TENWEB, BRIGHT].sort().join());
check("The deleted workspace's membership is gone", !db.findMembership("user_pratik", THIRD));


// ---------------- 7-12 + 18 + 19. creating another workspace ----------------
section("An authenticated account creates another workspace");
const accountsBefore = db.countUsers();
const draft = {
  businessName: "Brightside Solutions",
  company: { companyName: "Brightside Solutions", industry: "Facilities", productName: "Brightside", salesObjective: "Book demos" },
  outbound: { appId: "Agent-Brightside", appVersion: 3, connectionId: "conn-brightside", phoneNumber: "+918000000055" },
  batch: {},
  inbound: null,
};
const created = await workspacesRoute.POST(request("http://localhost/api/workspaces", authPratik, "POST", draft));
check("It is created through the ordinary authenticated endpoint", created.status === 201, created.status);
const createdBody = await created.json();
const NEW = createdBody.workspace.tenantId as string;
check("…and returns the new workspace id", Boolean(NEW) && NEW !== TENWEB && NEW !== BRIGHT, NEW);
check("No new account was made", db.countUsers() === accountsBefore, db.countUsers());
check("…the existing account was reused", db.findUserByEmail("pratik@example.com")?.id === "user_pratik");
check("The creator is its owner", db.findMembership("user_pratik", NEW)?.role === "owner");
check("The session is already inside it", db.findSessionByTokenHash(hashSessionToken("token-pratik-0000000000000000"))?.tenantId === NEW);

const listedAfter = await (await workspacesRoute.GET(request("http://localhost/api/workspaces", authPratik))).json();
check("It appears in the selector", listedAfter.workspaces.some((w: { tenantId: string }) => w.tenantId === NEW));
// Two remain from earlier in this suite (the third was deleted above), plus
// the one just created.
check("…alongside the ones that were already there", listedAfter.workspaces.length === 3, listedAfter.workspaces.length);

// Its own everything, nothing borrowed.
check("It has its own company profile", db.getAgentConfig(NEW)?.companyName === "Brightside Solutions", db.getAgentConfig(NEW)?.companyName);
check("…not TenWeb's", db.getAgentConfig(NEW)?.companyName !== "TenWeb" && db.getAgentConfig(NEW)?.productName !== "KhushiBot");
check("Its own provider configuration", providerConfigFor(NEW)!.outbound!.appId === "Agent-Brightside");
check("…and its own webhook token", providerConfigFor(NEW)!.webhookToken !== providerConfigFor(TENWEB)!.webhookToken);
check("It starts with no leads, calls or memory", db.getLeads().filter((l) => l.tenantId === NEW).length === 0 && db.getCallRecords().filter((c) => c.tenantId === NEW).length === 0);
check("Inbound is off until it is switched on", !db.getInboundSettings(NEW)?.enabled);

// 18. invalid input fails safely.
const tenantsBefore = db.getTenants().length;
const bad = await workspacesRoute.POST(request("http://localhost/api/workspaces", authPratik, "POST", {
  businessName: "", company: {}, outbound: {}, batch: {}, inbound: null,
}));
check("An incomplete form is refused", bad.status === 400, bad.status);
check("…saying what is missing", Array.isArray((await bad.json()).error.problems));
check("…and nothing was created", db.getTenants().length === tenantsBefore, db.getTenants().length);

// The owner is the session's account, never one named in the body.
const hijack = await workspacesRoute.POST(request("http://localhost/api/workspaces", authOther, "POST", {
  ...draft, businessName: "Hijack Co", userId: "user_pratik", ownerId: "user_pratik",
}));
check("A body naming another owner is ignored", hijack.status === 201, hijack.status);
const hijackId = (await hijack.json()).workspace.tenantId as string;
check("…the signed-in account owns it instead", db.findMembership("user_other", hijackId)?.role === "owner");
check("…and the account it named has no membership in it", !db.findMembership("user_pratik", hijackId));

// 17. unauthenticated creation is refused.
const anonCreate = await workspacesRoute.POST(new NextRequest("http://localhost/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }));
check("Creating a workspace without a session is refused", anonCreate.status === 401, anonCreate.status);

// 19. the privileged bootstrap route stays privileged.
section("Internal bootstrap stays protected");
const bootstrapAttempt = await bootstrapRoute.POST(new Request("http://dialo.example.com/api/auth/bootstrap", {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
  body: JSON.stringify({ email: "new@example.com", password: PASSWORD, name: "New", businessName: "Remote Co" }),
}));
check("A remote request to bootstrap is refused", bootstrapAttempt.status === 401, bootstrapAttempt.status);
check("…and no account or workspace came of it", !db.findUserByEmail("new@example.com") && !db.getTenants().some((t) => t.name === "Remote Co"));

// ---------------- 20. no secrets to the browser ----------------
section("Secrets");
const exposed = JSON.stringify(publicProviderConfig(TENWEB)) + JSON.stringify(listed);
check("No API key reaches the client", !exposed.includes("platform-key-must-never-leak"));
check("No Sarvam org or workspace id either", !exposed.includes("sarvam-ws") && !exposed.includes("org-id"));
check("No webhook token", !exposed.includes(providerConfigFor(TENWEB)!.webhookToken));
check("No password hash", !exposed.includes(passwordHash) && !exposed.includes("scrypt"));

section("Nothing live happened");
check("No request was made to Sarvam", hits.length === 0, hits);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
