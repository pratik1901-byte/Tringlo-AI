// ============================================================
// Dialo AI — Metric Computation
// ============================================================
// Every number the dashboard and analytics pages display is computed here from
// stored call records. There are no targets, baselines or "vs last month" deltas
// that are not derived from two real periods of data — a comparison with nothing
// to compare against returns null and renders as an em dash.
// ============================================================

import type { CallRecord, FollowUp, Lead } from "@/lib/types";

const DAY_MS = 86_400_000;

/** Mirrors RESULT_TIMEOUT_MS in lib/format: how long a webhook may take before we give up. */
const RESULT_TIMEOUT_MS = 15 * 60 * 1000;

// ------------------------------------------------------------
// Classification
// ------------------------------------------------------------

/**
 * A call counts as reaching a person only when Sarvam said `connected`.
 * Nothing about elapsed time or the presence of a transcript is used here.
 */
export function isConnected(record: CallRecord): boolean {
  return record.status === "connected";
}

export function isInterested(record: CallRecord): boolean {
  return isConnected(record) && record.aiResult?.status === "interested";
}

export function isNotInterested(record: CallRecord): boolean {
  return isConnected(record) && record.aiResult?.status === "not_interested";
}

export function isUnresolved(record: CallRecord): boolean {
  return isConnected(record) && record.aiResult?.status === "uncertain";
}

export function isFinished(record: CallRecord): boolean {
  return record.status !== "initiating" && record.status !== "calling";
}

/** The moment a call happened, preferring the provider's clock over Dialo's. */
export function callTime(record: CallRecord): number | null {
  const raw = record.startedAt || record.requestedAt;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? null : time;
}

// ------------------------------------------------------------
// Aggregates
// ------------------------------------------------------------

export interface Percentage {
  value: number;
  /** Numerator and denominator, so the UI can say what the percentage is *of*. */
  of: number;
}

/** Returns null rather than 0% when there is nothing to divide by. */
export function rate(part: number, whole: number): Percentage | null {
  if (whole <= 0) return null;
  return { value: (part / whole) * 100, of: whole };
}

export interface CallMetrics {
  totalCalls: number;
  completedCalls: number;
  inFlightCalls: number;
  /** Attempts still awaiting a webhook long past when one should have arrived. */
  abandonedCalls: number;
  connectedCalls: number;
  noAnswerCalls: number;
  busyCalls: number;
  failedCalls: number;
  interestedCalls: number;
  notInterestedCalls: number;
  unresolvedCalls: number;
  handoffCalls: number;
  suppressedLeads: number;
  queuedLeads: number;

  callsToday: number;
  callsYesterday: number;
  /** Null until there is a yesterday to compare against. */
  callsTodayDelta: number | null;

  /** Connected ÷ completed attempts. */
  contactRate: Percentage | null;
  /** Interested ÷ connected calls. */
  interestRate: Percentage | null;
  /** Interest rate over the last 7 days, and the change from the 7 days before it. */
  interestRateThisWeek: Percentage | null;
  interestRateDelta: number | null;

  /** Mean of real Sarvam durations across connected calls. */
  averageDurationSeconds: number | null;
  totalTalkTimeSeconds: number;
  /** Mean confidence Sarvam reported, across calls where it reported one. */
  averageConfidence: number | null;

  pendingFollowUps: number;
  overdueFollowUps: number;
  unscheduledFollowUps: number;
  completedFollowUps: number;
  /** Follow-ups ÷ connected calls. */
  followUpRate: Percentage | null;

  /** The busiest weekday, or null when no call has a timestamp. */
  peakDay: { name: string; count: number } | null;
  /** Mean calls per day, counted over days that actually had calls. */
  averageCallsPerActiveDay: number | null;

