// ============================================================
// Tringlo AI — Cancellation requests
// ============================================================
//
// A patient may ask to cancel at any hour, from any conversation. There is no
// window, no cut-off and no "you'll have to ring during office hours" in
// Tringlo: the request is always accepted.
//
// Accepted is not the same as done, and the gap between those two words is
// what this module is for. Whether an appointment can actually be cancelled is
// the hospital's decision, made by the hospital's system. So:
//
//   - `pending`   — recorded, not yet sent anywhere.
//   - `submitted` — sent, no answer yet.
//   - `confirmed` — the hospital's system said it is cancelled, or a member of
//                   staff confirmed it here. ONLY then is the appointment
//                   cancelled locally and its confirmation call stopped.
//   - `failed`    — it could not be put through. Kept, with the reason, and
//                   handed to staff.
//   - `rejected`  — the hospital's system declined it. Also handed to staff.
//
// The agent is told which of those happened and says the matching thing. What
// it must never say is that an appointment is cancelled while this record says
// `pending` — the patient would stop attending an appointment the hospital
// still has in its book.
// ============================================================

import {
  getAppointment,
  getCancellationRequest,
  getCancellationRequests,
  getOpenCancellationRequest,
  saveCancellationRequest,
} from "@/lib/db";
import { hospitalServer } from "./his";
import type { CancellationRequest } from "./records";
import { audit, cancelReminderFor, setAppointmentStatus } from "./service";

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export interface CancellationOutcome {
  request: CancellationRequest;
  /** True only when the appointment is genuinely cancelled. */
  cancelled: boolean;
  /** What the agent or the panel should say, in plain words. */
  message: string;
  /** Whether a person now has to deal with it. */
  needsStaff: boolean;
}

/**
 * Takes a cancellation request and tries to put it through.
 *
 * Idempotent per appointment: asking twice returns the request already in
 * flight rather than raising a second one, because two cancellations of one
 * appointment is at best noise in a staff queue and at worst two people
 * working on the same thing.
 */
export async function requestCancellation(options: {
  tenantId: string;
  appointmentId: string;
  canonicalPatientId?: string | null;
  requestedVia: CancellationRequest["requestedVia"];
  reason?: string | null;
  actor: string;
  /** Verified identity is required before an appointment is touched. */
  identityVerified: boolean;
}): Promise<CancellationOutcome | { error: string }> {
  const { tenantId, appointmentId } = options;
  const appointment = getAppointment(tenantId, appointmentId);
  if (!appointment) return { error: "That appointment is not in this hospital's records." };

  // Nothing about somebody's appointment is changed on the strength of a phone
  // number. Staff acting in the panel are already authenticated.
  if (!options.identityVerified) {
    return {
      error:
        "The caller's identity has not been verified, so no appointment is cancelled. Verify it by the hospital's process, or hand the call to staff.",
    };
  }

  if (appointment.status === "cancelled") {
    return {
      request: existingOrPlaceholder(tenantId, appointment.id, options),
      cancelled: true,
      message: "That appointment is already cancelled.",
      needsStaff: false,
    };
  }
  if (appointment.status === "completed") {
    return { error: "That appointment has already taken place, so it cannot be cancelled." };
  }

  const open = getOpenCancellationRequest(tenantId, appointmentId);
  if (open && open.status !== "failed") {
    return {
      request: open,
      cancelled: false,
      message:
        "A cancellation request for this appointment is already with the hospital. The patient does not need to ask again.",
      needsStaff: open.routedToStaff,
    };
  }

  const now = new Date().toISOString();
  const request = saveCancellationRequest(
    open
      ? { ...open, status: "pending", attempts: open.attempts, failureReason: null }
      : {
          id: ID("cx"),
          tenantId,
          appointmentId,
          canonicalPatientId: options.canonicalPatientId ?? null,
          patientLeadId: appointment.patientLeadId,
          requestedAt: now,
          requestedVia: options.requestedVia,
          reason: options.reason ?? null,
          status: "pending",
          attempts: 0,
          lastAttemptAt: null,
          failureReason: null,
          routedToStaff: false,
          resolvedAt: null,
          resolvedBy: null,
          demo: appointment.demo,
          createdAt: now,
          updatedAt: now,
        }
  );
  audit(tenantId, options.actor, "cancellation.requested", request.id, options.reason ?? null);

  return submit(tenantId, request.id, options.actor);
}

/**
 * Sends a pending request to the hospital's system.
 *
 * Separated out so a failed request can be retried from the panel without
 * going back through the identity checks a patient already passed.
 */
