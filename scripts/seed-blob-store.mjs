// ============================================================
// One-time: upload the local database to the external store
// ============================================================
// Run this ONCE, locally, after creating a free Upstash Redis (or Vercel KV)
// database, to copy your current data/database.json into the store so the free
// Render deploy starts with your real workspaces, provider config, doctors and
// appointments — not an empty database.
//
//   TRINGLO_DB_REST_URL="https://xxxx.upstash.io" \
//   TRINGLO_DB_REST_TOKEN="xxxx" \
//   node scripts/seed-blob-store.mjs
//
// Safe to re-run: it overwrites the store's single blob with the local file.
// It never prints the token. It will NOT overwrite a non-empty store unless you
// pass --force, so you cannot accidentally clobber live data.
// ============================================================

import fs from "node:fs";
import path from "node:path";

const url = (process.env.TRINGLO_DB_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
const token = (process.env.TRINGLO_DB_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const key = (process.env.TRINGLO_DB_BLOB_KEY || "tringlo:db").trim();
const force = process.argv.includes("--force");

if (!url || !token) {
  console.error("Set TRINGLO_DB_REST_URL and TRINGLO_DB_REST_TOKEN first.");
  process.exit(1);
}

const dbFile = path.join(process.cwd(), "data", "database.json");
if (!fs.existsSync(dbFile)) {
  console.error(`No local database at ${dbFile} — nothing to upload.`);
  process.exit(1);
}
const blob = fs.readFileSync(dbFile, "utf-8");
// Validate it parses, so a corrupt file is never pushed.
try {
  JSON.parse(blob);
} catch {
  console.error("Local database.json is not valid JSON — aborting.");
  process.exit(1);
}

async function command(args) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`store HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body.result;
}

const existing = await command(["GET", key]);
if (existing && !force) {
  console.error(`The store already has data at "${key}". Re-run with --force to overwrite it.`);
  process.exit(1);
}
await command(["SET", key, blob]);
console.log(`Uploaded ${blob.length} bytes to the store (key "${key}"). The free deploy will now load your data.`);
