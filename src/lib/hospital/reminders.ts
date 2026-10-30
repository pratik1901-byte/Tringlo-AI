// ============================================================
// Tringlo AI — Appointment confirmation call worker
// ============================================================
//
// The agent rings a patient about a day before their appointment and asks
// whether they still intend to come.
//
// These calls are placed by the server, on a timer that belongs to the server.
// Nothing here depends on a browser being open: an administrator who closes
// the panel on Friday evening still has Saturday's calls placed, and a restart
// mid-flight recovers rather than repeating.
//
// The safety rules, all enforced below rather than relied upon:
//
//   - A demonstration appointment is never dialled. It is marked, and the
//     worker treats the mark as final.
//   - Reminders are off until a hospital switches them on, and a hospital
//     with no provider configured cannot switch them into working.
//   - A patient who has opted out is not called, ever.
//   - One reminder, one call: a row is locked before dialling, so two passes
//     cannot both place it, and a restart mid-flight recovers rather than
//     repeats.
//   - A reminder is "sent" only when the provider accepted the call. Anything
//     else is a failure with the provider's own reason attached.
//   - Retries are bounded by the hospital's own setting.
//
// The call itself goes through the platform's existing Sarvam service with the
// workspace's own agent. There is no second provider client here.
// ============================================================

import {
  getAppointment,
  getDueReminders,
  getLeads,
  getOpenCancellationRequest,
  getWebhookBaseUrl,
  saveCallRecord,
  saveReminder,
} from "@/lib/db";
import { getAgentConfig } from "@/lib/db";
import { tryResolveOutbound } from "@/lib/providers/config";
import { sarvamVoiceService } from "@/lib/providers/sarvam/voice-agents";
import type { CallRecord } from "@/lib/types";
import { audit, hospitalProfile } from "./service";
import { reminderCallVariables } from "./reminder-variables";
import type { Reminder } from "./types";

/** How long a worker may hold a reminder before another pass may retry it. */
const LOCK_TIMEOUT_MS = 5 * 60_000;

export interface ReminderOutcome {
  reminderId: string;
  result: "called" | "skipped" | "failed";
  detail: string;
}

/**
 * Why this reminder cannot be called right now, or null if it can.
 *
 * Every answer is a sentence a person can act on, because they all end up in
 * front of one on the Reminders page.
 */
