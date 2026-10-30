// ============================================================
// POST /api/account/email/confirm
// ============================================================
//
// Finishes a change of sign-in email with the code sent to the new address.
//
// Same rules as every Tringlo code: ten minutes, five tries, one use. The old
// address is told afterwards, so a change the owner did not make does not
// pass silently.
// ============================================================

import { NextResponse } from "next/server";

import { OTP_MAX_ATTEMPTS, normaliseOtp, otpMatches } from "@/lib/auth/otp";
import { requireAuth, toPublicUser } from "@/lib/auth/guard";
import {
  findUserByEmail,
  getCallingWindow,
  getOpenEmailChange,
  updateEmailChange,
  updateUser,
} from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mail/mailer";
import { accountChangedEmail } from "@/lib/mail/templates";
import { rateLimit } from "@/lib/security/rate-limit";

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

const INVALID = "That code is not valid or has expired. Request a new one.";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(`account:email-confirm:${auth.user.id}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const code = normaliseOtp(body.code);
  if (!code) return fail(400, "invalid_code", "Enter the six-digit code from the email.");

  const change = getOpenEmailChange(auth.user.id);
  if (!change) return fail(400, "invalid_code", INVALID);

  const now = Date.now();
  if (new Date(change.expiresAt).getTime() <= now) {
    updateEmailChange(change.id, { closedAt: new Date(now).toISOString() });
    return fail(400, "invalid_code", INVALID);
  }

  const attempts = change.attempts + 1;
  if (!otpMatches(code, change.salt, change.codeHash)) {
    const exhausted = attempts >= OTP_MAX_ATTEMPTS;
    updateEmailChange(change.id, {
      attempts,
      closedAt: exhausted ? new Date(now).toISOString() : null,
    });
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

  // Closed first, so the code cannot be replayed by a racing request.
  updateEmailChange(change.id, { attempts, closedAt: new Date(now).toISOString() });

  // Someone may have registered the address in the ten minutes since.
  const holder = findUserByEmail(change.newEmail);
  if (holder && holder.id !== auth.user.id) {
    return fail(409, "email_taken", "Another account started using that email. Choose a different one.");
  }

  const oldEmail = auth.user.email;
  const updated = updateUser(auth.user.id, { email: change.newEmail }) ?? auth.user;

  console.log(`ACCOUNT_EMAIL_CHANGED user=${auth.user.id}`);

  if (isMailConfigured()) {
    const notice = accountChangedEmail({
      name: auth.user.name || null,
      change: "email",
      oldEmail,
      newEmail: change.newEmail,
      at: new Date(now).toISOString(),
      timeZone: getCallingWindow(auth.tenantId).timezone || "Asia/Kolkata",
    });
    void sendMail({ to: oldEmail, ...notice }).catch(() => undefined);
  }

  return NextResponse.json(
    { ok: true, user: toPublicUser(updated, auth.tenantId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
