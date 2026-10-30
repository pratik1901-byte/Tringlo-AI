// ============================================================
// POST /api/account/password
// ============================================================
//
// Changes the signed-in person's password, given the current one.
//
// The current password is required even though the caller is signed in: a
// session left open on a shared machine must not be enough to lock the owner
// out of their own account.
//
// Every other session ends; this one stays, so the person who just changed it
// is not bounced to the sign-in screen. Anyone who forgot the current password
// uses the emailed-code reset instead.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { deleteOtherSessions, getCallingWindow, updateUser } from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mail/mailer";
import { accountChangedEmail } from "@/lib/mail/templates";
import { rateLimit } from "@/lib/security/rate-limit";

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // Per account, so a stolen session cannot be used to guess the password.
  const limit = rateLimit(`account:password:${auth.user.id}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const next = typeof body.newPassword === "string" ? body.newPassword : "";

  if (!current) return fail(400, "missing_current", "Enter your current password.");

  if (!(await verifyPassword(current, auth.user.passwordHash))) {
    console.log(`ACCOUNT_PASSWORD_WRONG user=${auth.user.id}`);
    return fail(400, "wrong_password", "That isn't your current password.");
  }

  const policy = checkPasswordPolicy(next);
  if (!policy.ok) return fail(400, "weak_password", policy.reason ?? "That password is not acceptable.");

  if (await verifyPassword(next, auth.user.passwordHash)) {
    return fail(400, "same_password", "Choose a password different from your current one.");
  }

  updateUser(auth.user.id, { passwordHash: await hashPassword(next) });
  const ended = deleteOtherSessions(auth.user.id, auth.session.id);

  console.log(`ACCOUNT_PASSWORD_CHANGED user=${auth.user.id} endedSessions=${ended}`);

  // A heads-up to the account's inbox, so a change someone else made does not
  // go unnoticed. Best-effort: the change has already happened.
  if (isMailConfigured()) {
    const notice = accountChangedEmail({
      name: auth.user.name || null,
      change: "password",
      at: new Date().toISOString(),
      timeZone: getCallingWindow(auth.tenantId).timezone || "Asia/Kolkata",
    });
    void sendMail({ to: auth.user.email, ...notice }).catch(() => undefined);
  }

  return NextResponse.json(
    {
      ok: true,
      endedSessions: ended,
      message:
        ended > 0
          ? `Password changed. ${ended} other ${ended === 1 ? "device was" : "devices were"} signed out.`
          : "Password changed.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
