// ============================================================
// Tringlo AI — Inbound analytics
// ============================================================
//
// Computed on the server from the workspace's inbound call records — every
// figure is a count of real records, never a frontend estimate. Kept apart
// from outbound analytics: "calls we placed" and "calls we received" answer
// different questions.
//
// Definitions (they matter):
//   inbound calls     every inbound call record in the range
//   connected         records where a conversation took place
//   resolved by AI    the agent reported "resolved" and no transfer happened
//   human handoffs    calls Sarvam confirms ended by transfer
//   handoffs asked    calls where the agent reported a person was needed
//   unresolved        the agent reported "unresolved"
//   unique callers    distinct normalised numbers
//   repeat callers    numbers that called more than once in the range
// ============================================================

import { normalisePhone } from "@/lib/customers/identity";
import { callDirection, type CallRecord } from "@/lib/types";

export interface InboundAnalytics {
  rangeDays: number;
  timezone: string;
  totals: {
    inboundCalls: number;
    connected: number;
    resolvedByAi: number;
    humanHandoffs: number;
    handoffsRequested: number;
    transferFailed: number;
    unresolved: number;
    resolutionNotReported: number;
    averageDurationSeconds: number | null;
    uniqueCallers: number;
    repeatCallers: number;
    followUpRequests: number;
    resolutionRate: number | null;
    handoffRate: number | null;
  };
  daily: Array<{ date: string; inbound: number; outbound: number }>;
  byHour: Array<{ hour: number; calls: number }>;
  byWeekday: Array<{ day: string; calls: number }>;
  reasons: Array<{ reason: string; calls: number }>;
  outcomes: Array<{ label: string; calls: number }>;
  callers: { firstTime: number; repeat: number };
}

function zoned(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday: get("weekday") };
}

function when(record: CallRecord): string | null {
  return record.startedAt ?? record.endedAt ?? record.requestedAt ?? null;
}

export function computeInboundAnalytics(records: CallRecord[], timezone: string, rangeDays = 30, now = Date.now()): InboundAnalytics {
  const since = now - rangeDays * 24 * 60 * 60 * 1000;
  const inRange = records.filter((record) => {
    const at = when(record);
    return at !== null && new Date(at).getTime() >= since;
  });
  const inbound = inRange.filter((record) => callDirection(record) === "inbound");
  const connected = inbound.filter((record) => record.status === "connected");

  const transferred = connected.filter((record) => record.humanHandoffStatus === "transferred");
  const resolvedByAi = connected.filter((record) => record.resolutionStatus === "resolved" && record.humanHandoffStatus !== "transferred");
  const unresolved = connected.filter((record) => record.resolutionStatus === "unresolved");
  const durations = connected.map((record) => record.duration).filter((value): value is number => typeof value === "number" && value > 0);

  const perCaller = new Map<string, number>();
  for (const record of inbound) {
    const key = normalisePhone(record.lead?.phone).national ?? record.leadId;
    perCaller.set(key, (perCaller.get(key) ?? 0) + 1);
  }
  const repeatCallers = [...perCaller.values()].filter((count) => count > 1).length;

  // Daily series, inbound beside outbound, every day in the range shown.
  const days: Array<{ date: string; inbound: number; outbound: number }> = [];
  for (let offset = rangeDays - 1; offset >= 0; offset--) {
    days.push({ date: zoned(new Date(now - offset * 86_400_000).toISOString(), timezone).date, inbound: 0, outbound: 0 });
  }
  const dayIndex = new Map(days.map((day, index) => [day.date, index]));
  for (const record of inRange) {
    const index = dayIndex.get(zoned(when(record)!, timezone).date);
    if (index === undefined) continue;
    if (callDirection(record) === "inbound") days[index].inbound++;
    else days[index].outbound++;
  }

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: 0 }));
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const byWeekday = weekdays.map((day) => ({ day, calls: 0 }));
  const reasons = new Map<string, number>();
  for (const record of inbound) {
    const at = zoned(when(record)!, timezone);
    byHour[at.hour].calls++;
    const weekday = weekdays.indexOf(at.weekday);
    if (weekday >= 0) byWeekday[weekday].calls++;
    if (record.status === "connected") {
      const reason = record.intent ?? "not reported";
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  const connectedCount = connected.length;
  return {
    rangeDays,
    timezone,
    totals: {
      inboundCalls: inbound.length,
      connected: connectedCount,
      resolvedByAi: resolvedByAi.length,
      humanHandoffs: transferred.length,
      handoffsRequested: connected.filter((record) => record.humanHandoffRequired || record.humanHandoffStatus !== "none").length,
      transferFailed: connected.filter((record) => record.humanHandoffStatus === "transfer_failed").length,
      unresolved: unresolved.length,
      resolutionNotReported: connected.filter((record) => !record.resolutionStatus).length,
      averageDurationSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
      uniqueCallers: perCaller.size,
      repeatCallers,
      followUpRequests: connected.filter((record) => record.followUpRequired).length,
      resolutionRate: connectedCount ? resolvedByAi.length / connectedCount : null,
      handoffRate: connectedCount ? transferred.length / connectedCount : null,
    },
    daily: days,
    byHour,
    byWeekday,
    reasons: [...reasons.entries()].map(([reason, calls]) => ({ reason, calls })).sort((a, b) => b.calls - a.calls),
    outcomes: [
      { label: "Resolved by AI", calls: resolvedByAi.length },
      { label: "Transferred to a person", calls: transferred.length },
      { label: "Unresolved", calls: unresolved.length },
      { label: "Not reported", calls: connected.filter((record) => !record.resolutionStatus && record.humanHandoffStatus !== "transferred").length },
    ],
    callers: {
      firstTime: [...perCaller.values()].filter((count) => count === 1).length,
      repeat: repeatCallers,
    },
  };
}
