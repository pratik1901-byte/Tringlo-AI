// ============================================================
// Tringlo AI — Request Authentication & Tenant Scoping
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
  findMembership,
  findSessionByTokenHash,
  getTenant,
  getUser,
  membershipsForUser,
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

export type AuthFailure =
  | "no_token"
  | "invalid_session"
  | "expired_session"
  | "unknown_user"
  /** Signed in, but no workspace is open — the client shows the selector. */
  | "no_workspace";

export interface AuthSuccess {
  ok: true;
  user: User;
  session: Session;
  /**
   * The workspace this request acts on: the one open on the session, checked
   * against a live membership on every request. Never taken from the client,
   * and never defaulted to "the user's own" workspace.
   */
  tenantId: string;
  /** The caller's role in that workspace. */
  role: "owner" | "admin" | "member";
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
export interface AccountAuthSuccess {
  ok: true;
  user: User;
  session: Session;
}
export type AccountAuthResult = AccountAuthSuccess | AuthRejection;

/**
 * Authenticates the account, without requiring a workspace to be open.
 *
 * This is for the handful of places that exist *before* a workspace is
 * chosen — listing the workspaces someone may open, and opening one. Every
 * other protected route wants `requireAuth`, which also establishes whose
 * data the request may touch.
 */
export async function requireAuthAccount(request: Request): Promise<AccountAuthResult> {
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

  return { ok: true, user, session };
}

/**
 * Authenticates the request and establishes which workspace it acts on.
 *
 * Both halves must hold: a valid session, and a live membership in the
 * workspace that session has open.
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const account = await requireAuthAccount(request);
  if (!account.ok) return account;
  const { user, session } = account;

  // Which workspace this request acts on.
  //
  // The session carries it, but the session is not the authority: the grant
  // is. A session pointing at a workspace the account no longer belongs to
  // gets nothing — there is deliberately no fall back to a "default" or to the
  // workspace on the user record, because either would hand over data the
  // account may no longer be allowed to see.
  const open = session.tenantId ? findMembership(user.id, session.tenantId) : undefined;
  if (open) {
    return { ok: true, user, session, tenantId: open.tenantId, role: open.role };
  }

  // Nothing open, or what was open is no longer theirs.
  //
  // Even one workspace is chosen rather than assumed: opening it here would
  // skip the selector, and someone with two companies must never find
  // themselves already inside one of them without having said which.
  const available = membershipsForUser(user.id);

  return unauthorized(
    "no_workspace",
    available.length === 0
      ? "This account has no workspace yet."
      : "Choose a workspace to continue."
  );
}

/** Projects a stored user into the only shape the client may see. */
export function toPublicUser(user: User, activeTenantId?: string): PublicUser {
  // Which workspace is *open*, not which one the account was created in. With
  // one account able to hold several, those are no longer the same thing, and
  // showing the wrong one is how someone edits the wrong company's settings.
  const tenantId = activeTenantId || user.tenantId;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId,
    tenantName: getTenant(tenantId)?.name ?? "",
  };
}

/**
 * Filters a list of tenant-owned records to the caller's workspace.
 *
 * A record with no `tenantId` belongs to no workspace and is returned to
 * none. There is deliberately no fallback to the original workspace: a row
 * that loses its workspace is a bug to find, not data to hand to whoever
 * happens to be first.
 */
export function scopeToTenant<T extends { tenantId?: string | null }>(
  rows: T[],
  tenantId: string
): T[] {
  return rows.filter((row) => Boolean(row.tenantId) && row.tenantId === tenantId);
}

/** True when one record may be read or written by this workspace. */
export function ownedByTenant(
  row: { tenantId?: string | null } | null | undefined,
  tenantId: string
): boolean {
  return Boolean(row?.tenantId) && row!.tenantId === tenantId;
}

/** 404 rather than 403 for another tenant's record: existence is not leaked. */
export function notFound(message = "Not found."): NextResponse {
  return NextResponse.json({ error: { code: "not_found", message } }, { status: 404 });
}
