// ============================================================
// Dialo AI — Email Notifications
// ============================================================
//
// Two emails, each switched on per workspace in Settings:
//
//   - an alert when a call ends with the lead marked interested;
//   - a daily summary of the day's calls, at 7pm in the calling timezone.
//
// Both are built only from real call data. "Interested" is the same test the
// dashboard counts with (lib/metrics isInterested), so the alert and the
// numbers on screen can never disagree about who was interested.
//
// Neither may fail a call. Every send is best-effort, logged, and caught.
// ============================================================

import { scopeToTenant } from "@/lib/auth/guard";
import {
  getAllNotificationSettings,
  getCallRecords,
  getCallingWindow,
  getFollowUps,
  getLegacyTenantId,
  getNotificationSettings,
  getTenant,
  getUsersForTenant,
  saveNotificationSettings,
  updateCallRecord,
} from "@/lib/db";
import { escapeHtml, isMailConfigured, mailLayout, sendMail } from "@/lib/mail/mailer";
import { isConnected, isInterested } from "@/lib/metrics";
import type { CallRecord } from "@/lib/types";

/** Hour of the day, in the calling timezone, when the daily summary goes out. */
export const SUMMARY_HOUR = 19;

/** Where a workspace's email goes: the address set in Settings, else the owner's login. */
export function recipientFor(tenantId: string): string | null {
  const settings = getNotificationSettings(tenantId);
  if (settings.recipient) return settings.recipient;
  const owner =
    getUsersForTenant(tenantId).find((user) => user.role === "owner") ??
    getUsersForTenant(tenantId)[0];
  return owner?.email ?? null;
}

function tenantOfCall(record: CallRecord): string | null {
  return record.tenantId ?? record.lead?.tenantId ?? getLegacyTenantId();
}

// ------------------------------------------------------------------
// Interested-lead alert
// ------------------------------------------------------------------

/**
 * Emails the workspace when a call ends with the lead marked interested.
 *
 * Sent at most once per call: the call is stamped when the alert goes, so a
 * redelivered webhook does not send it again.
 */
export async function notifyIfInterested(record: CallRecord): Promise<void> {
  try {
    if (!isInterested(record) || record.interestAlertSentAt) return;
    if (!isMailConfigured()) return;

    const tenantId = tenantOfCall(record);
    if (!tenantId) return;

    const settings = getNotificationSettings(tenantId);
    if (!settings.emailAlerts) return;

    const to = recipientFor(tenantId);
    if (!to) return;

    // Stamped before sending, so two deliveries racing each other cannot both
    // send; a failed send is logged rather than retried into a flood.
    updateCallRecord(record.id, { interestAlertSentAt: new Date().toISOString() });

    const name = record.lead?.name || record.lead?.phone || "A lead";
    const rows: Array<[string, string | null | undefined]> = [
      ["Phone", record.lead?.phone],
      ["Interest", record.interestLevel],
      ["What they need", record.customerRequirement],
      ["Next step", record.chosenNextStep ?? record.nextAction],
      ["Callback", record.followUpDate ? `${record.followUpDate} ${record.followUpTime ?? ""}`.trim() : null],
    ];

    const table = rows
      .filter(([, value]) => value && String(value).trim())
      .map(
        ([label, value]) =>
          `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#78716c;vertical-align:top">${escapeHtml(
            label
          )}</td><td style="padding:6px 0;font-size:13px">${escapeHtml(String(value))}</td></tr>`
      )
      .join("");

    const summary = record.aiSummary
      ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6">${escapeHtml(record.aiSummary)}</p>`
      : "";

    const result = await sendMail({
      to,
      subject: `Interested lead: ${name}`,
      text:
        `${name} was marked interested on a call just now.\n\n` +
        rows
          .filter(([, value]) => value && String(value).trim())
          .map(([label, value]) => `${label}: ${value}`)
          .join("\n") +
        (record.aiSummary ? `\n\n${record.aiSummary}` : ""),
      html: mailLayout(
        `${name} is interested`,
        `<p style="margin:0 0 12px;font-size:14px;line-height:1.6">The agent marked this lead interested on a call that just ended.</p>
<table style="border-collapse:collapse">${table}</table>${summary}`
      ),
    });

    console.log(`NOTIFY_INTERESTED call=${record.id} sent=${result.ok}`);
  } catch (error) {
    console.error("NOTIFY_INTERESTED_FAILED", error instanceof Error ? error.message : error);
  }
}

// ------------------------------------------------------------------
// Daily summary
// ------------------------------------------------------------------