function blockedBecause(reminder: Reminder): string | null {
  if (reminder.demo) return "demonstration appointment — no real call is placed";

  const profile = hospitalProfile(reminder.tenantId);
  if (!profile.remindersEnabled) return "reminder calling is switched off for this hospital";

  const appointment = getAppointment(reminder.tenantId, reminder.appointmentId);
  if (!appointment) return "the appointment no longer exists";
  if (appointment.status === "cancelled") return "the appointment was cancelled";
  if (appointment.status === "completed" || appointment.status === "missed") {
    return `the appointment is already marked ${appointment.status}`;
  }
  if (appointment.demo) return "demonstration appointment — no real call is placed";

  const patient = getLeads().find((lead) => lead.id === appointment.patientLeadId);
  if (patient?.suppressed) return "the patient has opted out of automated calls";

  // Already asked and answered for this appointment time. The one guard that
  // stops a patient being rung twice about the same appointment — a retried
  // tick, a recovered lock, a worker restarted mid-pass.
  if (reminder.outcome && reminder.cycle === appointment.scheduledAt) {
    return `the patient has already answered this confirmation call (${reminder.outcome.response.replace(/_/g, " ")})`;
  }

  // A cancellation is with the hospital. Ringing to confirm an appointment
  // somebody has asked to cancel is the wrong call to make.
  if (getOpenCancellationRequest(reminder.tenantId, appointment.id)) {
    return "the patient has asked to cancel this appointment and the request is still open";
  }

  const provider = tryResolveOutbound(reminder.tenantId);
  if (!provider.ok) return `the voice provider is not configured: ${provider.problems.join("; ")}`;

  const base = getWebhookBaseUrl();
  if (!base || !/^https:\/\//i.test(base)) return "no public HTTPS address is registered for call results";

  return null;
}

/**
 * Places one reminder call.
 *
 * The reminder says only what a reminder needs to: who it is from, which
 * doctor, when. Nothing about why the patient is coming — a reminder is
 * overheard by whoever is in the room.
 */
async function placeReminderCall(reminder: Reminder): Promise<ReminderOutcome> {
  const appointment = getAppointment(reminder.tenantId, reminder.appointmentId)!;
  const profile = hospitalProfile(reminder.tenantId);
  const provider = tryResolveOutbound(reminder.tenantId);
  if (!provider.ok) {
    return { reminderId: reminder.id, result: "failed", detail: provider.problems.join("; ") };
  }

  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const agentConfig = getAgentConfig(reminder.tenantId);

  try {
    const placed = await sarvamVoiceService.startOutboundCall({
      provider: provider.value,
      tenantId: reminder.tenantId,
      leadId: appointment.patientLeadId,
      leadName: appointment.patientName,
      leadPhone: appointment.patientPhone,
      companyName: profile.name,
      agentConfig,
      // The appointment this call is about. Sent through the provider's agent-
      // variable mechanism; the provider sends only the names Maya declares, so
      // an undeclared field is simply not sent rather than rejected wholesale.
      customVariables: reminderCallVariables(appointment),
      webhookBaseUrl: getWebhookBaseUrl()!,
      callId,
    });

    // The record the call history and the webhook both hang off.
    saveCallRecord({
      id: callId,
      leadId: appointment.patientLeadId,
      tenantId: reminder.tenantId,
      lead: { id: appointment.patientLeadId, name: appointment.patientName, phone: appointment.patientPhone } as never,
      status: "initiating",
      provider: "sarvam",
      origin: "scheduler",
      direction: "outbound",
      attempts: reminder.attempts + 1,
      requestedAt: new Date().toISOString(),
      startedAt: null,
      connectedAt: null,
      endedAt: null,
      duration: null,
      transcript: null,
      transcriptTurns: null,
      aiSummary: null,
      aiResult: null,
      lastContactedAt: null,
      nextAction: null,
      humanHandoffStatus: "none",
      providerAttemptId: placed.attemptId,
      inputVariables: placed.inputVariables,
    } as CallRecord);

    saveReminder({
      ...reminder,
      status: "sent",
      attempts: reminder.attempts + 1,
      lastAttemptAt: new Date().toISOString(),
      lockedAt: null,
      callId,
      attemptId: placed.attemptId,
      failureReason: null,
    });
    audit(reminder.tenantId, "system", "reminder.called", reminder.id, `appointment ${appointment.id}`);
    return { reminderId: reminder.id, result: "called", detail: placed.attemptId };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const attempts = reminder.attempts + 1;
    const exhausted = attempts >= profile.reminderMaxAttempts;
    saveReminder({
      ...reminder,
      status: exhausted ? "failed" : "scheduled",
      attempts,
      lastAttemptAt: new Date().toISOString(),
      lockedAt: null,
      // A reminder worth retrying waits rather than looping: the next pass
      // after this time tries once more, and only up to the hospital's limit.
      dueAt: exhausted ? reminder.dueAt : new Date(Date.now() + 15 * 60_000).toISOString(),
      failureReason: detail.slice(0, 300),
    });
    console.error(`HOSPITAL_REMINDER_FAILED reminder=${reminder.id} attempts=${attempts} reason=${detail.slice(0, 160)}`);
    return { reminderId: reminder.id, result: "failed", detail };
  }
}

/**
 * One pass over every hospital's due reminders.
 *
 * Called by the platform scheduler that already places agreed callbacks, so
 * reminders survive a restart for the same reason those do.
 */
export async function runReminderTick(now = Date.now()): Promise<ReminderOutcome[]> {
  const due = getDueReminders(now, LOCK_TIMEOUT_MS);
  const outcomes: ReminderOutcome[] = [];

  for (const reminder of due) {
    // Claimed first. A second pass that starts while this one is dialling
    // sees the lock and leaves it alone.
    const claimed = saveReminder({ ...reminder, status: "calling", lockedAt: new Date().toISOString() });

    const blocked = blockedBecause(claimed);
    if (blocked) {
      saveReminder({ ...claimed, status: "skipped", lockedAt: null, skippedReason: blocked });
      outcomes.push({ reminderId: claimed.id, result: "skipped", detail: blocked });
      continue;
    }
    outcomes.push(await placeReminderCall(claimed));
  }

  if (outcomes.length) {
    console.log(`HOSPITAL_REMINDERS ran=${outcomes.length} called=${outcomes.filter((o) => o.result === "called").length}`);
  }
  return outcomes;
}