export async function submit(tenantId: string, requestId: string, actor: string): Promise<CancellationOutcome | { error: string }> {
  const request = getCancellationRequest(tenantId, requestId);
  if (!request) return { error: "No such cancellation request." };
  if (request.status === "confirmed") {
    return { request, cancelled: true, message: "That appointment is cancelled.", needsStaff: false };
  }

  const server = hospitalServer(tenantId);
  const attempted = saveCancellationRequest({
    ...request,
    status: "submitted",
    attempts: request.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
  });

  if (!server.supports("appointment_cancel")) {
    return route(
      tenantId,
      attempted,
      actor,
      "The hospital's system cannot be sent cancellations from here, so the request has been passed to hospital staff.",
      "The hospital's API does not offer appointment cancellation."
    );
  }

  const result = await server.cancelAppointment(request.appointmentId, request.reason);

  if (!result.ok) {
    const declined = result.code === "rejected" || result.code === "not_found";
    const stored = saveCancellationRequest({
      ...attempted,
      status: declined ? "rejected" : "failed",
      failureReason: result.problem,
      routedToStaff: true,
    });
    audit(tenantId, actor, declined ? "cancellation.rejected" : "cancellation.failed", stored.id, result.problem);
    return {
      request: stored,
      cancelled: false,
      message: declined
        ? `The hospital's system did not accept the cancellation: ${result.problem} It has been passed to hospital staff.`
        : "The cancellation could not be put through to the hospital's system. The request has been recorded and passed to hospital staff; the appointment still stands for now.",
      needsStaff: true,
    };
  }

  return confirm(tenantId, attempted.id, actor, `the hospital's system reported ${result.data.status}`);
}

/**
 * Marks a request confirmed and cancels the appointment.
 *
 * The only place an appointment is cancelled off the back of a request, and it
 * runs only after a destination has confirmed it — or a member of staff has,
 * which is the manual path for a hospital whose API cannot take cancellations.
 */
export async function confirm(
  tenantId: string,
  requestId: string,
  actor: string,
  because: string
): Promise<CancellationOutcome | { error: string }> {
  const request = getCancellationRequest(tenantId, requestId);
  if (!request) return { error: "No such cancellation request." };

  const changed = setAppointmentStatus(
    tenantId,
    request.appointmentId,
    "cancelled",
    actor,
    request.reason ?? "Cancelled at the patient's request."
  );
  if (!changed.ok) return { error: changed.problem };

  // The appointment is gone, so nothing should ring anybody about it.
  cancelReminderFor(tenantId, request.appointmentId, "the appointment was cancelled at the patient's request");

  const confirmed = saveCancellationRequest({
    ...request,
    status: "confirmed",
    failureReason: null,
    routedToStaff: false,
    resolvedAt: new Date().toISOString(),
    resolvedBy: actor,
  });
  audit(tenantId, actor, "cancellation.confirmed", confirmed.id, because);

  return {
    request: confirmed,
    cancelled: true,
    message: "The appointment is cancelled, and no reminder call will be made about it.",
    needsStaff: false,
  };
}

/** Hands a request to staff, keeping why. */
function route(
  tenantId: string,
  request: CancellationRequest,
  actor: string,
  message: string,
  problem: string
): CancellationOutcome {
  const stored = saveCancellationRequest({ ...request, status: "failed", failureReason: problem, routedToStaff: true });
  audit(tenantId, actor, "cancellation.routed_to_staff", stored.id, problem);
  return { request: stored, cancelled: false, message, needsStaff: true };
}

function existingOrPlaceholder(
  tenantId: string,
  appointmentId: string,
  options: { requestedVia: CancellationRequest["requestedVia"]; reason?: string | null; canonicalPatientId?: string | null }
): CancellationRequest {
  const existing = getCancellationRequests(tenantId).find((row) => row.appointmentId === appointmentId);
  if (existing) return existing;
  const appointment = getAppointment(tenantId, appointmentId)!;
  const now = new Date().toISOString();
  return saveCancellationRequest({
    id: ID("cx"),
    tenantId,
    appointmentId,
    canonicalPatientId: options.canonicalPatientId ?? null,
    patientLeadId: appointment.patientLeadId,
    requestedAt: now,
    requestedVia: options.requestedVia,
    reason: options.reason ?? null,
    status: "confirmed",
    attempts: 0,
    lastAttemptAt: null,
    failureReason: null,
    routedToStaff: false,
    resolvedAt: now,
    resolvedBy: "system",
    demo: appointment.demo,
    createdAt: now,
    updatedAt: now,
  });
}

export function listCancellationRequests(tenantId: string): CancellationRequest[] {
  return getCancellationRequests(tenantId)
    .slice()
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

/** Requests a person still has to do something about. */
export function pendingCancellations(tenantId: string): CancellationRequest[] {
  return listCancellationRequests(tenantId).filter(
    (request) => request.status === "pending" || request.status === "submitted" || request.status === "failed" || request.status === "rejected"
  );
}
