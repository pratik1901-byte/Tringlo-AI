// ============================================================
// POST /api/auth/reset-password
// ============================================================
//
// Sets a new password for an account.
//
// Dialo has no email service, so the usual "we sent you a link" flow cannot be
// built honestly — a form that claims to send an email that never arrives is
// worse than no form at all. Recovery therefore uses the same trust model as
// account creation: it works from a browser on the machine running Dialo, or
// with DIALO_INTERNAL_SECRET, and is refused through the public tunnel.
//
// Resetting a password signs out every existing session for that account. If
// the reason for the reset was that someone else had the old one, leaving their
// sessions alive would defeat the point.
// ============================================================

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { isLocalRequest } from "@/lib/auth/local-request";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/passwords";
import { deleteSessionsForUser, findUserByEmail, updateUser } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "auth:reset"), 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many attempts. Try again later.");
  }

  const expected = (process.env.DIALO_INTERNAL_SECRET || "").trim();
  const provided = (request.headers.get("x-dialo-internal-secret") || "").trim();
  const hasSecret = Boolean(expected) && Boolean(provided) && secretMatches(provided, expected);

  if (!hasSecret && !isLocalRequest(request)) {
    return fail(
      401,
      "unauthorized",
      "For safety, a password can only be reset from the machine running Dialo."
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email) return fail(400, "missing_email", "Enter the account's email address.");

  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    return fail(400, "weak_password", policy.reason ?? "That password is not acceptable.");
  }

  const user = findUserByEmail(email);

  // The caller already has local access, so hiding whether the account exists
  // buys nothing and would leave them guessing why nothing happened.
  if (!user) {
    return fail(404, "no_such_account", "No account with that email address.");
  }

  await hashPassword(password).then((passwordHash) =>
    updateUser(user.id, {
      passwordHash,
      // A reset also clears a lockout: being locked out is a common reason to
      // reset in the first place.
      failedAttempts: 0,
      lockedUntil: null,
    })
  );

  const endedSessions = deleteSessionsForUser(user.id);

  console.log(`AUTH_PASSWORD_RESET user=${user.id} endedSessions=${endedSessions}`);

  return NextResponse.json(
    { ok: true, endedSessions },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
