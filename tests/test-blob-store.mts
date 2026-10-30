// ============================================================
// External blob persistence (free-tier deploys)
// ============================================================
//
// With a store configured, the database is loaded from it at boot and every
// write is flushed back. Sarvam/HTTP is mocked to act as the store; the local
// file path is untouched (its own suites cover it). No network is reached.
// ============================================================

// Configure the store BEFORE importing the db, and mock fetch as a one-key
// Redis-compatible REST endpoint.
process.env.TRINGLO_DB_REST_URL = "https://fake-store.example.io";
process.env.TRINGLO_DB_REST_TOKEN = "fake-token-not-a-secret";

const store: Record<string, string> = {};
let lastAuth: string | null = null;
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  lastAuth = new Headers(init?.headers).get("authorization");
  const [cmd, key, val] = JSON.parse(String(init?.body ?? "[]")) as string[];
  let result: unknown = null;
  if (cmd === "GET") result = store[key] ?? null;
  else if (cmd === "SET") { store[key] = val; result = "OK"; }
  return new Response(JSON.stringify({ result }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

import { isolateDatabase } from "./isolated-db";
isolateDatabase("blob");

const db = await import("@/lib/db");
const blob = await import("@/lib/db/blob-store");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);
const settle = () => new Promise((r) => setTimeout(r, 60));

const now = new Date().toISOString();

// ------------------------------------------------------------
section("Adapter round-trip and auth");

check("the store is detected as configured", blob.isBlobConfigured() === true);
await blob.saveBlob("hello-blob");
check("saveBlob then loadBlob round-trips", (await blob.loadBlob()) === "hello-blob");
check("the request carries a Bearer token, never in the URL", lastAuth === "Bearer fake-token-not-a-secret");
await blob.saveBlob(""); // empty clears
check("an empty/absent value reads back as null", (await blob.loadBlob()) === null);

// ------------------------------------------------------------
section("Backend selection (Neon vs KV)");

check("KV is detected when REST url + token are set", blob.blobBackend() === "kv");
process.env.DATABASE_URL = "postgresql://user:secretpass@ep-cool-forest.us-east-2.aws.neon.tech/neondb";
check("Neon is preferred when DATABASE_URL is a postgres url", blob.blobBackend() === "neon");
check("…and its label names the host without leaking the password", blob.blobTarget().startsWith("neon:") && !blob.blobTarget().includes("secretpass"));
delete process.env.DATABASE_URL;
check("…falls back to KV once DATABASE_URL is removed", blob.blobBackend() === "kv");

// ------------------------------------------------------------
section("Boot loads from the store");

// Pre-seed the store as if a previous run had persisted a workspace.
store["tringlo:db"] = JSON.stringify({ tenants: [{ id: "t_from_store", name: "Restored", createdAt: now }] });
await db.initDatabase();
check("initDatabase loaded the workspace from the store", db.getTenant("t_from_store")?.name === "Restored");
check("…and missing collections are defaulted, not undefined", Array.isArray(db.getLeads()));

// ------------------------------------------------------------
section("Every write is flushed back to the store");

db.saveTenant({ id: "t_new", name: "Fresh Clinic", createdAt: now });
await settle();
const persisted = JSON.parse(store["tringlo:db"]);
check("a new workspace is persisted to the store", persisted.tenants.some((t: { id: string }) => t.id === "t_new"), persisted.tenants?.map((t: any) => t.id));
check("…without losing the restored one", persisted.tenants.some((t: { id: string }) => t.id === "t_from_store"));

db.saveLead({ id: "lead_1", tenantId: "t_new", name: "A Patient", phone: "+919800000001", status: "queued", createdAt: now } as never);
await settle();
check("a subsequent write is also flushed (coalesced)", JSON.parse(store["tringlo:db"]).leads.some((l: { id: string }) => l.id === "lead_1"));

// ------------------------------------------------------------
section("A store failure never throws into the app");

globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
let threw = false;
try {
  db.saveTenant({ id: "t_when_store_down", name: "Still Works", createdAt: now });
  await settle();
} catch {
  threw = true;
}
check("a write still succeeds in memory when the store is down", threw === false && db.getTenant("t_when_store_down")?.name === "Still Works");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
