// ============================================================
// Dialo AI — Rate Limiting
// ============================================================
// A fixed-window counter held in process memory.
//
// Deliberately simple: it protects a single instance from a burst of malformed
// or abusive requests, which is what a public webhook on a tunnel actually faces.
// It is not a distributed limiter — behind more than one instance this would need
// to move to shared storage, and the health endpoint says so rather than
// implying a guarantee that is not there.
// ============================================================

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Keeps the map from growing without bound on a long-lived process. */
function sweep(now: number) {
  if (windows.size < 5000) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets, for a Retry-After header. */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count++;
  const allowed = existing.count <= limit;

  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfter: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Best-effort client identity.
 *
 * Behind Cloudflare the originating address arrives in a forwarding header; the
 * socket address would otherwise be the tunnel's, which would rate-limit every
 * caller as one.
 */
export function clientKey(request: Request, scope: string): string {
  const headers = request.headers;
  const forwarded =
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown";

  return `${scope}:${forwarded}`;
}
