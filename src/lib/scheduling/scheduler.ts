// ============================================================
// Dialo AI — Follow-up Scheduler
// ============================================================
//
// Places agreed callbacks without anyone pressing a button.
//
// It runs server-side on a fixed tick, so a callback happens whether or not a
// browser is open — a frontend timer would only fire for whoever happened to
// have the tab in front of them.
//
// Every due callback passes the same guards as a manual call, plus two of its
// own: the lead must still be callable, and the agreed time must fall inside the
// configured calling window. A customer agreed to a time, not to being dialled
// at any hour the parser happened to produce.
// ============================================================

import {
  claimFollowUp,
  getCallRecord,
  getCallingWindow,
  getDueFollowUps,
  getFollowUps,
  getLead,
  getReachabilityHistory,
  releaseFollowUp,
  updateFollowUp,
} from "@/lib/db";
import { effectiveWebhookBaseUrl, placeCall } from "@/lib/calls/place-call";
import { repairStaleLeadStatuses } from "@/lib/calls/lead-status";
import { runDailySummaries } from "@/lib/notifications";
import { isWorthReconciling, reconcileCallWithProvider } from "@/lib/calls/reconcile";
import { getCallRecords } from "@/lib/db";
import { instantToZonedParts, isValidTimeZone, zonedTimeToInstant } from "./time";
import type { CallingWindow, FollowUp } from "@/lib/types";

/** How often the worker looks for due callbacks. */
export const TICK_INTERVAL_MS = 30_000;

/** A claim older than this is treated as abandoned by a crashed worker. */
export const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/** After this many failed attempts the callback stops retrying and waits for a human. */
export const MAX_EXECUTION_ATTEMPTS = 3;

/**
 * How late a callback may be placed after its agreed time.
 *
 * A customer who said "call me in five minutes" did not agree to be called three
 * hours later because the server was down or the webhook URL was unreachable.
 * Past this, the callback is held for a new time to be agreed rather than fired
 * long after the moment it was meant for.
 */
export const MAX_CALLBACK_DELAY_MS = 30 * 60 * 1000;

/**
 * Consecutive carrier failures, with no call to this number ever connecting,
 * before automatic calling stops.
 *
 * Sarvam reports these as `failed` with no reason at all, and the attempt never
 * reaches the agent — the call dies on the telephony leg. Repeating it costs a
 * call attempt and tells nobody anything new, so it is handed to a person.
 */
export const MAX_CONSECUTIVE_CARRIER_FAILURES = 3;

/** Wait between retries when a trigger fails for an infrastructure reason. */
export const RETRY_DELAY_MS = 2 * 60 * 1000;

/** How long a placed callback may wait for its webhook before we give up on it. */
export const RESULT_TIMEOUT_MS = 15 * 60 * 1000;

export interface TickOutcome {
  followUpId: string;
  leadName: string;
  result: "placed" | "skipped" | "failed" | "cancelled";
  detail: string;
}

export interface TickReport {
  ranAt: string;
  due: number;
  outcomes: TickOutcome[];
}

// ------------------------------------------------------------
// Calling window
// ------------------------------------------------------------

