// ============================================================
// POST /api/account/email/request
// ============================================================
//
// Starts a change of sign-in email: checks the current password, then emails
// a six-digit code to the NEW address. Nothing changes until that code comes
// back, which proves the person owns the inbox they are moving to — a typo
// cannot lock anyone out, and a stolen session alone cannot hijack the login.
// ============================================================

import { NextResponse } from "next/server";

import { OTP_TTL_MS, generateOtp, hashOtp, newOtpSalt } from "@/lib/auth/otp";
import { requireAuth } from "@/lib/auth/guard";
import { verifyPassword } from "@/lib/auth/passwords";
import { findUserByEmail, getCallingWindow, openEmailChange } from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mail/mailer";
import { otpEmail } from "@/lib/mail/templates";
import { rateLimit } from "@/lib/security/rate-limit";

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(`account:email-request:${auth.user.id}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many requests. Try again in a few minutes.");
  }

  if (!isMailConfigured()) {
    return fail(503, "mail_not_configured", "Email is not set up on this server, so a code cannot be sent.");
  }

  let body: { newEmail?: unknown; currentPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const newEmail = typeof body.newEmail === "string" ? body.newEmail.trim().toLowerCase() : "";
  const password = typeof body.currentPassword === "string" ? body.currentPassword : "";

  if (!EMAIL.test(newEmail) || newEmail.length > 254) {
    return fail(400, "invalid_email", "Enter a valid email address.");
  }
  if (newEmail === auth.user.email.toLowerCase()) {
    return fail(400, "same_email", "That's already your sign-in email.");
  }
  if (!password) return fail(400, "missing_current", "Enter your current password to confirm it's you.");

  if (!(await verifyPassword(password, auth.user.passwordHash))) {
    console.log(`ACCOUNT_EMAIL_WRONG_PASSWORD user=${auth.user.id}`);
    return fail(400, "wrong_password", "That isn't your current password.");
  }

  // The caller has proved who they are, so saying the address is taken leaks
  // nothing they could not learn by trying to sign up with it.
  if (findUserByEmail(newEmail)) {
    return fail(409, "email_taken", "Another account already uses that email.");
  }

  const code = generateOtp();
  const salt = newOtpSalt();
  const now = Date.now();

  openEmailChange({
    id: `emailchg_${now}_${Math.random().toString(36).slice(2, 8)}`,
    userId: auth.user.id,
    newEmail,
    codeHash: hashOtp(code, salt),
    salt,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    attempts: 0,
    closedAt: null,
  });

  const message = otpEmail({
    name: auth.user.name || null,
    email: newEmail,
    purpose: "email_change",
    code,
    expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    timeZone: getCallingWindow(auth.tenantId).timezone || "Asia/Kolkata",
  });
  const sent = await sendMail({ to: newEmail, ...message });

  console.log(`ACCOUNT_EMAIL_CODE_ISSUED user=${auth.user.id} sent=${sent.ok}`);

  if (!sent.ok) {
    return fail(502, "mail_failed", "The code could not be emailed right now. Try again shortly.");
  }

  return NextResponse.json(
    {
      ok: true,
      sentTo: newEmail,
      expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
