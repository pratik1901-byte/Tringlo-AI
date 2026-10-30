// ============================================================
// Tringlo AI — Appointment reminder: what the backend does with the result
// ============================================================
//
// A confirmation call has ended and Sarvam has reported it. Maya's spoken words
// are not authoritative here; the extracted variables she returned are read,
// validated, and only then allowed to change an appointment. The backend result
// is the record — "Maya said it's confirmed" is not.
//
// The rules this enforces, each because getting it wrong is a real harm:
//
//   - An appointment is confirmed ONLY on an explicit confirmation from a
//     patient whose identity the agent verified. An unverified caller, a wrong
//     number, an unclear reply or a no-answer changes nothing.
//   - "I can't make it" is never a cancellation. It is recorded, and a person
//     is asked to follow up. Cancelling needs explicit intent and the verified
//     cancellation workflow.
//   - A reschedule is actioned only when the chosen slot is still genuinely
//     free — `rescheduleAppointment` re-checks availability. If it is not, the
//     patient is not told it moved; a human follow-up is raised instead.
//   - A no-answer is not a confirmation. It returns the reminder to the queue
//     for one more try, up to the hospital's own limit.
//   - Nothing is processed twice: a reminder is acted on only while it is the
//     one this very call was placed for, and only once.
//
// This runs from the outbound webhook, after the call record is saved, and only
// ever for a hospital workspace that has a reminder linked to the call. Priya,
// TenWeb and every non-hospital workspace never reach this code.
// ============================================================

import { getAppointment, getReminderByCallId, saveReminder } from "@/lib/db";
import { isTerminalCallStatus, type CallRecord } from "@/lib/types";
import { requestCancellation } from "./cancellations";
import { isHospitalWorkspace } from "./context";
import { createFollowUp } from "./followups";
import { hospitalProfile, recordConfirmationOutcome, rescheduleAppointment } from "./service";
import type { ConfirmationOutcome } from "./types";

/** Minutes to wait before a no-answer confirmation call is tried again. */
const RETRY_DELAY_MINUTES = 30;

type Response = ConfirmationOutcome["response"];

export interface ReminderDecision {
  response: Response;
  identityVerified: boolean;
  doNotCall: boolean;
  humanHandoff: boolean;
  /** A concrete new slot the patient chose, if Maya extracted one. */
  newDate: string | null;
  newTime: string | null;
  selectedSlotId: string | null;
  /** True when the result could not be read as any known outcome. */
  needsReview: boolean;
  note: string | null;
}

export interface ReminderResult {
  handled: boolean;
  reason?: string;
  reminderId?: string;
  appointmentId?: string;
  response?: Response;
  action?: string;
  followUpId?: string;
  rescheduled?: boolean;
}

// ------------------------------------------------------------
// Reading Maya's extracted variables
// ------------------------------------------------------------

const str = (value: unknown): string => (value == null ? "" : String(value)).trim();

function isTrue(value: unknown): boolean {
  const v = str(value).toLowerCase();
  return v === "true" || v === "yes" || v === "y" || v === "1" || v === "verified" || v === "confirmed";
}

