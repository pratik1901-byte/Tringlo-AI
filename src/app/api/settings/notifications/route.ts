// ============================================================
// /api/settings/notifications
// ============================================================
//
// What a workspace wants to be emailed about, held on the server.
//
// These toggles used to live only in the browser's localStorage, which meant
// the server — the only thing that can send an email — never knew they were
// on. They are per workspace, authenticated, and scoped to the caller's
// tenant.
//
// POST sends a test email, so delivery can be confirmed without waiting for
// an interested lead or for 7pm.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { getNotificationSettings, saveNotificationSettings } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail/mailer";
import { SUMMARY_HOUR, recipientFor, sendTestEmail } from "@/lib/notifications";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

function view(tenantId: string) {
  const settings = getNotificationSettings(tenantId);
  return {
    emailAlerts: settings.emailAlerts,
    dailySummary: settings.dailySummary,
    // The explicit address, if one was set; the effective one is reported
    // separately so the page can say where mail will actually go.
    recipient: settings.recipient,
    effectiveRecipient: recipientFor(tenantId),
    mailConfigured: isMailConfigured(),
    summaryHour: SUMMARY_HOUR,
  };
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json(view(auth.tenantId), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  let body: { emailAlerts?: unknown; dailySummary?: unknown; recipient?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_body", message: "Expected a JSON body." } }, { status: 400 });
  }

  const updates: Parameters<typeof saveNotificationSettings>[1] = {};
  if (typeof body.emailAlerts === "boolean") updates.emailAlerts = body.emailAlerts;
  if (typeof body.dailySummary === "boolean") updates.dailySummary = body.dailySummary;

  if (body.recipient !== undefined) {
    const recipient = typeof body.recipient === "string" ? body.recipient.trim().toLowerCase() : "";
    if (recipient && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return NextResponse.json(
        { error: { code: "invalid_email", message: "That does not look like an email address." } },
        { status: 400 }
      );
    }
    // Blank means "use the account's own email".
    updates.recipient = recipient || null;
  }

  saveNotificationSettings(auth.tenantId, updates);
  return NextResponse.json(view(auth.tenantId), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // A test button is still a way to send mail; keep it from being a way to spam.
  const limit = rateLimit(clientKey(request, "notify:test"), 3, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "A few test emails have just gone out. Try again in a few minutes." } },
      { status: 429 }
    );
  }

  if (!isMailConfigured()) {
    return NextResponse.json(
      { error: { code: "mail_not_configured", message: "Email is not set up on this server." } },
      { status: 503 }
    );
  }

  const result = await sendTestEmail(auth.tenantId);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "mail_failed", message: result.reason ?? "Could not send the test email." } },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, to: result.to }, { headers: { "Cache-Control": "no-store" } });
}