  firstCallAt: string | null;
  lastCallAt: string | null;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function computeCallMetrics(
  records: CallRecord[],
  leads: Lead[],
  followUps: FollowUp[]
): CallMetrics {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayStart = startOfToday.getTime();
  const yesterdayStart = todayStart - DAY_MS;

  const completed = records.filter(isFinished);
  const connected = records.filter(isConnected);

  // A trigger Sarvam accepted but never reported on. Counted separately so it
  // neither inflates the contact rate nor sits in "in progress" indefinitely.
  const abandoned = records.filter((record) => {
    if (isFinished(record)) return false;
    const requested = new Date(record.requestedAt || 0).getTime();
    return requested > 0 && now - requested > RESULT_TIMEOUT_MS;
  });

  const durations = connected
    .map((record) => record.duration)
    .filter((duration): duration is number => typeof duration === "number" && duration > 0);

  const confidences = connected
    .map((record) => record.interestConfidence)
    .filter((value): value is number => typeof value === "number");

  // --- Daily counts ---
  const dayCounts = new Map<string, number>();
  const weekdayCounts = new Array(7).fill(0);
  let callsToday = 0;
  let callsYesterday = 0;
  let earliest: number | null = null;
  let latest: number | null = null;

  for (const record of records) {
    const time = callTime(record);
    if (time === null) continue;

    if (time >= todayStart) callsToday++;
    else if (time >= yesterdayStart) callsYesterday++;

    const date = new Date(time);
    const key = date.toISOString().split("T")[0];
    dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
    weekdayCounts[date.getDay()]++;

    if (earliest === null || time < earliest) earliest = time;
    if (latest === null || time > latest) latest = time;
  }

  // --- Week-over-week interest ---
  const thisWeek = records.filter((record) => {
    const time = callTime(record);
    return time !== null && now - time < 7 * DAY_MS;
  });
  const lastWeek = records.filter((record) => {
    const time = callTime(record);
    if (time === null) return false;
    const age = now - time;
    return age >= 7 * DAY_MS && age < 14 * DAY_MS;
  });

  const thisWeekConnected = thisWeek.filter(isConnected);
  const lastWeekConnected = lastWeek.filter(isConnected);
  const interestRateThisWeek = rate(thisWeek.filter(isInterested).length, thisWeekConnected.length);
  const interestRateLastWeek = rate(lastWeek.filter(isInterested).length, lastWeekConnected.length);

  // --- Peak weekday ---
  let peakDay: CallMetrics["peakDay"] = null;
  weekdayCounts.forEach((count, index) => {
    if (count > 0 && (peakDay === null || count > peakDay.count)) {
      peakDay = { name: WEEKDAYS[index], count };
    }
  });

  const activeFollowUps = followUps.filter(
    (followUp) => followUp.status !== "completed" && followUp.status !== "cancelled"
  );

  return {
    totalCalls: records.length,
    completedCalls: completed.length,
    inFlightCalls: records.length - completed.length - abandoned.length,
    abandonedCalls: abandoned.length,
    connectedCalls: connected.length,
    noAnswerCalls: records.filter((record) => record.status === "no_answer").length,
    busyCalls: records.filter((record) => record.status === "busy").length,
    failedCalls: records.filter(
      (record) => record.status === "failed" || record.status === "provider_error"
    ).length,
    interestedCalls: records.filter(isInterested).length,
    notInterestedCalls: records.filter(isNotInterested).length,
    unresolvedCalls: records.filter(isUnresolved).length,
    handoffCalls: records.filter((record) => record.humanHandoffRequired === true).length,
    suppressedLeads: leads.filter((lead) => lead.suppressed).length,
    queuedLeads: leads.filter((lead) => lead.status === "queued" && !lead.suppressed).length,

    callsToday,
    callsYesterday,
    callsTodayDelta: callsYesterday > 0 || callsToday > 0 ? callsToday - callsYesterday : null,

    contactRate: rate(connected.length, completed.length),
    interestRate: rate(records.filter(isInterested).length, connected.length),
    interestRateThisWeek,
    interestRateDelta:
      interestRateThisWeek && interestRateLastWeek
        ? interestRateThisWeek.value - interestRateLastWeek.value
        : null,

    averageDurationSeconds:
      durations.length > 0
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
    totalTalkTimeSeconds: durations.reduce((sum, value) => sum + value, 0),
    averageConfidence:
      confidences.length > 0
        ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
        : null,

    pendingFollowUps: activeFollowUps.length,
    overdueFollowUps: activeFollowUps.filter(
      (followUp) => followUp.scheduledTime !== null && new Date(followUp.scheduledTime).getTime() < now
    ).length,
    unscheduledFollowUps: activeFollowUps.filter((followUp) => followUp.scheduledTime === null).length,
    completedFollowUps: followUps.filter((followUp) => followUp.status === "completed").length,
    followUpRate: rate(followUps.length, connected.length),

    peakDay,
    averageCallsPerActiveDay:
      dayCounts.size > 0
        ? Math.round((records.length / dayCounts.size) * 10) / 10
        : null,

    firstCallAt: earliest === null ? null : new Date(earliest).toISOString(),
    lastCallAt: latest === null ? null : new Date(latest).toISOString(),
  };
}

// ------------------------------------------------------------
// Series
// ------------------------------------------------------------

export interface DailyPoint {
  date: string;
  label: string;
  calls: number;
  connected: number;
  interested: number;
}

/** Calls per day over the trailing `days` window, including days with no activity. */
export function computeDailySeries(records: CallRecord[], days = 7): DailyPoint[] {
  const buckets = new Map<string, DailyPoint>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today.getTime() - offset * DAY_MS);
    const key = date.toISOString().split("T")[0];
    buckets.set(key, {
      date: key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      calls: 0,
      connected: 0,
      interested: 0,
    });
  }

  for (const record of records) {
    const time = callTime(record);
    if (time === null) continue;
    const key = new Date(time).toISOString().split("T")[0];
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.calls++;
    if (isConnected(record)) bucket.connected++;
    if (isInterested(record)) bucket.interested++;
  }

  return [...buckets.values()];
}

