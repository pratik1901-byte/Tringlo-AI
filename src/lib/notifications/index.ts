// ============================================================
// Tringlo AI — Email Notifications
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
// The markup lives in lib/mail/templates. This module decides when to send
// and gathers the figures; it never builds HTML itself.
//
// Neither email may fail a call. Every send is best-effort, logged, and caught.
// ============================================================

import { scopeToTenant } from "@/lib/auth/guard";
import {
  getAllNotificationSettings,
  getCallRecords,
  getCallingWindow,
  getFollowUps,
  getNotificationSettings,
  getTenant,
  getUsersForTenant,
  saveNotificationSettings,
  updateCallRecord,
} from "@/lib/db";
import { isMailConfigured, sendMail } from "@/lib/mail/mailer";
import { callbackText, dailySummaryEmail, interestedEmail, testEmail } from "@/lib/mail/templates";
import { isConnected, isInterested } from "@/lib/metrics";
import { callDirection, type CallRecord } from "@/lib/types";

/** Hour of the day, in the calling timezone, when the daily summary goes out. */
export const SUMMARY_HOUR = 19;

function timeZone(tenantId: string): string {
  return getCallingWindow(tenantId).timezone || "Asia/Kolkata";
}

/** "7 PM IST" — how the summary time is described to people. */
export function summaryTimeLabel(tenantId: string): string {
  const zone = timeZone(tenantId);
  const abbreviation =
    new Intl.DateTimeFormat("en-IN", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  const hour12 = SUMMARY_HOUR % 12 || 12;
  return `${hour12} ${SUMMARY_HOUR < 12 ? "AM" : "PM"}${abbreviation ? ` ${abbreviation}` : ""}`;
}

/** Where a workspace's email goes: the address set in Settings, else the owner's login. */
export function recipientFor(tenantId: string): string | null {
  const settings = getNotificationSettings(tenantId);
  if (settings.recipient) return settings.recipient;
  const users = getUsersForTenant(tenantId);
  const owner = users.find((user) => user.role === "owner") ?? users[0];
  return owner?.email ?? null;
}

function workspaceName(tenantId: string): string {
  return getTenant(tenantId)?.name ?? "your workspace";
}

function tenantOfCall(record: CallRecord): string | null {
  return record.tenantId ?? record.lead?.tenantId ?? null;
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
    if (!getNotificationSettings(tenantId).emailAlerts) return;

    const to = recipientFor(tenantId);
    if (!to) return;

    // Stamped before sending, so two deliveries racing each other cannot both
    // send; a failed send is logged rather than retried into a flood.
    updateCallRecord(record.id, { interestAlertSentAt: new Date().toISOString() });

    const callback = callbackText(record.followUpDate, record.followUpTime);

    const email = interestedEmail({
      workspace: workspaceName(tenantId),
      name: record.lead?.name || record.lead?.phone || "A lead",
      phone: record.lead?.phone ?? null,
      interestLevel: record.interestLevel ?? null,
      requirement: record.customerRequirement ?? null,
      nextStep: record.chosenNextStep ?? record.nextAction ?? null,
      callback,
      summary: record.aiSummary ?? null,
      endedAt: record.endedAt ?? null,
      durationSeconds: record.duration ?? null,
      timeZone: timeZone(tenantId),
    });

    const result = await sendMail({ to, ...email });
    console.log(`NOTIFY_INTERESTED call=${record.id} sent=${result.ok}`);
  } catch (error) {
    console.error("NOTIFY_INTERESTED_FAILED", error instanceof Error ? error.message : error);
  }
}

// ------------------------------------------------------------------
// Daily summary
// ------------------------------------------------------------------

/** The date and hour right now in a timezone, e.g. { date: "2026-09-24", hour: 19 }. */
function localNow(zone: string, now: number): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

function localDate(iso: string | null | undefined, zone: string): string | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? localNow(zone, time).date : null;
}

