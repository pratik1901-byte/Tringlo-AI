// ============================================================
// Dialo AI — Email Templates
// ============================================================
//
// The four emails Dialo sends. Each builder returns the subject, the HTML and
// a plain-text version together, so the two bodies are written side by side
// and cannot drift apart — mail clients that show plain text (and spam
// filters, which score its absence) get the same content.
//
// Every figure comes from real call data passed in by the caller. A field
// Dialo has no value for is left out, never shown blank or filled in.
// ============================================================

import {
  BRAND,
  button,
  callout,
  detailsTable,
  divider,
  esc,
  mono,
  outcomeBar,
  paragraph,
  phoneLink,
  pill,
  renderEmail,
  sectionLabel,
  spacer,
  statTiles,
} from "./layout";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

// ------------------------------------------------------------------
// Formatting
// ------------------------------------------------------------------

/** "2:42 PM IST", in the given timezone. */
export function clockTime(iso: string | number | Date, timeZone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .replace(/\s?(am|pm)$/i, (match) => ` ${match.trim().toUpperCase()}`);
  const zone =
    new Intl.DateTimeFormat("en-IN", { timeZone, timeZoneName: "short" })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return zone ? `${time} ${zone}` : time;
}

/** "Thursday, 25 September", for a YYYY-MM-DD date. */
export function longDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return parsed.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * A callback as a person would say it: "Saturday, 26 September at 11:00 AM".
 *
 * Sarvam reports the date and time as separate strings ("2026-09-26",
 * "11:00"). Anything that does not parse is shown as received rather than
 * guessed at.
 */
export function callbackText(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date) ? longDate(date) : date;
  if (!time) return day;
  const match = /^(\d{1,2}):(\d{2})/.exec(time.trim());
  if (!match) return `${day} at ${time}`;
  const hour = Number(match[1]);
  if (hour > 23) return `${day} at ${time}`;
  return `${day} at ${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Thu 25 Sep", for subjects. */
function shortDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "1h 4m", "3m 12s", "45s". Null for nothing to report. */
export function duration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return r ? `${m}m ${r}s` : `${m}m`;
  return `${r}s`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "+3 vs yesterday", "−2 vs yesterday", "Same as yesterday". */
function versusYesterday(today: number, yesterday: number | null): { note: string | null; tone: "positive" | "negative" | "neutral" } {
  if (yesterday === null) return { note: null, tone: "neutral" };
  const change = today - yesterday;
  if (change === 0) return { note: "Same as yesterday", tone: "neutral" };
  return {
    note: `${change > 0 ? "+" : "−"}${Math.abs(change)} vs yesterday`,
    tone: change > 0 ? "positive" : "negative",
  };
}

// ------------------------------------------------------------------
// 1. Password reset code
// ------------------------------------------------------------------

export interface OtpEmailInput {
  name: string | null;
  email: string;
  code: string;
  expiresInMinutes: number;
  expiresAt: string;
  timeZone: string;
}

export function otpEmail(input: OtpEmailInput): BuiltEmail {
  const spaced = `${input.code.slice(0, 3)} ${input.code.slice(3)}`;
  const expiry = clockTime(input.expiresAt, input.timeZone);
  const greeting = input.name ? `Hi ${esc(firstName(input.name))},` : "Hi,";

  const codeBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
<tr><td align="center" class="tile-inner" bgcolor="${BRAND.soft}" style="padding:26px 16px;background:${BRAND.soft};border:1px solid ${BRAND.line};border-radius:12px;">
<p class="t-muted" style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND.muted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Verification code</p>
<p class="t-ink" style="margin:0;padding-left:10px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:10px;line-height:1.2;color:${BRAND.ink};">${esc(spaced)}</p>
<p class="t-muted" style="margin:12px 0 0;font-size:13px;color:${BRAND.muted};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Expires in ${input.expiresInMinutes} minutes${expiry ? ` &middot; at ${esc(expiry)}` : ""}</p>
</td></tr></table>`;

  const html = renderEmail({
    preheader: `Use ${spaced} to reset your Dialo password. It expires in ${input.expiresInMinutes} minutes.`,
    context: "Security",
    eyebrow: "Password reset",
    title: "Your verification code",
    reason: `You're receiving this because a password reset was requested for ${input.email} on Dialo AI.`,
    bodyHtml:
      paragraph(greeting, { spaceAfter: 8 }) +
      paragraph(
        `Enter this code in Dialo to set a new password for <strong class="t-ink" style="color:${BRAND.ink};">${esc(input.email)}</strong>.`,
        { spaceAfter: 24 }
      ) +
      codeBox +
      spacer(24) +
      callout(
        `<strong class="t-ink" style="color:${BRAND.ink};">Didn&rsquo;t ask for this?</strong> Ignore this email &mdash; your password stays the same. Dialo will never ask you for this code by phone, email or chat.`,
        "info"
      ) +
      spacer(20) +
      paragraph(
        "The code works once. Setting a new password signs you out on every other device.",
        { muted: true, size: 13, spaceAfter: 0 }
      ),
  });

  const text = [
    `${input.name ? `Hi ${firstName(input.name)},` : "Hi,"}`,
    "",
    `Your Dialo verification code is: ${spaced}`,
    "",
    `Enter it in Dialo to set a new password for ${input.email}.`,
    `It expires in ${input.expiresInMinutes} minutes${expiry ? ` (at ${expiry})` : ""} and works once.`,
    "",
    "Didn't ask for this? Ignore this email - your password stays the same.",
    "Dialo will never ask you for this code by phone, email or chat.",
    "",
    "-- Dialo AI",
  ].join("\n");

  return { subject: `${spaced} is your Dialo verification code`, html, text };
}