function minutesOfDay(value: string): number | null {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface WindowCheck {
  inside: boolean;
  detail: string;
}

/**
 * Checks an instant against the configured calling window.
 *
 * A window whose end is before its start (22:00 to 06:00) is read as spanning
 * midnight rather than as an empty range.
 */
export function isInsideCallingWindow(instant: number, window: CallingWindow): WindowCheck {
  const from = minutesOfDay(window.from);
  const to = minutesOfDay(window.to);
  const timezone = isValidTimeZone(window.timezone) ? window.timezone : "UTC";

  if (from === null || to === null) {
    // A window we cannot read must not silently block every callback.
    return { inside: true, detail: "Calling window is not configured correctly; not enforced." };
  }

  const parts = instantToZonedParts(instant, timezone);
  const current = parts.hour * 60 + parts.minute;

  const inside = from <= to ? current >= from && current <= to : current >= from || current <= to;

  return {
    inside,
    detail: inside
      ? `Inside the ${window.from}–${window.to} window (${timezone}).`
      : `Falls outside the ${window.from}–${window.to} calling window (${timezone}).`,
  };
}

/**
 * The next instant the calling window opens, in the window's own timezone.
 * Returns `now` when the window is unreadable, so a bad config never parks a
 * retry indefinitely.
 */
export function nextWindowOpening(now: number, window: CallingWindow): number {
  const from = minutesOfDay(window.from);
  if (from === null) return now;
  const timezone = isValidTimeZone(window.timezone) ? window.timezone : "UTC";

  const today = instantToZonedParts(now, timezone);
  let opening = zonedTimeToInstant(
    today.year, today.month, today.day, Math.floor(from / 60), from % 60, timezone
  );
  if (opening <= now) {
    const tomorrow = instantToZonedParts(now + 86_400_000, timezone);
    opening = zonedTimeToInstant(
      tomorrow.year, tomorrow.month, tomorrow.day, Math.floor(from / 60), from % 60, timezone
    );
  }
  return opening;
}

// ------------------------------------------------------------
// The tick
// ------------------------------------------------------------

async function executeFollowUp(followUp: FollowUp, now: number): Promise<TickOutcome> {
  const base = { followUpId: followUp.id, leadName: followUp.lead?.name ?? "Unknown" };

  // --- The lead must still be callable ---
  const lead = getLead(followUp.leadId);
  if (!lead) {
    releaseFollowUp(followUp.id, {
      status: "failed",
      lastError: "The lead no longer exists.",
    });
    return { ...base, result: "cancelled", detail: "Lead no longer exists." };
  }

  if (lead.suppressed) {
    releaseFollowUp(followUp.id, {
      status: "cancelled",
      nextAction: "Cancelled — lead is on the do-not-call list",
      lastError: null,
    });
    return { ...base, result: "cancelled", detail: "Lead is on the do-not-call list." };
  }

  // A retry is a time Dialo chose (after no answer, busy, or a failed trigger);
  // a first attempt is a time the customer chose. They are treated differently
  // below, so tell them apart before anything else.
  const isRetry = Boolean(followUp.nextAttemptAt);

  // --- This attempt must not have gone stale ---
  // Measured from when *this* attempt was due. Measuring retries from the
  // original agreed time killed every second retry as "stale", because the
  // retry delay alone pushed it past the limit.
  const dueAtIso = followUp.nextAttemptAt ?? followUp.scheduledTime;
  const agreedAt = dueAtIso ? new Date(dueAtIso).getTime() : null;
  if (agreedAt !== null && now - agreedAt > MAX_CALLBACK_DELAY_MS) {
    const lateBy = Math.round((now - agreedAt) / 60000);
    // The time is kept, not wiped. It is the record of what the customer asked
    // for, and a page that has lost it cannot show anyone what went wrong.
    releaseFollowUp(followUp.id, {
      status: "needs_scheduling",
      nextAttemptAt: null,
      lastError: `The agreed time passed ${lateBy} minutes ago. Calling this late is not what the customer agreed to, so a new time is needed.`,
    });
    console.log(`SCHEDULER_HELD_STALE followUp=${followUp.id} lateByMinutes=${lateBy}`);
    return { ...base, result: "skipped", detail: `Agreed time passed ${lateBy} minutes ago.` };
  }

  // --- The number must look reachable ---
  const reach = getReachabilityHistory(lead.id);
  if (reach.consecutiveFailures >= MAX_CONSECUTIVE_CARRIER_FAILURES && !reach.everConnected) {
    releaseFollowUp(followUp.id, {
      status: "needs_scheduling",
      nextAttemptAt: null,
      lastError: `The carrier has failed to connect this number ${reach.consecutiveFailures} times and it has never answered. Check the number is correct and reachable before trying again.`,
    });
    console.log(
      `SCHEDULER_HELD_UNREACHABLE followUp=${followUp.id} failures=${reach.consecutiveFailures}`
    );
    return {
      ...base,
      result: "skipped",
      detail: `Number has failed ${reach.consecutiveFailures} times and never connected.`,
    };
  }

  // --- Calling window ---
  // The window stops Dialo choosing an unreasonable hour. It does not override a
  // time the customer asked for: "call me in two minutes" at 8:45 pm is consent
  // to a call at 8:47 pm. Blocking those is what made evening callbacks silently
  // never happen — Priya promised a call, the scheduler refused it.
  const window = getCallingWindow();
  const check = isInsideCallingWindow(now, window);
  if (!check.inside) {
    if (!isRetry) {
      console.log(
        `SCHEDULER_WINDOW_OVERRIDDEN followUp=${followUp.id} reason=customer_requested_time`
      );
    } else {
      // A retry is Dialo's choice, so it waits for the window to open rather
      // than dead-ending — the customer did ask to be called back.
      const opensAt = nextWindowOpening(now, window);
      releaseFollowUp(followUp.id, {
        status: "retry_pending",
        nextAttemptAt: new Date(opensAt).toISOString(),
        lastError: `${check.detail} Retry deferred to when the window opens.`,
      });
      console.log(
        `SCHEDULER_RETRY_DEFERRED followUp=${followUp.id} until=${new Date(opensAt).toISOString()}`
      );
      return { ...base, result: "skipped", detail: `${check.detail} Retry deferred.` };
    }
  }

  // --- Place it ---
  console.log(
    `OUTBOUND_TRIGGER_STARTED followUp=${followUp.id} lead=${lead.id} attempt=${followUp.executionAttempts ?? 1}`
  );

  const result = await placeCall({
    leadId: lead.id,
    leadName: lead.name,
    leadPhone: lead.phone,
    leadCompany: lead.company,
    leadNotes: lead.notes,
    campaignId: lead.campaign,
    webhookBaseUrl: effectiveWebhookBaseUrl(),
    origin: "scheduler",
  });

  if (result.ok) {
    releaseFollowUp(followUp.id, {
      status: "calling",
      executedCallId: result.callId,
      executedAttemptId: result.attemptId,
      executedAt: new Date(now).toISOString(),
      lastError: null,
    });
    console.log(
      `SARVAM_OUTBOUND_SUCCESS followUp=${followUp.id} call=${result.callId} attempt=${result.attemptId}`
    );
    return { ...base, result: "placed", detail: `Attempt ${result.attemptId}.` };
  }

  // A lead suppressed between the two checks, or already being called, is not a
  // failure worth retrying.
  console.log(`SARVAM_OUTBOUND_FAILED followUp=${followUp.id} reason=${result.reason}`);

  if (result.reason === "call_blocked_dnd") {
    releaseFollowUp(followUp.id, { status: "cancelled", lastError: result.message });
    return { ...base, result: "cancelled", detail: result.message };
  }

  if (result.reason === "duplicate_call_prevented") {
    releaseFollowUp(followUp.id, { status: "scheduled", lastError: result.message });
    return { ...base, result: "skipped", detail: result.message };
  }

  const attempts = followUp.executionAttempts ?? 1;
  const exhausted = attempts >= MAX_EXECUTION_ATTEMPTS;

  releaseFollowUp(followUp.id, {
    // Retries on its own timer until the attempts run out, then waits for a
    // person rather than hammering a broken setup forever.
    status: exhausted ? "failed" : "retry_pending",
    nextAttemptAt: exhausted ? null : new Date(now + RETRY_DELAY_MS).toISOString(),
    lastError: result.message,
  });

  return {
    ...base,
    result: "failed",
    detail: exhausted
      ? `${result.message} Giving up after ${attempts} attempts.`
      : `${result.message} Will retry.`,
  };
}

/**
 * Closes out follow-ups left in `calling`.
 *
 * A callback is marked `calling` when its outbound is placed, and the resulting
 * webhook closes it. Two things break that: a result that never arrives because
 * the webhook URL was down, and — historically — a webhook that did arrive
 * before any code existed to link it back. Either way the row sits in `calling`
 * for good, invisible to the scheduler, and the customer is never called again.
 *
 * So each tick reconciles them against the call they actually placed.
 */
function reconcileInFlightFollowUps(now: number): TickOutcome[] {
  const outcomes: TickOutcome[] = [];

  for (const followUp of getFollowUps()) {
    if (followUp.status !== "calling") continue;

    const call = followUp.executedCallId ? getCallRecord(followUp.executedCallId) : undefined;
    const base = { followUpId: followUp.id, leadName: followUp.lead?.name ?? "Unknown" };

    if (call && call.status === "connected") {
      updateFollowUp(followUp.id, { status: "completed", lockedAt: null, nextAttemptAt: null });
      console.log(`FOLLOW_UP_RECONCILED followUp=${followUp.id} -> completed`);
      outcomes.push({ ...base, result: "placed", detail: "Callback connected; marked completed." });
      continue;
    }

    if (call && (call.status === "no_answer" || call.status === "busy" || call.status === "failed")) {
      updateFollowUp(followUp.id, {
        status: call.status === "failed" ? "failed" : call.status,
        failureReason: call.failureReason ?? null,
        lockedAt: null,
        nextAttemptAt: null,
      });
      console.log(`FOLLOW_UP_RECONCILED followUp=${followUp.id} -> ${call.status}`);
      outcomes.push({ ...base, result: "skipped", detail: `Callback ended as ${call.status}.` });
      continue;
    }

    // Still in flight. Past the point a result should have arrived, stop
    // describing it as in progress.
    const placedAt = followUp.executedAt ? new Date(followUp.executedAt).getTime() : null;
    if (placedAt !== null && now - placedAt > RESULT_TIMEOUT_MS) {
      updateFollowUp(followUp.id, {
        status: "failed",
        lockedAt: null,
        lastError:
          "The callback was placed but its result never arrived, usually because the webhook URL was unreachable. What happened on the call is unknown.",
      });
      console.log(`FOLLOW_UP_RESULT_LOST followUp=${followUp.id}`);
      outcomes.push({ ...base, result: "failed", detail: "Callback result never arrived." });
    }
  }

  return outcomes;
}

/**
 * Settles calls still in flight against Sarvam's attempt record.
 *
 * Runs on the tick as well as on the live view, so a call settles even with no
 * browser open — and so calls whose webhook was lost while the public URL was
 * down are recovered rather than left in `calling` for ever.
 */
async function reconcileInFlightCalls(now: number): Promise<TickOutcome[]> {
  const outcomes: TickOutcome[] = [];

  for (const record of getCallRecords()) {
    if (!isWorthReconciling(record, now)) continue;

    const result = await reconcileCallWithProvider(record.id);
    if (!result.changed) continue;

    outcomes.push({
      followUpId: record.id,
      leadName: record.lead?.name ?? "Unknown",
      result: result.status === "connected" ? "placed" : "skipped",
      detail: result.detail,
    });
  }

  return outcomes;
}

/**
 * Runs one pass: claim every due callback and place it.
 *
 * Callbacks are handled one at a time so a burst of due rows cannot open several
 * outbound calls at once.
 */
export async function runSchedulerTick(now = Date.now()): Promise<TickReport> {
  // Settle anything still in flight before looking for new work: a follow-up
  // cannot be closed out while the call it placed is still open.
  const outcomes: TickOutcome[] = await reconcileInFlightCalls(now);
  outcomes.push(...reconcileInFlightFollowUps(now));

  // Backstop: any lead still shown as calling whose latest call has settled.
  repairStaleLeadStatuses();

  // Once a day per workspace, after 7pm in the calling timezone. Records the
  // date before sending, so an overlapping tick cannot send it twice.
  await runDailySummaries(now);

  const due = getDueFollowUps(now, LOCK_TIMEOUT_MS);

  for (const followUp of due) {
    // Claiming is what stops two overlapping ticks dialling the same customer.
    if (!claimFollowUp(followUp.id, now, LOCK_TIMEOUT_MS)) continue;
    console.log(`SCHEDULER_PICKED_UP followUp=${followUp.id} due=${followUp.scheduledTime ?? "retry"}`);

    try {
      outcomes.push(await executeFollowUp(followUp, now));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown scheduler error";
      releaseFollowUp(followUp.id, { status: "scheduled", lastError: message });
      outcomes.push({
        followUpId: followUp.id,
        leadName: followUp.lead?.name ?? "Unknown",
        result: "failed",
        detail: message,
      });
    }
  }

  if (outcomes.length > 0) {
    console.log(
      `[Scheduler] ${outcomes.length} callback(s) handled: ` +
        outcomes.map((o) => `${o.leadName} -> ${o.result}`).join(", ")
    );
  }

  return { ranAt: new Date(now).toISOString(), due: due.length, outcomes };
}

// ------------------------------------------------------------
// The worker
// ------------------------------------------------------------

declare global {
  var __dialoSchedulerTimer: ReturnType<typeof setInterval> | undefined;
  var __dialoSchedulerLastTick: string | undefined;
  var __dialoSchedulerLastError: string | undefined;
}

let running = false;

export interface SchedulerStatus {
  running: boolean;
  intervalMs: number;
  lastTickAt: string | null;
  lastError: string | null;
}

/** What /api/health reports. A scheduler that has stopped is a silent failure. */
export function schedulerStatus(): SchedulerStatus {
  return {
    running: Boolean(globalThis.__dialoSchedulerTimer),
    intervalMs: TICK_INTERVAL_MS,
    lastTickAt: globalThis.__dialoSchedulerLastTick ?? null,
    lastError: globalThis.__dialoSchedulerLastError ?? null,
  };
}

/**
 * Starts the background worker.
 *
 * Guarded on `globalThis` so a dev-server reload does not leave two workers
 * racing each other, and re-entrancy is blocked so a slow tick cannot overlap
 * the next one.
 */
export function startScheduler(): void {
  if (process.env.DIALO_DISABLE_SCHEDULER === "true") {
    console.log("[Scheduler] Disabled by DIALO_DISABLE_SCHEDULER.");
    return;
  }

  if (globalThis.__dialoSchedulerTimer) return;

  globalThis.__dialoSchedulerTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick();
      globalThis.__dialoSchedulerLastTick = new Date().toISOString();
      globalThis.__dialoSchedulerLastError = undefined;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      globalThis.__dialoSchedulerLastError = message;
      console.error("[Scheduler] Tick failed:", message);
    } finally {
      running = false;
    }
  }, TICK_INTERVAL_MS);

  console.log(`[Scheduler] Running every ${TICK_INTERVAL_MS / 1000}s.`);
}