/** The date and hour right now in a timezone, e.g. { date: "2026-09-24", hour: 19 }. */
function localNow(timeZone: string, now: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function localDate(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? localNow(timeZone, time).date : null;
}

export interface DailySummary {
  date: string;
  placed: number;
  connected: number;
  notPicked: number;
  busy: number;
  failed: number;
  interested: CallRecord[];
  followUpsDue: number;
}

/** Everything a workspace's calls did on one local date. */
export function buildDailySummary(tenantId: string, date: string, timeZone: string): DailySummary {
  const legacy = getLegacyTenantId();
  const calls = scopeToTenant(getCallRecords(), tenantId, legacy).filter(
    (call) => localDate(call.requestedAt || call.startedAt, timeZone) === date
  );

  const tomorrow = localNow(timeZone, new Date(`${date}T12:00:00Z`).getTime() + 24 * 3600 * 1000).date;
  const followUpsDue = scopeToTenant(getFollowUps(), tenantId, legacy).filter(
    (followUp) =>
      (followUp.status === "scheduled" || followUp.status === "retry_pending") &&
      localDate(followUp.nextAttemptAt ?? followUp.scheduledTime, timeZone) === tomorrow
  ).length;

  return {
    date,
    placed: calls.length,
    connected: calls.filter(isConnected).length,
    notPicked: calls.filter((call) => call.status === "no_answer").length,
    busy: calls.filter((call) => call.status === "busy").length,
    failed: calls.filter((call) => call.status === "failed" || call.status === "provider_error").length,
    interested: calls.filter(isInterested),
    followUpsDue,
  };
}

export async function sendDailySummary(tenantId: string, summary: DailySummary): Promise<boolean> {
  const to = recipientFor(tenantId);
  if (!to) return false;

  const workspace = getTenant(tenantId)?.name ?? "Your workspace";
  const pretty = new Date(`${summary.date}T12:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  const figures: Array<[string, number]> = [
    ["Calls placed", summary.placed],
    ["Connected", summary.connected],
    ["Not picked", summary.notPicked],
    ["Busy / declined", summary.busy],
    ["Call failed", summary.failed],
    ["Interested", summary.interested.length],
    ["Follow-ups due tomorrow", summary.followUpsDue],
  ];

  const table = figures
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 16px 6px 0;font-size:13px;color:#78716c">${escapeHtml(
          label
        )}</td><td style="padding:6px 0;font-size:14px;font-weight:600;text-align:right">${value}</td></tr>`
    )
    .join("");

  const interestedList =
    summary.interested.length > 0
      ? `<p style="margin:20px 0 6px;font-size:13px;font-weight:600">Interested today</p><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">${summary.interested
          .map(
            (call) =>
              `<li>${escapeHtml(call.lead?.name || call.lead?.phone || "Lead")}${
                call.lead?.phone ? ` · ${escapeHtml(call.lead.phone)}` : ""
              }</li>`
          )
          .join("")}</ul>`
      : "";

  const quiet = summary.placed === 0
    ? `<p style="margin:0 0 12px;font-size:14px">No calls were placed today.</p>`
    : "";

  const result = await sendMail({
    to,
    subject: `Dialo daily summary — ${pretty}`,
    text:
      `${workspace} — ${pretty}\n\n` +
      figures.map(([label, value]) => `${label}: ${value}`).join("\n") +
      (summary.interested.length
        ? `\n\nInterested today:\n${summary.interested
            .map((call) => `- ${call.lead?.name || call.lead?.phone}`)
            .join("\n")}`
        : ""),
    html: mailLayout(`${workspace} — ${pretty}`, `${quiet}<table style="border-collapse:collapse;width:100%">${table}</table>${interestedList}`),
  });

  console.log(`NOTIFY_DAILY_SUMMARY tenant=${tenantId} date=${summary.date} sent=${result.ok}`);
  return result.ok;
}

/**
 * Sends each workspace's summary once, at or after 7pm local time.
 *
 * Called from the scheduler tick. The date sent is recorded before sending,
 * so a slow send overlapping the next tick cannot send it twice. A summary
 * missed because the server was down is sent when it comes back that
 * evening, not days later.
 */
export async function runDailySummaries(now = Date.now()): Promise<number> {
  if (!isMailConfigured()) return 0;

  const timeZone = getCallingWindow().timezone || "Asia/Kolkata";
  const { date, hour } = localNow(timeZone, now);
  if (hour < SUMMARY_HOUR) return 0;

  let sent = 0;
  for (const settings of getAllNotificationSettings()) {
    if (!settings.dailySummary || settings.lastSummaryDate === date) continue;

    saveNotificationSettings(settings.tenantId, { lastSummaryDate: date });
    try {
      if (await sendDailySummary(settings.tenantId, buildDailySummary(settings.tenantId, date, timeZone))) {
        sent++;
      }
    } catch (error) {
      console.error("NOTIFY_DAILY_SUMMARY_FAILED", error instanceof Error ? error.message : error);
    }
  }
  return sent;
}

/** For the Settings page's test button: proves delivery without waiting for a real event. */
export async function sendTestEmail(tenantId: string): Promise<{ ok: boolean; to: string | null; reason?: string }> {
  const to = recipientFor(tenantId);
  if (!to) return { ok: false, to: null, reason: "No recipient address is set." };

  const workspace = getTenant(tenantId)?.name ?? "your workspace";
  const result = await sendMail({
    to,
    subject: "Dialo email is working",
    text: `This is a test from ${workspace}. Interested-lead alerts and the daily summary will arrive at this address.`,
    html: mailLayout(
      "Email is working",
      `<p style="margin:0;font-size:14px;line-height:1.6">This is a test from ${escapeHtml(
        workspace
      )}. Interested-lead alerts and the daily summary will arrive at this address.</p>`
    ),
  });
  return result.ok ? { ok: true, to } : { ok: false, to, reason: result.reason };
}
