// ============================================================
// Tringlo AI — Sessions
// ============================================================
//
// Opaque session tokens, issued on login and checked on every protected
// request.
//
// Why opaque rather than a JWT: sessions must be revocable. A signed JWT stays
// valid until it expires, so "log out everywhere" and "lock this account" are
// not enforceable without a server-side list anyway. Keeping the list is
// simpler than keeping the list *and* the signing key.
//
// Only the SHA-256 of each token is stored. A leaked database therefore yields
// no usable sessions, the same reasoning as for password hashes.
//
// Transport is deliberately two-headed, because one client is a browser and the
// others are phones:
//
//   - Browsers (Flutter Web) get an httpOnly, SameSite cookie, which JavaScript
//     cannot read and XSS therefore cannot steal.
//   - Android and iOS send `Authorization: Bearer <token>` and keep the token in
//     platform secure storage (Keychain / EncryptedSharedPreferences).
//
// Both resolve to the same session row.
// ============================================================

import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "dialo_session";

/**
 * A remembered session outlives a restart of the app, which is the point of
 * persistence.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a session lasts when "remember me" was not ticked.
 *
 * Long enough for a working day, short enough that a shared or public machine
 * does not stay signed in overnight. This is what makes the checkbox mean
 * something rather than decorate the form.
 */
export const SHORT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How stale `lastSeenAt` may get before a request refreshes it.
 *
 * Writing on every request would mean a database write per API call; five
 * minutes is enough resolution to expire idle sessions sensibly.
 */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** 256 bits of entropy — not guessable, and short enough for a header. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf-8").digest("hex");
}

/** Compares two token hashes without leaking their difference through timing. */
export function sessionHashesMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Reads the token from either transport.
 *
 * The header wins when both are present: a mobile client that sends an explicit
 * token means it, and a stale cookie should not silently override it.
 */
export function extractSessionToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim() || null;
  }

  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=").trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/**
 * The Set-Cookie value for a new session.
 *
 * `Secure` is omitted on plain-HTTP localhost only, because a browser silently
 * drops a Secure cookie there and the developer sees a login that appears to
 * succeed and then immediately fails.
 */
export function sessionCookie(
  token: string,
  options: { secure: boolean; remember?: boolean }
): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    // Lax keeps the cookie on top-level navigation back into the app while
    // still refusing it on cross-site POSTs, which is the CSRF case that matters.
    "SameSite=Lax",
    // Without "remember me" the cookie is a session cookie: it carries no
    // Max-Age and the browser drops it when the window closes.
    ...(options.remember === false
      ? []
      : [`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`]),
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** Clears the cookie; Max-Age=0 tells the browser to drop it immediately. */
export function clearedSessionCookie(options: { secure: boolean }): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

/** True when the request arrived over TLS, directly or through the tunnel. */
export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionExpiry(from = Date.now(), remember = true): string {
  return new Date(from + (remember ? SESSION_TTL_MS : SHORT_SESSION_TTL_MS)).toISOString();
}

export function isSessionExpired(expiresAt: string, now = Date.now()): boolean {
  const at = new Date(expiresAt).getTime();
  return !Number.isFinite(at) || at <= now;
}
