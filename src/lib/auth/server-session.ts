// ============================================================
// Server-side session lookup for pages
// ============================================================
//
// API routes authenticate with requireAuth. Pages rendered on the server —
// the public website — only need to know whether the visitor is signed in, so
// a signed-in person can be sent to their workspace before any landing page
// is rendered, with no client-side flash.
//
// Reads the httpOnly session cookie and checks it against the database
// exactly as requireAuth does. Never throws: an unreadable cookie is simply
// "not signed in".
// ============================================================

import { cookies } from "next/headers";

import { findSessionByTokenHash, getUser } from "@/lib/db";
import { SESSION_COOKIE, hashSessionToken, isSessionExpired } from "@/lib/auth/sessions";

export async function isSignedIn(): Promise<boolean> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return false;
    const session = findSessionByTokenHash(hashSessionToken(token));
    if (!session || isSessionExpired(session.expiresAt)) return false;
    return Boolean(getUser(session.userId));
  } catch {
    return false;
  }
}