/** The calendar day before or after a YYYY-MM-DD date. */
function shiftDate(date: string, days: number): string {
  const noon = new Date(`${date}T12:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(noon).toISOString().slice(0, 10);
}

export interface DailySummary {
  date: string;
  placed: number;
  connected: number;
  notPicked: number;
  busy: number;
  failed: number;
  talkSeconds: number;
  interested: CallRecord[];
  tomorrow: Array<{ name: string; phone: string | null; at: string | null }>;
}

/** Everything a workspace's calls did on one local date. */
export function buildDailySummary(tenantId: string, date: string, zone: string): DailySummary {
  const calls = scopeToTenant(getCallRecords(), tenantId).filter(
    (call) => callDirection(call) === "outbound" && localDate(call.requestedAt || call.startedAt, zone) === date
  );

  const tomorrowDate = shiftDate(date, 1);
  const tomorrow = scopeToTenant(getFollowUps(), tenantId)
    .filter(
      (followUp) =>
        (followUp.status === "scheduled" || followUp.status === "retry_pending") &&
        localDate(followUp.nextAttemptAt ?? followUp.scheduledTime, zone) === tomorrowDate
    )
    .map((followUp) => ({
      name: followUp.lead?.name || followUp.lead?.phone || "Lead",
      phone: followUp.lead?.phone ?? null,
      at: followUp.nextAttemptAt ?? followUp.scheduledTime ?? null,
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const connected = calls.filter(isConnected);

  return {
    date,
    placed: calls.length,
    connected: connected.length,
    notPicked: calls.filter((call) => call.status === "no_answer").length,
    busy: calls.filter((call) => call.status === "busy").length,
    failed: calls.filter((call) => call.status === "failed" || call.status === "provider_error").length,
    talkSeconds: connected.reduce((sum, call) => sum + (call.duration ?? 0), 0),
    interested: calls.filter(isInterested),
    tomorrow,
  };
}

export async function sendDailySummary(tenantId: string, date: string): Promise<boolean> {
  const to = recipientFor(tenantId);
  if (!to) return false;

  const zone = timeZone(tenantId);
  const today = buildDailySummary(tenantId, date, zone);
  const yesterday = buildDailySummary(tenantId, shiftDate(date, -1), zone);

  const email = dailySummaryEmail({
    workspace: workspaceName(tenantId),
    date,
    timeZone: zone,
    summaryTime: summaryTimeLabel(tenantId),
    placed: today.placed,
    connected: today.connected,
    notPicked: today.notPicked,
    busy: today.busy,
    failed: today.failed,
    talkSeconds: today.talkSeconds,
    interested: today.interested.map((call) => ({
      name: call.lead?.name || call.lead?.phone || "Lead",
      phone: call.lead?.phone ?? null,
      nextStep: call.chosenNextStep ?? call.nextAction ?? null,
    })),
    tomorrow: today.tomorrow,
    // A comparison against a day with no calls at all says nothing useful.
    yesterday: yesterday.placed > 0 ? { placed: yesterday.placed, connected: yesterday.connected } : null,
  });

  const result = await sendMail({ to, ...email });
  console.log(`NOTIFY_DAILY_SUMMARY tenant=${tenantId} date=${date} sent=${result.ok}`);
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

  let sent = 0;
  for (const settings of getAllNotificationSettings()) {
    if (!settings.dailySummary) continue;
    // Each workspace's evening arrives at its own time.
    const { date, hour } = localNow(timeZone(settings.tenantId), now);
    if (hour < SUMMARY_HOUR || settings.lastSummaryDate === date) continue;

    saveNotificationSettings(settings.tenantId, { lastSummaryDate: date });
    try {
      if (await sendDailySummary(settings.tenantId, date)) sent++;
    } catch (error) {
      console.error("NOTIFY_DAILY_SUMMARY_FAILED", error instanceof Error ? error.message : error);
    }
  }
  return sent;
}

// ------------------------------------------------------------------
// Test email
// ------------------------------------------------------------------

/** For the Settings page's test button: proves delivery without waiting for a real event. */
export async function sendTestEmail(tenantId: string): Promise<{ ok: boolean; to: string | null; reason?: string }> {
  const to = recipientFor(tenantId);
  if (!to) return { ok: false, to: null, reason: "No recipient address is set." };

  const settings = getNotificationSettings(tenantId);
  const email = testEmail({
    workspace: workspaceName(tenantId),
    recipient: to,
    sentAt: new Date().toISOString(),
    timeZone: timeZone(tenantId),
    emailAlerts: settings.emailAlerts,
    dailySummary: settings.dailySummary,
    summaryTime: summaryTimeLabel(tenantId),
  });

  const result = await sendMail({ to, ...email });
  return result.ok ? { ok: true, to } : { ok: false, to, reason: result.reason };
}
