// ============================================================
// Tringlo AI — external blob persistence (free-tier deploys)
// ============================================================
//
// The database is one JSON blob. On a host with no persistent disk (e.g. a
// Render free web service), the local file is wiped on every restart, so the
// blob is mirrored to a free, persistent external store instead. Two backends
// are supported, chosen by environment:
//
//   Neon Postgres  — set DATABASE_URL (a postgres:// connection string). The
//                    blob lives in a single row; reads/writes go over Neon's
//                    serverless HTTP driver, so it works on any host.
//   Upstash / KV   — set TRINGLO_DB_REST_URL + TRINGLO_DB_REST_TOKEN. The blob
//                    is one key, read/written over the Redis-compatible REST API.
//
// This is OFF by default: with neither configured the app uses the local file
// exactly as before, so development and tests are unchanged. Reads never go over
// the network at request time — the blob is loaded once at boot into the
// in-memory cache, and every write flushes the whole blob back, coalescing
// rapid writes into the latest state.
// ============================================================

type Backend = "neon" | "kv" | "none";

const BLOB_KEY = (process.env.TRINGLO_DB_BLOB_KEY || "tringlo:db").trim();

function databaseUrl(): string {
  return (process.env.DATABASE_URL || process.env.TRINGLO_DATABASE_URL || "").trim();
}
function restUrl(): string {
  return (process.env.TRINGLO_DB_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
}
function restToken(): string {
  return (process.env.TRINGLO_DB_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
}

/** Which backend is configured; "none" means the local file is used. */
export function blobBackend(): Backend {
  if (/^postgres(ql)?:\/\//i.test(databaseUrl())) return "neon";
  if (restUrl() && restToken()) return "kv";
  return "none";
}

/** True when an external store is configured; otherwise the local file is used. */
export function isBlobConfigured(): boolean {
  return blobBackend() !== "none";
}

/** A short, non-secret label for logs — never a credential. */
export function blobTarget(): string {
  const backend = blobBackend();
  if (backend === "neon") {
    const host = databaseUrl().replace(/^postgres(ql)?:\/\/[^@]*@/i, "").split("/")[0];
    return `neon:${host.split(".")[0] || "db"}`;
  }
  if (backend === "kv") return `kv:${restUrl().replace(/^https?:\/\//, "").split(".")[0]}`;
  return "none";
}

// ------------------------------------------------------------
// Neon Postgres — a single-row blob table
// ------------------------------------------------------------

type NeonSql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>;
let neonSql: NeonSql | null = null;
let neonReady: Promise<void> | null = null;

async function neon(): Promise<NeonSql> {
  if (!neonSql) {
    const { neon: connect } = await import("@neondatabase/serverless");
    neonSql = connect(databaseUrl()) as unknown as NeonSql;
  }
  if (!neonReady) {
    const sql = neonSql;
    neonReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS tringlo_db (id integer PRIMARY KEY DEFAULT 1, blob text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
    })();
  }
  await neonReady;
  return neonSql;
}

// ------------------------------------------------------------
// Upstash / Vercel KV — one key over REST
// ------------------------------------------------------------

async function kvCommand<T>(args: Array<string>): Promise<T> {
  const res = await fetch(restUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${restToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`blob store HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: string };
  if (body.error) throw new Error(`blob store error: ${body.error}`);
  return body.result as T;
}

// ------------------------------------------------------------
// Public API (backend-agnostic)
// ------------------------------------------------------------

/** The stored JSON blob, or null when the store has never been written. */
export async function loadBlob(): Promise<string | null> {
  if (blobBackend() === "neon") {
    const sql = await neon();
    const rows = await sql`SELECT blob FROM tringlo_db WHERE id = 1`;
    const value = rows[0]?.blob;
    return typeof value === "string" && value.length > 0 ? value : null;
  }
  const value = await kvCommand<string | null>(["GET", BLOB_KEY]);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Replace the stored blob with the current database. */
export async function saveBlob(json: string): Promise<void> {
  if (blobBackend() === "neon") {
    const sql = await neon();
    await sql`INSERT INTO tringlo_db (id, blob, updated_at) VALUES (1, ${json}, now())
              ON CONFLICT (id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()`;
    return;
  }
  await kvCommand<string>(["SET", BLOB_KEY, json]);
}
