// ============================================================
// Dialo AI — Outgoing Email
// ============================================================
//
// One SMTP transport for everything Dialo sends: password-reset codes,
// interested-lead alerts, the daily summary and the test email. The emails
// themselves are built in lib/mail/templates.
//
// Credentials come only from server environment variables. Nothing here is
// ever sent to the browser, and the password is never logged — a failure is
// reported by its SMTP code and message, which do not contain it.
// ============================================================

import nodemailer, { type Transporter } from "nodemailer";

function env(name: string): string {
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

export function isMailConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

declare global {
  var __dialoMailer: Transporter | undefined;
}

/** One transport per process, so connections are pooled rather than reopened per mail. */
function transport(): Transporter {
  if (globalThis.__dialoMailer) return globalThis.__dialoMailer;

  const port = Number(env("SMTP_PORT")) || 465;
  globalThis.__dialoMailer = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Either way the
    // credentials never cross the network in the clear.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: {
      user: env("SMTP_USER"),
      // Gmail displays app passwords in groups of four; the spaces are
      // presentation, not part of the password.
      pass: env("SMTP_PASS").replace(/\s+/g, ""),
    },
    pool: true,
    maxConnections: 2,
  });
  return globalThis.__dialoMailer;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailResult = { ok: true } | { ok: false; reason: string };

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!isMailConfigured()) {
    return { ok: false, reason: "Email is not configured on this server." };
  }

  try {
    const info = await transport().sendMail({
      from: env("MAIL_FROM") || env("SMTP_USER"),
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    // "Accepted" means the SMTP server took it, which is as far as a sender
    // can know. A rejected recipient is a failure worth reporting.
    if (info.rejected && info.rejected.length > 0) {
      return { ok: false, reason: "The mail server rejected the recipient." };
    }

    console.log(`MAIL_SENT subject="${message.subject}"`);
    return { ok: true };
  } catch (error) {
    const err = error as { code?: string; responseCode?: number; message?: string };
    // The code and message identify the problem (bad credentials, blocked
    // port) without echoing anything secret.
    console.error(
      `MAIL_FAILED code=${err.code ?? "?"} smtp=${err.responseCode ?? "?"} ${String(err.message ?? "").slice(0, 160)}`
    );
    return {
      ok: false,
      reason:
        err.code === "EAUTH"
          ? "The mail server refused the credentials. Check SMTP_USER and SMTP_PASS."
          : "Could not send email right now.",
    };
  }
}
