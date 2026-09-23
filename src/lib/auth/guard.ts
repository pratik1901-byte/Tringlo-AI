// ============================================================
// Dialo AI — Request Authentication & Tenant Scoping
// ============================================================
//
// One entry point for protected routes. `requireAuth` either returns the caller
// or returns a Response to send back, so a route cannot accidentally continue
// after a failed check:
//
//   const auth = await requireAuth(request);
//   if (!auth.ok) return auth.response;
//   // auth.user and auth.tenantId are now trustworthy
//
// Tenant scoping lives here too. Every protected route filters by
// `auth.tenantId`, so one business cannot read another's leads, calls,
// transcripts or follow-ups even by guessing an id.
// ============================================================

import { NextResponse } from "next/server";

import {
  deleteSession,
  findSessionByTokenHash,
  getTenant,
  getUser,
  touchSession,
} from "@/lib/db";
import type { PublicUser, Session, User } from "@/lib/types";
import {
  SESSION_TOUCH_INTERVAL_MS,
  SHORT_SESSION_TTL_MS,
  extractSessionToken,
  hashSessionToken,
  isSessionExpired,
  sessionExpiry,
} from "./sessions";

export type AuthFailure = "no_token" | "invalid_session" | "expired_session" | "unknown_user";

export interface AuthSuccess {
  ok: true;
  user: User;
  session: Session;
  tenantId: string;
}

export interface AuthRejection {
  ok: false;
  reason: AuthFailure;
  response: NextResponse;
}

export type AuthResult = AuthSuccess | AuthRejection;

/**
 * 401 with a stable machine-readable code.
 *
 * The client distinguishes "you were never signed in" from "your session ran
 * out" so it can show the right thing: a login screen in the first case, a
 * "signed out, please sign in again" notice in the second.
 */
function unauthorized(reason: AuthFailure, message: string): AuthRejection {
  return {
    ok: false,
    reason,
    response: NextResponse.json(
      { error: { code: reason, message } },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    ),
  };
}

/**
 * Authenticates a request from either the session cookie or a bearer token.
 *
 * An expired session is deleted as it is found, so a client that keeps
 * presenting it stops accumulating dead rows.
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const token = extractSessionToken(request);
  if (!token) {
    return unauthorized("no_token", "Sign in to continue.");
  }

  const tokenHash = hashSessionToken(token);
  const session = findSessionByTokenHash(tokenHash);
  if (!session) {
    return unauthorized("invalid_session", "That session is no longer valid.");
  }

  if (isSessionExpired(session.expiresAt)) {
    deleteSession(tokenHash);
    return unauthorized("expired_session", "Your session has expired. Sign in again.");
  }

  const user = getUser(session.userId);
  if (!user) {
    // The account was removed while a session was still live.
    deleteSession(tokenHash);
    return unauthorized("unknown_user", "That account no longer exists.");
  }

  // Sliding expiry: someone using the app daily is never logged out, while an
  // abandoned session still dies thirty days after its last use. Written at
  // most once every few minutes so this does not become a write per request.
  const now = Date.now();
  if (now - new Date(session.lastSeenAt).getTime() > SESSION_TOUCH_INTERVAL_MS) {
    // Extended by the length this session was issued with, so an unremembered
    // session stays short-lived instead of being quietly promoted to 30 days
    // by the act of using it.
    const issuedFor =
      new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime();
    const remembered = issuedFor > SHORT_SESSION_TTL_MS * 2;
    touchSession(session.id, new Date(now).toISOString(), sessionExpiry(now, remembered));
  }

  return { ok: true, user, session, tenantId: user.tenantId };
}

/** Projects a stored user into the only shape the client may see. */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: getTenant(user.tenantId)?.name ?? "",
  };
}

/**
 * Filters a list of tenant-owned records to the caller's tenant.
 *
 * Records written before tenancy existed carry no `tenantId`. Those belong to
 * the original single tenant, so they are visible to it and to nobody else —
 * silently hiding a business's own history would look like data loss.
 */
export function scopeToTenant<T extends { tenantId?: string | null }>(
  rows: T[],
  tenantId: string,
  legacyTenantId: string | null
): T[] {
  return rows.filter((row) => {
    if (row.tenantId) return row.tenantId === tenantId;
    return legacyTenantId !== null && tenantId === legacyTenantId;
  });
}

/** True when one record may be read or written by this tenant. */
export function ownedByTenant(
  row: { tenantId?: string | null } | null | undefined,
  tenantId: string,
  legacyTenantId: string | null
): boolean {
  if (!row) return false;
  if (row.tenantId) return row.tenantId === tenantId;
  return legacyTenantId !== null && tenantId === legacyTenantId;
}

/** 404 rather than 403 for another tenant's record: existence is not leaked. */
export function notFound(message = "Not found."): NextResponse {
  return NextResponse.json({ error: { code: "not_found", message } }, { status: 404 });
}