export interface WeeklyPoint {
  label: string;
  weekStart: string;
  calls: number;
  connected: number;
  interested: number;
  /** Interest rate for the week, or null when no call connected that week. */
  interestRate: number | null;
}

/** Trailing weeks, labelled from real dates rather than fixed month names. */
export function computeWeeklySeries(records: CallRecord[], weeks = 8): WeeklyPoint[] {
  const now = new Date();
  now.setHours(23, 59, 59, 999);
  const series: WeeklyPoint[] = [];

  for (let offset = weeks - 1; offset >= 0; offset--) {
    const end = now.getTime() - offset * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;

    const inWeek = records.filter((record) => {
      const time = callTime(record);
      return time !== null && time > start && time <= end;
    });

    const connected = inWeek.filter(isConnected).length;
    const interested = inWeek.filter(isInterested).length;

    series.push({
      label: new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      weekStart: new Date(start).toISOString(),
      calls: inWeek.length,
      connected,
      interested,
      interestRate: connected > 0 ? Math.round((interested / connected) * 100) : null,
    });
  }

  return series;
}

export interface HourlyPoint {
  hour: number;
  label: string;
  calls: number;
  connected: number;
}

/** Hour-of-day distribution across the hours that actually saw calls. */
export function computeHourlySeries(records: CallRecord[]): HourlyPoint[] {
  const hours = new Map<number, HourlyPoint>();

  for (const record of records) {
    const time = callTime(record);
    if (time === null) continue;
    const hour = new Date(time).getHours();
    if (!hours.has(hour)) {
      const suffix = hour < 12 ? "am" : "pm";
      const display = hour % 12 === 0 ? 12 : hour % 12;
      hours.set(hour, { hour, label: `${display}${suffix}`, calls: 0, connected: 0 });
    }
    const bucket = hours.get(hour) as HourlyPoint;
    bucket.calls++;
    if (isConnected(record)) bucket.connected++;
  }

  return [...hours.values()].sort((a, b) => a.hour - b.hour);
}

export interface OutcomeSlice {
  name: string;
  value: number;
  /**
   * Stable identifier for the outcome, used to look up its colour.
   * Deliberately not called `key`: Recharts passes data through to a shape
   * renderer alongside React's own `key`, and the two were easy to confuse.
   */
  outcome: string;
}

/** Outcome breakdown with empty categories dropped, so a chart never shows phantom slices. */
export function computeOutcomeBreakdown(metrics: CallMetrics): OutcomeSlice[] {
  return [
    { outcome: "interested", name: "Interested", value: metrics.interestedCalls },
    { outcome: "not_interested", name: "Not interested", value: metrics.notInterestedCalls },
    { outcome: "unresolved", name: "No clear outcome", value: metrics.unresolvedCalls },
    { outcome: "no_answer", name: "No answer", value: metrics.noAnswerCalls },
    { outcome: "busy", name: "Busy", value: metrics.busyCalls },
    { outcome: "failed", name: "Failed", value: metrics.failedCalls },
  ].filter((slice) => slice.value > 0);
}