// ------------------------------------------------------------------
// 2. Test email
// ------------------------------------------------------------------

export interface TestEmailInput {
  workspace: string;
  recipient: string;
  sentAt: string;
  timeZone: string;
  emailAlerts: boolean;
  dailySummary: boolean;
  summaryTime: string;
}

export function testEmail(input: TestEmailInput): BuiltEmail {
  const sentDate = new Date(input.sentAt);
  const sentDay = new Intl.DateTimeFormat("en-IN", { timeZone: input.timeZone, weekday: "long", day: "numeric", month: "long" }).format(sentDate);
  const sent = `${sentDay} · ${clockTime(input.sentAt, input.timeZone)}`;

  const html = renderEmail({
    preheader: `Dialo can deliver to ${input.recipient}. Here's what you'll receive at this address.`,
    context: "Test",
    eyebrow: "Email delivery",
    title: "Your email is working",
    workspace: input.workspace,
    reason: `You're receiving this because Send test email was pressed in ${input.workspace}'s notification settings.`,
    bodyHtml:
      paragraph(
        `This is a test from <strong class="t-ink" style="color:${BRAND.ink};">${esc(input.workspace)}</strong>. If you can read it, Dialo can deliver to this address &mdash; no further setup needed.`,
        { spaceAfter: 24 }
      ) +
      sectionLabel("What you'll receive here") +
      detailsTable([
        {
          label: "Interested-lead alerts",
          valueHtml: `${pill(input.emailAlerts ? "On" : "Off", input.emailAlerts ? "on" : "off")}<br><span class="t-muted" style="font-size:13px;color:${BRAND.muted};">${
            input.emailAlerts
              ? "The moment a call ends with the lead marked interested."
              : "Switch on in Settings to hear about interested leads straight away."
          }</span>`,
        },
        {
          label: "Daily summary",
          valueHtml: `${pill(input.dailySummary ? "On" : "Off", input.dailySummary ? "on" : "off")}<br><span class="t-muted" style="font-size:13px;color:${BRAND.muted};">${
            input.dailySummary
              ? `Every day at ${esc(input.summaryTime)}, covering that day's calls.`
              : "Switch on in Settings for a report of each day's calls."
          }</span>`,
        },
      ]) +
      divider(24) +
      sectionLabel("Delivery details") +
      detailsTable([
        { label: "Workspace", valueHtml: esc(input.workspace) },
        { label: "Delivered to", valueHtml: esc(input.recipient) },
        { label: "Sent at", valueHtml: esc(sent) },
      ]),
  });

  const text = [
    "Your Dialo email is working.",
    "",
    `This is a test from ${input.workspace}. If you can read it, Dialo can deliver to ${input.recipient}.`,
    "",
    `Interested-lead alerts: ${input.emailAlerts ? "On" : "Off"}`,
    `Daily summary: ${input.dailySummary ? `On, every day at ${input.summaryTime}` : "Off"}`,
    "",
    `Sent at ${sent}.`,
    "",
    "-- Dialo AI",
  ].join("\n");

  return { subject: "Your Dialo email is working", html, text };
}

// ------------------------------------------------------------------
// 3. Interested-lead alert
// ------------------------------------------------------------------

export interface InterestedEmailInput {
  workspace: string;
  name: string;
  phone: string | null;
  interestLevel: string | null;
  requirement: string | null;
  nextStep: string | null;
  callback: string | null;
  summary: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  timeZone: string;
}

export function interestedEmail(input: InterestedEmailInput): BuiltEmail {
  const ended = input.endedAt ? clockTime(input.endedAt, input.timeZone) : null;
  const length = duration(input.durationSeconds);
  const when = [ended ? `ended at ${ended}` : "just ended", length ? `lasted ${length}` : null]
    .filter(Boolean)
    .join(" and ");
  const interest = input.interestLevel
    ? input.interestLevel.charAt(0).toUpperCase() + input.interestLevel.slice(1).toLowerCase()
    : null;

  const html = renderEmail({
    preheader: input.summary
      ? input.summary.slice(0, 140)
      : `${input.name} was marked interested on a call that ${when}.`,
    context: "Alert",
    eyebrow: "Interested lead",
    title: `${input.name} wants to hear more`,
    workspace: input.workspace,
    reason: `You're receiving this because interested-lead alerts are on for ${input.workspace}. Turn them off in Settings → Notifications.`,
    bodyHtml:
      paragraph(`The agent marked this lead interested on a call that ${esc(when)}.`, { spaceAfter: 22 }) +
      (input.phone ? button(`Call ${firstName(input.name)}`, `tel:${input.phone.replace(/[^\d+]/g, "")}`) + spacer(28) : "") +
      sectionLabel("Call details") +
      detailsTable([
        { label: "Phone", valueHtml: phoneLink(input.phone) },
        { label: "Interest", valueHtml: interest ? pill(interest, "positive") : null },
        { label: "What they need", valueHtml: input.requirement ? esc(input.requirement) : null },
        { label: "Agreed next step", valueHtml: input.nextStep ? esc(input.nextStep) : null },
        { label: "Callback", valueHtml: input.callback ? esc(input.callback) : null },
      ]) +
      (input.summary
        ? spacer(24) +
          sectionLabel("What happened on the call") +
          callout(`<span class="t-ink" style="font-size:14px;color:${BRAND.ink};">${esc(input.summary)}</span>`, "neutral")
        : ""),
  });

  const text = [
    `${input.name} wants to hear more.`,
    "",
    `The agent marked this lead interested on a call that ${when}.`,
    "",
    ...[
      input.phone && `Phone: ${input.phone}`,
      interest && `Interest: ${interest}`,
      input.requirement && `What they need: ${input.requirement}`,
      input.nextStep && `Agreed next step: ${input.nextStep}`,
      input.callback && `Callback: ${input.callback}`,
    ].filter((line): line is string => Boolean(line)),
    ...(input.summary ? ["", "What happened on the call:", input.summary] : []),
    "",
    "-- Dialo AI",
  ].join("\n");

  return { subject: `Interested lead: ${input.name}`, html, text };
}

// ------------------------------------------------------------------
// 4. Daily summary
// ------------------------------------------------------------------

export interface DailyEmailInput {
  workspace: string;
  date: string;
  timeZone: string;
  summaryTime: string;
  placed: number;
  connected: number;
  notPicked: number;
  busy: number;
  failed: number;
  talkSeconds: number;
  interested: Array<{ name: string; phone: string | null; nextStep: string | null }>;
  tomorrow: Array<{ name: string; phone: string | null; at: string | null }>;
  /** Yesterday's figures for comparison, or null when there is no history. */
  yesterday: { placed: number; connected: number } | null;
}

export function dailySummaryEmail(input: DailyEmailInput): BuiltEmail {
  const day = longDate(input.date);
  const quiet = input.placed === 0;
  const connectRate = input.placed > 0 ? Math.round((input.connected / input.placed) * 100) : null;
  const avgTalk = input.connected > 0 ? duration(input.talkSeconds / input.connected) : null;
  const placedDelta = versusYesterday(input.placed, input.yesterday?.placed ?? null);
  const connectedDelta = versusYesterday(input.connected, input.yesterday?.connected ?? null);

  const interestedRows =
    input.interested.length === 0
      ? paragraph("No leads were marked interested today.", { muted: true, size: 14, spaceAfter: 0 })
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${input.interested
          .map(
            (lead, index) => `<tr>
<td class="b-line" valign="top" style="padding:12px 0;${index ? `border-top:1px solid ${BRAND.line};` : ""}">
<p class="t-ink" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;font-weight:600;color:${BRAND.ink};">${esc(lead.name)}</p>
${lead.nextStep ? `<p class="t-muted" style="margin:3px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.5;color:${BRAND.muted};">${esc(lead.nextStep)}</p>` : ""}
</td>
<td class="b-line" align="right" valign="top" style="padding:12px 0 12px 12px;${index ? `border-top:1px solid ${BRAND.line};` : ""}white-space:nowrap;">${phoneLink(lead.phone) ?? ""}</td>
</tr>`
          )
          .join("")}</table>`;

  const tomorrowBlock =
    input.tomorrow.length === 0
      ? paragraph("No callbacks are scheduled for tomorrow.", { muted: true, size: 14, spaceAfter: 0 })
      : paragraph(
          `${plural(input.tomorrow.length, "callback")} scheduled &mdash; Dialo will place ${
            input.tomorrow.length === 1 ? "it" : "them"
          } automatically.`,
          { size: 14, spaceAfter: 10 }
        ) +
        detailsTable(
          input.tomorrow.slice(0, 8).map((item) => ({
            label: item.at ? clockTime(item.at, input.timeZone) : "Time pending",
            valueHtml: `${esc(item.name)}${item.phone ? `&nbsp;&nbsp;${mono(item.phone, 12)}` : ""}`,
          }))
        ) +
        (input.tomorrow.length > 8
          ? paragraph(`and ${input.tomorrow.length - 8} more.`, { muted: true, size: 13, spaceAfter: 0 })
          : "");

  const body = quiet
    ? callout(
        `<strong class="t-ink" style="color:${BRAND.ink};">No calls were placed today.</strong> Nothing to report on outcomes &mdash; tomorrow's schedule is below.`,
        "neutral"
      ) +
      spacer(28) +
      sectionLabel("Tomorrow") +
      tomorrowBlock
    : paragraph(`Here's how today went at <strong class="t-ink" style="color:${BRAND.ink};">${esc(input.workspace)}</strong>.`, {
        spaceAfter: 22,
      }) +
      statTiles([
        { label: "Calls placed", value: String(input.placed), note: placedDelta.note, tone: placedDelta.tone },
        {
          label: "Connected",
          value: String(input.connected),
          note: connectRate !== null ? `${connectRate}% connect rate` : connectedDelta.note,
          tone: "neutral",
        },
        {
          label: "Interested",
          value: String(input.interested.length),
          note: input.connected > 0 ? `of ${plural(input.connected, "conversation")}` : null,
          tone: input.interested.length > 0 ? "positive" : "neutral",
        },
        {
          label: "Talk time",
          value: duration(input.talkSeconds) ?? "0m",
          note: avgTalk ? `${avgTalk} average` : null,
        },
      ]) +
      spacer(30) +
      sectionLabel("How calls ended") +
      outcomeBar([
        { label: "Connected", count: input.connected, color: BRAND.indigo },
        { label: "Not picked", count: input.notPicked, color: BRAND.slate },
        { label: "Busy / declined", count: input.busy, color: BRAND.warning },
        { label: "Call failed", count: input.failed, color: BRAND.negative },
      ]) +
      spacer(30) +
      sectionLabel(`Interested today${input.interested.length ? ` (${input.interested.length})` : ""}`) +
      interestedRows +
      divider(28) +
      sectionLabel("Tomorrow") +
      tomorrowBlock;

  const html = renderEmail({
    preheader: quiet
      ? "No calls were placed today."
      : `${plural(input.placed, "call")} placed, ${input.connected} connected, ${input.interested.length} interested.`,
    context: "Summary",
    eyebrow: "Daily report",
    title: day,
    workspace: input.workspace,
    reason: `You're receiving this because the daily summary is on for ${input.workspace}. It's sent at ${input.summaryTime} each day; turn it off in Settings → Notifications.`,
    bodyHtml: body,
  });

  const text = [
    `Dialo daily report - ${day}`,
    input.workspace,
    "",
    ...(quiet
      ? ["No calls were placed today."]
      : [
          `Calls placed: ${input.placed}${placedDelta.note ? ` (${placedDelta.note})` : ""}`,
          `Connected: ${input.connected}${connectRate !== null ? ` (${connectRate}% connect rate)` : ""}`,
          `Interested: ${input.interested.length}`,
          `Talk time: ${duration(input.talkSeconds) ?? "0m"}${avgTalk ? ` (${avgTalk} average)` : ""}`,
          "",
          "How calls ended:",
          `  Connected ${input.connected} / Not picked ${input.notPicked} / Busy or declined ${input.busy} / Failed ${input.failed}`,
          "",
          "Interested today:",
          ...(input.interested.length
            ? input.interested.map(
                (lead) => `  - ${lead.name}${lead.phone ? ` (${lead.phone})` : ""}${lead.nextStep ? `: ${lead.nextStep}` : ""}`
              )
            : ["  None"]),
        ]),
    "",
    "Tomorrow:",
    ...(input.tomorrow.length
      ? input.tomorrow.map(
          (item) => `  - ${item.at ? clockTime(item.at, input.timeZone) : "Time pending"}  ${item.name}${item.phone ? ` (${item.phone})` : ""}`
        )
      : ["  No callbacks scheduled"]),
    "",
    "-- Dialo AI",
  ].join("\n");

  const subject = quiet
    ? `Daily report · ${shortDate(input.date)} · no calls today`
    : `Daily report · ${shortDate(input.date)} · ${plural(input.placed, "call")}, ${input.interested.length} interested`;

  return { subject, html, text };
}
