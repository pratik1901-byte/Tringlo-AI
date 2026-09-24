// ============================================================
// POST /api/auth/password-reset/confirm
// ============================================================
//
// Exchanges an emailed code for a new password.
//
// A code works once, for ten minutes, and allows five tries before it is
// thrown away. Success signs out every existing session for the account: if
// the reason for resetting was that someone else knew the old password, their
// session must end too.
// ============================================================

import { NextResponse } from "next/server";

import { OTP_MAX_ATTEMPTS, normaliseOtp, otpMatches } from "@/lib/auth/otp";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/passwords";
import {
  deleteSessionsForUser,
  findUserByEmail,
  getOpenPasswordReset,
  updatePasswordReset,
  updateUser,
} from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** One message for every way a code can be wrong, so failures reveal nothing. */
const INVALID = "That code is not valid or has expired. Request a new one.";

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "auth:reset-confirm"), 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  }

  let body: { email?: unknown; code?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = normaliseOtp(body.code);
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !code) return fail(400, "invalid_code", "Enter the six-digit code from the email.");

  // Checked before the code, so a weak password does not burn an attempt.
  const policy = checkPasswordPolicy(password);
  if (!policy.ok) {
    return fail(400, "weak_password", policy.reason ?? "That password is not acceptable.");
  }

  const user = findUserByEmail(email);
  const reset = user ? getOpenPasswordReset(user.id) : undefined;
  if (!user || !reset) return fail(400, "invalid_code", INVALID);

  const now = Date.now();
  if (new Date(reset.expiresAt).getTime() <= now) {
    updatePasswordReset(reset.id, { closedAt: new Date(now).toISOString() });
    return fail(400, "invalid_code", INVALID);
  }

  const attempts = reset.attempts + 1;

  if (!otpMatches(code, reset.salt, reset.codeHash)) {
    const exhausted = attempts >= OTP_MAX_ATTEMPTS;
    updatePasswordReset(reset.id, {
      attempts,
      closedAt: exhausted ? new Date(now).toISOString() : null,
    });
    console.log(`AUTH_RESET_CODE_WRONG user=${user.id} attempts=${attempts}`);
    return fail(
      400,
      exhausted ? "code_exhausted" : "invalid_code",
      exhausted
        ? "Too many wrong codes. Request a new one."
        : `That code is not right. ${OTP_MAX_ATTEMPTS - attempts} ${
            OTP_MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"
          } left.`
    );
  }

  // Closed before the password changes, so the same code cannot be replayed
  // even by a request racing this one.
  updatePasswordReset(reset.id, { attempts, closedAt: new Date(now).toISOString() });

  updateUser(user.id, {
    passwordHash: await hashPassword(password),
    // Being locked out is a common reason to reset in the first place.
    failedAttempts: 0,
    lockedUntil: null,
  });
  const ended = deleteSessionsForUser(user.id);

  console.log(`AUTH_PASSWORD_RESET_BY_CODE user=${user.id} endedSessions=${ended}`);

  return NextResponse.json(
    { ok: true, message: "Password updated. Sign in with the new one." },
    { headers: { "Cache-Control": "no-store" } }
  );
}
