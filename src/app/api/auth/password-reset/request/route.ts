// ============================================================
// POST /api/auth/password-reset/request
// ============================================================
//
// Emails a six-digit code to the address on an account.
//
// The response is identical whether or not the address has an account, and
// takes a comparable amount of time. Otherwise this form would answer "is
// this email registered?" for anyone who asked.
//
// Unlike account creation, this works from any network — the LAN, the
// tunnel — because owning the inbox is the proof. Rate limits per IP and per
// address stop it being used to flood someone's mail.
// ============================================================

import { NextResponse } from "next/server";

import { OTP_TTL_MS, generateOtp, hashOtp, newOtpSalt } from "@/lib/auth/otp";
import { findUserByEmail, getCallingWindow, openPasswordReset } from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mail/mailer";
import { otpEmail } from "@/lib/mail/templates";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

const GENERIC = {
  ok: true,
  message: "If an account exists for that address, a code is on its way. It expires in 10 minutes.",
};

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const perIp = rateLimit(clientKey(request, "auth:reset-request"), 5, 15 * 60 * 1000);
  if (!perIp.allowed) {
    return fail(429, "rate_limited", "Too many requests. Try again in a few minutes.");
  }

  if (!isMailConfigured()) {
    // Said plainly: pretending a code was sent when email is not set up would
    // leave someone waiting for a message that cannot arrive.
    return fail(503, "mail_not_configured", "Email is not set up on this server, so codes cannot be sent.");
  }

  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, "invalid_email", "Enter a valid email address.");
  }

  // Per address as well as per IP, so one inbox cannot be flooded from many.
  const perEmail = rateLimit(`auth:reset-email:${email}`, 3, 15 * 60 * 1000);
  if (!perEmail.allowed) {
    return NextResponse.json(GENERIC, { headers: { "Cache-Control": "no-store" } });
  }

  const user = findUserByEmail(email);
  if (!user) {
    // Same answer, and roughly the same wait, as for a real account.
    await new Promise((resolve) => setTimeout(resolve, 350 + Math.random() * 250));
    return NextResponse.json(GENERIC, { headers: { "Cache-Control": "no-store" } });
  }

  const code = generateOtp();
  const salt = newOtpSalt();
  const now = Date.now();

  openPasswordReset({
    id: `reset_${now}_${Math.random().toString(36).slice(2, 8)}`,
    userId: user.id,
    codeHash: hashOtp(code, salt),
    salt,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    attempts: 0,
    closedAt: null,
  });

  const message = otpEmail({
    name: user.name || null,
    email: user.email,
    code,
    expiresInMinutes: Math.round(OTP_TTL_MS / 60_000),
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    timeZone: getCallingWindow().timezone || "Asia/Kolkata",
  });
  const sent = await sendMail({ to: user.email, ...message });

  console.log(`AUTH_RESET_CODE_ISSUED user=${user.id} sent=${sent.ok}`);

  if (!sent.ok) {
    return fail(502, "mail_failed", "The code could not be emailed right now. Try again shortly.");
  }

  return NextResponse.json(GENERIC, { headers: { "Cache-Control": "no-store" } });
}
