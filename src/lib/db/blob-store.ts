// ============================================================
// Tringlo AI — external blob persistence (free-tier deploys)
// ============================================================
//
// The database is one JSON blob. On a host with no persistent disk (e.g. a
// Render free web service), the local file is wiped on every restart, so the
// blob is mirrored to a free, persistent key-value store over HTTP instead.
//
// This is OFF by default: with no store configured, the app uses the local file
// exactly as before, so development and tests are unchanged. It is enabled only
// when a store's REST URL and token are present in the environment. The REST
// command protocol here is Upstash Redis / Vercel KV compatible (both are the
// same wire format), so either free account works without a driver dependency.
//
// Reads never go over the network at request time: the blob is loaded once at
// boot into the in-memory cache, and every write flushes the whole blob back,
// coalescing rapid writes into the latest state.
// ============================================================

const KEY = (process.env.TRINGLO_DB_BLOB_KEY || "tringlo:db").trim();

function restUrl(): string {
  return (process.env.TRINGLO_DB_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
}
function restToken(): string {
  return (process.env.TRINGLO_DB_REST_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
}

/** True when an external store is configured; otherwise the local file is used. */
export function isBlobConfigured(): boolean {
  return Boolean(restUrl() && restToken());
}

/** A short, non-secret label for logs — never the token. */
export function blobTarget(): string {
  const url = restUrl();
  return url ? url.replace(/^https?:\/\//, "").split(".")[0] : "none";
}

async function command<T>(args: Array<string>): Promise<T> {
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

/** The stored JSON blob, or null when the store has never been written. */
export async function loadBlob(): Promise<string | null> {
  const value = await command<string | null>(["GET", KEY]);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Replace the stored blob with the current database. */
export async function saveBlob(json: string): Promise<void> {
  await command<string>(["SET", KEY, json]);
}
