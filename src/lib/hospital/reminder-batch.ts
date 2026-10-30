// ============================================================
// Tringlo AI — Daily appointment reminders, in bulk
// ============================================================
//
// Every eligible appointment for the next day, across every doctor and
// department, turned into a confirmation call — one per appointment, never one
// per doctor and never one shared between patients. `appointment_id` is the
// unit of work and the key to uniqueness: a patient with two appointments gets
// two calls, and the same appointment is never dialled twice in one cycle.
//
// Two ways out to Sarvam, chosen by volume:
//
//   INSTANT  each reminder is queued for the server's confirmation-call worker,
//            which places it as an individual outbound with that appointment's
//            own variables, and correlates the result by the attempt id it gets
//            back. Used for a manual single reminder, or a small day.
//
//   BATCH    one Sarvam campaign is created and a cohort of one row per
//            appointment is streamed to it; Sarvam dials and retries within an
//            allowed window. Used for a bulk day. Results come back on the
//            campaign webhook and are matched to the appointment by the cohort's
//            user_identifier (the appointment id).
//
// AUTO picks batch once the eligible count reaches a configurable threshold.
//
// Nothing here dials during a dry run: a batch is only created when the
// hospital has switched reminders on, and the worker enforces the same gate for
// instant calls. The transformation-file format a CSV upload needs is still
// unconfirmed upstream, so cohorts go out through the documented JSON stream —
// the CSV is built for inspection and the report, not sent.
// ============================================================

import {
  findReminderByProviderCampaign,
  getAppointment,
  getAppointments,
  getLeads,
  getOpenCancellationRequest,
  getReminderForAppointment,
  saveReminder,
} from "@/lib/db";
import { resolveBatch } from "@/lib/providers/config";
import { tryResolveOutbound } from "@/lib/providers/config";
import { cohortCsv } from "@/lib/campaigns/service";
import {
  createCampaign,
  streamCohort,
  updateCampaignStatus,
  type SarvamCohortUser,
  type SarvamCreateCampaignPayload,
} from "@/lib/providers/sarvam/campaigns";
import { withWebhookToken } from "@/lib/security/webhook-auth";
import { getWebhookBaseUrl } from "@/lib/db";
import type { CallRecord } from "@/lib/types";
import type { Weekday } from "@/lib/campaigns/types";
import { OPEN_APPOINTMENT_STATUSES, type Appointment, type Reminder } from "./types";
import { audit, hospitalProfile, localDate, scheduleReminderFor } from "./service";
import { reminderCallVariables } from "./reminder-variables";

/** How many appointments are examined per pass, so a large day is never truncated. */
const PAGE = 200;

/** AUTO switches to a batch campaign at or above this many eligible reminders. */
const DEFAULT_BATCH_THRESHOLD = 10;

/** Maya's batch retry rules, from the supplied Sarvam example. */
const REMINDER_RETRY = {
  max_retries: 3,
  retry_interval_minutes: 30,
  retry_on: {
    busy: { enabled: true },
    no_answer: { enabled: true },
    failed: { enabled: false },
    short_duration: { enabled: true, threshold_seconds: 25 },
  },
};

/** The default calling window. Weekend/after-hours reminders are held by Sarvam, not dropped. */
const REMINDER_WINDOW = {
  start_time: "09:00",
  end_time: "18:00",
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as Weekday[],
};

export type Strategy = "auto" | "instant" | "batch";

export interface SkipReason {
  appointmentId: string;
  patientName: string;
  reason: string;
}

export interface EligibleSet {
  date: string;
  totalForDate: number;
  eligible: Reminder[];
  skipped: SkipReason[];
}

export interface RunSummary {
  date: string;
  totalForDate: number;
  eligibleCount: number;
  skipped: SkipReason[];
  method: "instant" | "batch" | "none";
  queued: number;
  campaignId?: string | null;
  cohortId?: string | null;
  problem?: string;
}

// ------------------------------------------------------------
// Selection
// ------------------------------------------------------------

const hasTenDigits = (phone: string) => phone.replace(/[^\d]/g, "").length >= 10;

/** Tomorrow, in the hospital's own timezone. */
export function nextDay(tenantId: string, from = new Date()): string {
  const tz = hospitalProfile(tenantId).timezone;
  return localDate(new Date(from.getTime() + 86400_000), tz);
}

/**
 * Why this appointment is not eligible for a confirmation call, or null.
 * Decided from the appointment and the patient alone — provider/webhook
 * readiness is a dispatch-time concern, enforced where the call is placed.
 */
