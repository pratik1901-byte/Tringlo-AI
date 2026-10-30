// ============================================================
// One-time: upload the local database to the external store
// ============================================================
// Run this ONCE, locally, after creating a free Neon Postgres database (or an
// Upstash Redis / Vercel KV store), to copy your current data/database.json
// into the store so the free Render deploy starts with your real workspaces,
// provider config, doctors and appointments — not an empty database.
//
//   Neon:    DATABASE_URL="postgresql://user:pass@host/db" node scripts/seed-blob-store.mjs
//   Upstash: TRINGLO_DB_REST_URL="https://xxxx.upstash.io" TRINGLO_DB_REST_TOKEN="xxxx" node scripts/seed-blob-store.mjs
//
// Safe to re-run with --force. It never prints the credential, and refuses to
// overwrite a non-empty store unless you pass --force.
// ============================================================

import fs from "node:fs";
import path from "node:path";

const databaseUrl = (process.env.DATABASE_URL || process.env.TRINGLO_DATABASE_URL || "").trim();
const restUrl = (process.env.TRINGLO_DB_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
const restToken = (process.env.TRINGLO_DB_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const key = (process.env.TRINGLO_DB_BLOB_KEY || "tringlo:db").trim();
const force = process.argv.includes("--force");
const backend = /^postgres(ql)?:\/\//i.test(databaseUrl) ? "neon" : restUrl && restToken ? "kv" : null;

if (!backend) {
  console.error("Set DATABASE_URL (Neon) or TRINGLO_DB_REST_URL + TRINGLO_DB_REST_TOKEN (Upstash) first.");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "data", "database.json");
if (!fs.existsSync(dbFile)) {
  console.error(`No local database at ${dbFile} — nothing to upload.`);
  process.exit(1);
}
const blob = fs.readFileSync(dbFile, "utf-8");
try {
  JSON.parse(blob);
} catch {
  console.error("Local database.json is not valid JSON — aborting.");
  process.exit(1);
}

async function existingNeon() {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(databaseUrl);
  await sql`CREATE TABLE IF NOT EXISTS tringlo_db (id integer PRIMARY KEY DEFAULT 1, blob text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  const rows = await sql`SELECT blob FROM tringlo_db WHERE id = 1`;
  return { sql, existing: rows[0]?.blob ?? null };
}
async function existingKv() {
  const res = await fetch(restUrl, { method: "POST", headers: { Authorization: `Bearer ${restToken}`, "Content-Type": "application/json" }, body: JSON.stringify(["GET", key]) });
  if (!res.ok) throw new Error(`store HTTP ${res.status}`);
  return (await res.json()).result ?? null;
}

if (backend === "neon") {
  const { sql, existing } = await existingNeon();
  if (existing && !force) {
    console.error("The Neon table already has data. Re-run with --force to overwrite it.");
    process.exit(1);
  }
  await sql`INSERT INTO tringlo_db (id, blob, updated_at) VALUES (1, ${blob}, now())
            ON CONFLICT (id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()`;
  console.log(`Uploaded ${blob.length} bytes to Neon (table tringlo_db). The free deploy will now load your data.`);
} else {
  const existing = await existingKv();
  if (existing && !force) {
    console.error(`The store already has data at "${key}". Re-run with --force to overwrite it.`);
    process.exit(1);
  }
  const res = await fetch(restUrl, { method: "POST", headers: { Authorization: `Bearer ${restToken}`, "Content-Type": "application/json" }, body: JSON.stringify(["SET", key, blob]) });
  if (!res.ok) { console.error(`store HTTP ${res.status}`); process.exit(1); }
  console.log(`Uploaded ${blob.length} bytes to the store (key "${key}"). The free deploy will now load your data.`);
}