function has(haystack: string, ...needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

/** "YYYY-MM-DD" or null. */
function asDate(value: unknown): string | null {
  const v = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** "HH:MM" (24h) or null. */
function asTime(value: unknown): string | null {
  const v = str(value);
  const m = v.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${m[2]}`;
}

/**
 * Turns Maya's extracted output variables into one decision.
 *
 * `connected` is the provider's own account of whether the call was answered,
 * and it outranks anything in the variables: a call that never connected is a
 * no-answer no matter what stale variables came back with it.
 */
export function interpretReminderCall(
  outputVariables: Record<string, unknown> | null | undefined,
  connected: boolean
): ReminderDecision {
  const v = outputVariables ?? {};
  const base: ReminderDecision = {
    response: "unclear",
    identityVerified: isTrue(v.identity_verified),
    // Maya's own name is `opt_out_requested` / `human_handoff_requested`; the
    // platform's generic parser uses `do_not_call` / `human_handoff_required`.
    // Both are read so neither configuration is missed.
    doNotCall: isTrue(v.opt_out_requested) || isTrue(v.do_not_call),
    humanHandoff: isTrue(v.human_handoff_requested) || isTrue(v.human_handoff_required),
    newDate: asDate(v.new_appointment_date) ?? asDate(v.preferred_reschedule_date),
    newTime: asTime(v.new_appointment_time) ?? asTime(v.preferred_reschedule_time),
    selectedSlotId: str(v.selected_slot_id) || null,
    needsReview: false,
    note: str(v.patient_response) || str(v.call_summary) || null,
  };

  if (!connected) {
    return { ...base, response: "no_answer", note: base.note };
  }

  const confirmation = str(v.appointment_confirmation_status).toLowerCase();
  const attendance = str(v.attendance_status).toLowerCase();
  const reschedule = str(v.reschedule_requested);
  const disposition = str(v.call_disposition).toLowerCase();
  const nextAction = str(v.next_action).toLowerCase();
  const patientResponse = str(v.patient_response).toLowerCase();
  const combined = [confirmation, attendance, disposition, nextAction, patientResponse].join(" ");

  // What the result says, in order of how much it changes. An explicit cancel
  // and an explicit reschedule are read before a plain confirmation, because a
  // patient who says "actually, cancel it" has said something a "confirmed"
  // flag must not override.
  let response: Response;
  if (isTrue(reschedule) || has(combined, "reschedul", "change the appointment", "different time", "another time")) {
    response = "reschedule_requested";
  } else if (has(combined, "cancel")) {
    response = "cancel_requested";
  } else if (
    confirmation === "confirmed" ||
    confirmation === "confirm" ||
    attendance === "attending" ||
    attendance === "will attend" ||
    (isTrue(v.appointment_confirmation_status) && attendance !== "not attending")
  ) {
    response = "confirmed";
  } else if (has(combined, "not attending", "cannot attend", "can't attend", "won't attend", "will not attend", "declined", "no show")) {
    response = "declined";
  } else {
    // Connected, but nothing recognisable came back. Not treated as agreement.
    return { ...base, response: "unclear", needsReview: true };
  }

  // Identity is the gate on every action that changes a record. An unverified
  // caller (a wrong number, someone else in the house) is never allowed to
  // confirm, move or cancel an appointment, and no detail is acted on.
  const actionable = response === "confirmed" || response === "reschedule_requested" || response === "cancel_requested";
  if (actionable && !base.identityVerified) {
    return { ...base, response: "unclear", needsReview: true, note: base.note ?? "The caller's identity was not verified." };
  }

  return { ...base, response };
}

// ------------------------------------------------------------
// Applying the decision
// ------------------------------------------------------------

/**
 * Applies a finished confirmation call to its appointment, if there is one.
 *
 * Returns `{ handled: false }` for every call that is not a hospital
 * confirmation call, which is how non-hospital workspaces pass through
 * untouched.
 */
export async function applyReminderCallResult(call: CallRecord): Promise<ReminderResult> {
  const tenantId = call.tenantId ?? undefined;
  if (!tenantId || !isHospitalWorkspace(tenantId)) return { handled: false, reason: "not a hospital workspace" };

  const reminder = getReminderByCallId(tenantId, call.id);
  if (!reminder) return { handled: false, reason: "no reminder is linked to this call" };

  // Only the reminder this very call was placed for, and only while it is still
  // awaiting this call's result. Both guards together mean a redelivered
  // webhook, or a webhook for a superseded call, changes nothing.
  if (reminder.callId !== call.id) return { handled: false, reason: "the reminder has moved on from this call" };

  // An intermediate state (ringing, calling) is not an outcome. Acting on one
  // would read a no-answer into a call that has not finished — especially for a
  // batch campaign, whose first webhook is a "calling" event.
  if (!isTerminalCallStatus(call.status)) return { handled: false, reason: "the call has not reached a terminal state" };

  const connected = call.status === "connected";
  if (connected && reminder.outcome) return { handled: false, reason: "this confirmation call was already recorded" };
  if (!connected && reminder.status !== "sent") return { handled: false, reason: "this unanswered call was already handled" };

  const appointment = getAppointment(tenantId, reminder.appointmentId);
  if (!appointment) return { handled: false, reason: "the appointment no longer exists" };

  const decision = interpretReminderCall(call.outputVariables as Record<string, unknown> | null, connected);

  // A no-answer is not an outcome. It returns to the queue for one more try,
  // bounded by the hospital's own limit, and never marks the appointment.
  if (decision.response === "no_answer") {
    const profile = hospitalProfile(tenantId);
    const exhausted = reminder.attempts >= profile.reminderMaxAttempts;
    saveReminder({
      ...reminder,
      status: exhausted ? "failed" : "scheduled",
      lockedAt: null,
      dueAt: exhausted ? reminder.dueAt : new Date(Date.now() + RETRY_DELAY_MINUTES * 60_000).toISOString(),
      failureReason: exhausted ? `No answer after ${reminder.attempts} attempt(s).` : null,
      // Recorded so the results view can show it, only once there will be no
      // more tries — an outcome blocks further calls.
      outcome: exhausted
        ? { response: "no_answer", note: decision.note, recordedAt: new Date().toISOString(), action: "No answer; no more attempts will be made." }
        : null,
    });
    return {
      handled: true,
      reminderId: reminder.id,
      appointmentId: appointment.id,
      response: "no_answer",
      action: exhausted ? "failed_no_answer" : "requeued_for_retry",
    };
  }

  // Record what the patient said. This confirms the appointment on an explicit
  // confirmation and nothing else — the function enforces that, not this caller.
  const recorded = recordConfirmationOutcome(tenantId, reminder.id, { response: decision.response, note: decision.note }, "agent");
  if (!recorded.ok) return { handled: false, reason: recorded.problem };

  const result: ReminderResult = {
    handled: true,
    reminderId: reminder.id,
    appointmentId: appointment.id,
    response: decision.response,
    action: recorded.note,
  };

  // --- Reschedule: only when a concrete slot was chosen and is still free ---
  if (decision.response === "reschedule_requested") {
    if (decision.newDate && decision.newTime) {
      const moved = rescheduleAppointment(
        tenantId,
        appointment.id,
        { date: decision.newDate, time: decision.newTime, note: "Rescheduled by the patient on a confirmation call." },
        "agent"
      );
      if (moved.ok) {
        result.rescheduled = true;
        result.action = `Rescheduled to ${decision.newDate} ${decision.newTime}.`;
        return result;
      }
      // The chosen slot was gone, or the time could not be honoured. The
      // patient is not told it moved; a person picks this up.
      const fu = createFollowUp({
        tenantId,
        patientLeadId: appointment.patientLeadId,
        appointmentId: appointment.id,
        reason: `Reschedule could not be completed automatically (${moved.problem}). Patient wants to move their appointment.`,
        sourceCallId: call.id,
        preferredAt: null,
        actor: "agent",
        demo: appointment.demo,
      });
      if (fu.ok) result.followUpId = fu.followUp.id;
      result.action = `Reschedule needs a person: ${moved.problem}`;
      return result;
    }
    // Wanted to move, but gave no bookable slot. Hand to a person.
    const fu = createFollowUp({
      tenantId,
      patientLeadId: appointment.patientLeadId,
      appointmentId: appointment.id,
      reason: "Patient wants to reschedule but did not choose a specific slot on the call.",
      sourceCallId: call.id,
      preferredAt: null,
      actor: "agent",
      demo: appointment.demo,
    });
    if (fu.ok) result.followUpId = fu.followUp.id;
    return result;
  }

  // --- Cancellation: explicit intent only, through the verified workflow ---
  // The appointment is NOT cancelled here; a request is raised that the
  // hospital's system or staff must confirm. Its failure must not break the
  // webhook, so it is awaited inside a guard.
  if (decision.response === "cancel_requested") {
    try {
      await requestCancellation({
        tenantId,
        appointmentId: appointment.id,
        requestedVia: "confirmation_call",
        reason: decision.note || "Patient asked to cancel on the confirmation call.",
        actor: "agent",
        identityVerified: decision.identityVerified,
      });
    } catch (error) {
      console.error(
        `HOSPITAL_CANCELLATION_REQUEST_FAILED appointment=${appointment.id} ${error instanceof Error ? error.message : error}`
      );
    }
    return result;
  }

  // --- Declined / unclear / handoff: a person should look at it ---
  if (decision.response === "declined" || decision.response === "unclear" || decision.humanHandoff) {
    const reason =
      decision.response === "declined"
        ? "Patient said they will not attend and did not reschedule or cancel. Needs a person to follow up."
        : decision.needsReview
          ? "Confirmation call result could not be interpreted; needs review before any change."
          : "Confirmation call needs a person to follow up.";
    const fu = createFollowUp({
      tenantId,
      patientLeadId: appointment.patientLeadId,
      appointmentId: appointment.id,
      reason,
      sourceCallId: call.id,
      preferredAt: null,
      actor: "agent",
      demo: appointment.demo,
    });
    if (fu.ok) result.followUpId = fu.followUp.id;
  }

  return result;
}