function ineligibleBecause(appointment: Appointment, reminder: Reminder | null): string | null {
  if (appointment.demo) return "demonstration appointment";
  if (!OPEN_APPOINTMENT_STATUSES.includes(appointment.status)) return `appointment is ${appointment.status}`;
  if (!appointment.patientPhone || !hasTenDigits(appointment.patientPhone)) return "no valid phone number";

  const patient = getLeads().find((lead) => lead.tenantId === appointment.tenantId && lead.id === appointment.patientLeadId);
  if (patient?.suppressed) return "patient has opted out of automated calls";

  if (getOpenCancellationRequest(appointment.tenantId, appointment.id)) return "an open cancellation request";

  // Already handled for THIS appointment time: answered, or already in flight
  // (dispatched instant/batch for this cycle). Uniqueness is per appointment_id
  // and per cycle, so a rescheduled appointment (a new cycle) is eligible again.
  if (reminder && reminder.cycle === appointment.scheduledAt) {
    if (reminder.outcome) return `already answered (${reminder.outcome.response.replace(/_/g, " ")})`;
    if (reminder.status === "sent" || reminder.status === "calling") return "a reminder is already in flight for this appointment";
  }
  return null;
}

/**
 * Every eligible appointment for one day, across all doctors, with a reminder
 * ensured for each. Processed in pages so a large day is never truncated.
 */
export function collectEligibleReminders(tenantId: string, forDate: string, pageSize = PAGE): EligibleSet {
  const tz = hospitalProfile(tenantId).timezone;
  const all = getAppointments(tenantId).filter((appt) => localDate(appt.scheduledAt, tz) === forDate);

  const eligible: Reminder[] = [];
  const skipped: SkipReason[] = [];

  for (let offset = 0; offset < all.length; offset += pageSize) {
    for (const appointment of all.slice(offset, offset + pageSize)) {
      // Ensure a reminder exists for this appointment (idempotent).
      let reminder = getReminderForAppointment(tenantId, appointment.id) ?? null;
      if (!reminder) reminder = scheduleReminderFor(appointment);

      const reason = ineligibleBecause(appointment, reminder);
      if (reason || !reminder) {
        skipped.push({ appointmentId: appointment.id, patientName: appointment.patientName, reason: reason ?? "no reminder could be scheduled" });
        continue;
      }
      eligible.push(reminder);
    }
  }

  return { date: forDate, totalForDate: all.length, eligible, skipped };
}

// ------------------------------------------------------------
// Strategy
// ------------------------------------------------------------

export function chooseStrategy(strategy: Strategy, eligibleCount: number, threshold = DEFAULT_BATCH_THRESHOLD): "instant" | "batch" {
  if (strategy === "instant") return "instant";
  if (strategy === "batch") return "batch";
  return eligibleCount >= threshold ? "batch" : "instant";
}

// ------------------------------------------------------------
// Dispatch
// ------------------------------------------------------------

/**
 * Queue each reminder for the confirmation-call worker, which places one
 * individual outbound per appointment and correlates its own result. The worker
 * is the only thing that dials, so every safety gate still applies.
 */
export function dispatchInstant(tenantId: string, reminders: Reminder[]): number {
  const now = new Date().toISOString();
  for (const reminder of reminders) {
    saveReminder({ ...reminder, status: "scheduled", dueAt: now, lockedAt: null, failureReason: null, skippedReason: null, dispatchMethod: "instant" });
  }
  audit(tenantId, "system", "reminders.dispatch_instant", forDateAudit(reminders), `${reminders.length} queued`);
  return reminders.length;
}

function forDateAudit(reminders: Reminder[]): string {
  return reminders[0]?.cycle ? reminders[0].cycle.slice(0, 10) : "day";
}

/** One cohort row per appointment, carrying that appointment's own variables. */
export function buildCohort(tenantId: string, reminders: Reminder[], declared: string[]): SarvamCohortUser[] {
  const allowed = new Set(declared);
  const users: SarvamCohortUser[] = [];
  for (const reminder of reminders) {
    const appointment = getAppointment(tenantId, reminder.appointmentId);
    if (!appointment) continue;
    const vars = reminderCallVariables(appointment);
    const app_variables: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars)) {
      if (allowed.size === 0 || allowed.has(key)) app_variables[key] = value;
    }
    users.push({
      user_phone_number: appointment.patientPhone,
      // The appointment id is the correlation key the webhook maps back by.
      user_identifier: appointment.id,
      app_variables,
    });
  }
  return users;
}

