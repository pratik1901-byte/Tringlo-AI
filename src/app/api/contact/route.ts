// ============================================================
// POST /api/contact
// ============================================================
//
// The public website's contact form.
//
// The message is emailed to the business's inbox and not stored anywhere in
// the application — the least data needed to answer someone. Consent must be
// given explicitly (the box is never pre-ticked); a hidden honeypot field and
// a per-IP rate limit keep automated submissions out.
//
// Destination: CONTACT_INBOX if set, otherwise the SMTP account itself.
// ============================================================

import { NextResponse } from "next/server";

import { platformTimezone } from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mail/mailer";
import { contactMessageEmail } from "@/lib/mail/templates";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

const TOPICS = ["General question", "Request a workspace", "Privacy or data request", "Something else"] as const;

function fail(status: number, code: string, message: string, field?: string) {
  return NextResponse.json(
    { error: { code, message, field } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** One line of plain text: no control characters, no header-splitting newlines. */
function line(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "contact"), 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return fail(429, "rate_limited", "Too many messages from this connection. Please try again later.");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  // Honeypot: people never see or fill this field. Accept quietly and drop.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const name = line(body.name, 120);
  const email = line(body.email, 254).toLowerCase();
  const company = line(body.company, 160) || null;
  const topic = TOPICS.find((candidate) => candidate === body.topic) ?? TOPICS[0];
  const message = typeof body.message === "string" ? body.message.replace(/\r\n/g, "\n").trim().slice(0, 4000) : "";

  if (!name) return fail(400, "invalid_name", "Please tell us your name.", "name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "invalid_email", "Please enter a valid email address.", "email");
  if (message.length < 10) return fail(400, "invalid_message", "Please write a little more — at least 10 characters.", "message");
  if (body.consent !== true) {
    return fail(400, "consent_required", "Please confirm we may use your details to reply.", "consent");
  }

  if (!isMailConfigured()) {
    return fail(503, "unavailable", "The contact form is unavailable right now. Please email us instead.");
  }

  const to = (process.env.CONTACT_INBOX || process.env.SMTP_USER || "").trim().replace(/^["']|["']$/g, "");
  if (!to) return fail(503, "unavailable", "The contact form is unavailable right now. Please email us instead.");

  const built = contactMessageEmail({
    name,
    email,
    company,
    topic,
    message,
    at: new Date().toISOString(),
    timeZone: platformTimezone(),
  });
  const sent = await sendMail({ to, replyTo: `${name.replace(/["<>]/g, "")} <${email}>`, ...built });

  // Logged without the sender's details: the inbox is the only copy.
  console.log(`CONTACT_MESSAGE topic="${topic}" sent=${sent.ok}`);

  if (!sent.ok) {
    return fail(502, "send_failed", "Your message could not be sent just now. Please try again in a few minutes.");
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