export interface BatchResult {
  ok: boolean;
  queued: number;
  campaignId?: string | null;
  cohortId?: string | null;
  csv?: string;
  problem?: string;
}

/**
 * Create one Sarvam campaign for the day's reminders and stream the cohort.
 *
 * A campaign begins at its start_timestamp within the allowed window — there is
 * no separate "activate" call; creating it with a cohort is what schedules it.
 * Only ever reaches Sarvam when the hospital has switched reminders on.
 */
export async function dispatchBatch(tenantId: string, reminders: Reminder[]): Promise<BatchResult> {
  const profile = hospitalProfile(tenantId);
  if (!profile.remindersEnabled) {
    return { ok: false, queued: 0, problem: "Reminder calling is switched off for this hospital; nothing was sent." };
  }

  const batchResolved = resolveBatch(tenantId);
  const batch = batchResolved?.batch;
  const outbound = tryResolveOutbound(tenantId);
  if (!batch || !batch.appId || !batch.connectionId || batch.phoneNumbers.length === 0) {
    return { ok: false, queued: 0, problem: "The batch calling agent is not fully configured for this workspace." };
  }
  if (!outbound.ok) return { ok: false, queued: 0, problem: outbound.problems.join("; ") };

  const base = getWebhookBaseUrl();
  if (!base || !/^https:\/\//i.test(base)) {
    return { ok: false, queued: 0, problem: "No public HTTPS address is registered for call results." };
  }

  const users = buildCohort(tenantId, reminders, batch.agentVariables ?? []);
  // Built for inspection/reporting; the CSV upload path needs a transformation
  // file whose format is unconfirmed upstream, so the stream endpoint is used.
  const csv = cohortCsv(users);

  const now = new Date();
  const end = new Date(now.getTime() + 2 * 86400_000);
  const schedule = batch.schedule;
  const payload: SarvamCreateCampaignPayload = {
    name: `Wellness confirmations ${localDate(now.toISOString(), profile.timezone)}`.slice(0, 100),
    app_config: {
      app_id: batch.appId,
      app_version: batch.appVersion,
      app_type: batch.appType || "agent",
      attempts_per_second: batch.attemptsPerSecond || 2,
      connection_configs: [{ connection_id: batch.connectionId, phone_numbers: batch.phoneNumbers }],
      retry_config: REMINDER_RETRY,
      webhook_config: {
        url: withWebhookToken(`${base.replace(/\/+$/, "")}/api/webhooks/sarvam/campaign`, outbound.value.webhookToken),
        metadata: { dialo_tenant_id: tenantId, dialo_reminder_cycle: forDateAudit(reminders) },
      },
    },
    start_timestamp: now.toISOString(),
    end_timestamp: end.toISOString(),
    allowed_schedule: {
      timezone: schedule?.timezone || profile.timezone,
      allowed_start_time: schedule?.startTime || REMINDER_WINDOW.start_time,
      allowed_end_time: schedule?.endTime || REMINDER_WINDOW.end_time,
      allowed_days: (schedule?.days as Weekday[]) || REMINDER_WINDOW.days,
    },
  };

  let campaignId: string;
  let cohortId: string | null = null;
  try {
    const created = await createCampaign(outbound.value.credentials, payload);
    campaignId = created.campaign_id;
  } catch (error) {
    return { ok: false, queued: 0, csv, problem: `Sarvam did not create the campaign: ${error instanceof Error ? error.message : error}` };
  }
  try {
    for (let offset = 0; offset < users.length; offset += 1000) {
      const slice = users.slice(offset, offset + 1000);
      const name = users.length > 1000 ? `wellness-${offset / 1000 + 1}` : "wellness-confirmations";
      const cohort = await streamCohort(outbound.value.credentials, campaignId, name, slice);
      cohortId = cohort.cohort_id ?? cohortId;
    }
  } catch (error) {
    try {
      await updateCampaignStatus(outbound.value.credentials, campaignId, "cancel");
    } catch {
      /* reported below; the campaign has no cohort either way */
    }
    return { ok: false, queued: 0, campaignId, csv, problem: `Sarvam did not accept the cohort: ${error instanceof Error ? error.message : error}` };
  }

  // Each reminder is now submitted to the campaign. The appointment-level result
  // arrives on the campaign webhook and is matched back by appointment id.
  const stamp = new Date().toISOString();
  for (const reminder of reminders) {
    saveReminder({
      ...reminder,
      status: "sent",
      lockedAt: null,
      dispatchMethod: "batch",
      providerCampaignId: campaignId,
      providerCohortId: cohortId,
      lastAttemptAt: stamp,
      attempts: reminder.attempts + 1,
      failureReason: null,
      skippedReason: null,
    });
  }
  audit(tenantId, "system", "reminders.dispatch_batch", campaignId, `${reminders.length} in cohort ${cohortId ?? "?"}`);
  return { ok: true, queued: reminders.length, campaignId, cohortId, csv };
}

/** Pause an active reminder campaign at Sarvam. */
export async function pauseReminderCampaign(tenantId: string, campaignId: string): Promise<{ ok: boolean; problem?: string }> {
  const outbound = tryResolveOutbound(tenantId);
  if (!outbound.ok) return { ok: false, problem: outbound.problems.join("; ") };
  try {
    await updateCampaignStatus(outbound.value.credentials, campaignId, "pause");
    audit(tenantId, "system", "reminders.campaign_paused", campaignId, null);
    return { ok: true };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : "The campaign could not be paused." };
  }
}

// ------------------------------------------------------------
// The daily run
// ------------------------------------------------------------

export async function runDailyReminders(
  tenantId: string,
  options: { date?: string; strategy?: Strategy; threshold?: number } = {}
): Promise<RunSummary> {
  const forDate = options.date ?? nextDay(tenantId);
  const set = collectEligibleReminders(tenantId, forDate);

  const base: RunSummary = {
    date: forDate,
    totalForDate: set.totalForDate,
    eligibleCount: set.eligible.length,
    skipped: set.skipped,
    method: "none",
    queued: 0,
  };

  if (set.eligible.length === 0) return base;

  const method = chooseStrategy(options.strategy ?? "auto", set.eligible.length, options.threshold ?? DEFAULT_BATCH_THRESHOLD);
  if (method === "instant") {
    return { ...base, method: "instant", queued: dispatchInstant(tenantId, set.eligible) };
  }

  const result = await dispatchBatch(tenantId, set.eligible);
  if (!result.ok) {
    // A failed batch leaves the appointments in the pending queue, unsubmitted.
    return { ...base, method: "batch", queued: 0, problem: result.problem };
  }
  return { ...base, method: "batch", queued: result.queued, campaignId: result.campaignId, cohortId: result.cohortId };
}

// ------------------------------------------------------------
// Batch result correlation (campaign webhook)
// ------------------------------------------------------------

/**
 * A campaign attempt for a reminder cohort, turned into the call record the
 * webhook pipeline then processes. Matched by the Sarvam campaign id and the
 * cohort's user_identifier (the appointment id). Returns null for any attempt
 * that is not one of Maya's reminder cohorts, so platform campaigns are
 * unaffected.
 */
export function recordForHospitalReminderAttempt(payload: {
  attempt_id?: string;
  campaign_id?: string;
  cohort_id?: string;
  user_identifier?: string;
  user_phone_number?: string;
  retry_attempt?: number;
  executed_at?: string | null;
}): CallRecord | null {
  if (!payload.campaign_id || !payload.user_identifier || !payload.attempt_id) return null;
  const reminder = findReminderByProviderCampaign(payload.campaign_id, payload.user_identifier);
  if (!reminder) return null;
  const appointment = getAppointment(reminder.tenantId, reminder.appointmentId);
  if (!appointment) return null;

  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Link the reminder to this call so the outcome handler finds it.
  saveReminder({ ...reminder, callId, attemptId: payload.attempt_id, status: "sent" });

  return {
    id: callId,
    tenantId: reminder.tenantId,
    leadId: appointment.patientLeadId,
    lead: { id: appointment.patientLeadId, name: appointment.patientName, phone: appointment.patientPhone } as never,
    status: "calling",
    startedAt: null,
    endedAt: null,
    requestedAt: payload.executed_at ?? new Date().toISOString(),
    connectedAt: null,
    duration: null,
    attempts: (payload.retry_attempt ?? 0) + 1,
    transcript: null,
    transcriptTurns: null,
    aiSummary: null,
    aiResult: null,
    lastContactedAt: null,
    nextAction: null,
    humanHandoffStatus: "none",
    provider: "sarvam",
    origin: "campaign",
    direction: "outbound",
    providerAttemptId: payload.attempt_id,
    providerCampaignId: payload.campaign_id,
    providerCohortId: payload.cohort_id ?? null,
    retryAttempt: payload.retry_attempt ?? 0,
  } as CallRecord;
}
