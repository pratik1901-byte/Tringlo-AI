// ============================================================
// Tringlo AI — Follow-up requests
// ============================================================
//
// "Can someone call me back about my test results?" — the request, from the
// moment it is made, whether or not anybody has arranged anything yet.
//
// That distinction is the whole design. Tringlo already has a FollowUp: the
// platform's own record of a callback the scheduler will dial. This is not
// that. This is the patient's ask, and `callbackId` is the link to a platform
// callback once one actually exists. Keeping them apart is what lets the agent
// say "I have passed this to the hospital" — true as soon as the request is
// stored — without saying "a doctor will ring you at four", which is only true
// once a callback has been scheduled and confirmed.
//
// What this module refuses to do:
//
//   - It will not mark a request as having a callback scheduled unless
//     scheduling it actually succeeded.
//   - It will not decide that a request is clinically urgent. `priority` is
//     "normal" unless a configured hospital rule raised it, and the rule is
//     named on the record.
//   - It will not create a second record for a request already made. A patient
//     who repeats themselves on the same call, or whose call dropped and rang
//     back, has one follow-up.
//   - It will not schedule a real callback for a demonstration patient.
// ============================================================

import {
  getHospitalFollowUp,
  getHospitalFollowUps,
  getLeads,
  saveFollowUp,
  saveHospitalFollowUp,
} from "@/lib/db";
import type { FollowUp as PlatformCallback, Lead } from "@/lib/types";
import { OPEN_FOLLOW_UP_STATUSES, type HospitalFollowUp, type HospitalFollowUpStatus } from "./records";
import { audit, hospitalProfile } from "./service";

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** How close two requests must be in time to count as the same one. */
const DUPLICATE_WINDOW_MS = 24 * 3600_000;

const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export interface FollowUpRequest {
  tenantId: string;
  patientLeadId: string;
  canonicalPatientId?: string | null;
  appointmentId?: string | null;
  /** What they want addressed, in their own words. */
  reason: string;
  sourceCallId?: string | null;
  /** When they would like to be rung, if they said. ISO instant. */
  preferredAt?: string | null;
  department?: string | null;
  actor: string;
  demo?: boolean;
}

export type CreateResult =
  | { ok: true; followUp: HospitalFollowUp; duplicate: boolean }
  | { ok: false; problem: string };

/**
 * Records a request to be contacted.
 *
 * Returns the existing one when the same patient has already asked about the
 * same thing recently, so the agent's confirmation is still honest and the
 * staff queue does not fill with the same ask three times.
 */
export function createFollowUp(request: FollowUpRequest): CreateResult {
  const reason = request.reason.trim();
  if (!reason) return { ok: false, problem: "A follow-up needs to say what the patient wants addressed." };

  const patient = getLeads().find((lead) => lead.tenantId === request.tenantId && lead.id === request.patientLeadId);
  if (!patient) return { ok: false, problem: "That patient is not in this hospital's records." };

  const since = Date.now() - DUPLICATE_WINDOW_MS;
  const duplicate = getHospitalFollowUps(request.tenantId).find(
    (entry) =>
      entry.patientLeadId === request.patientLeadId &&
      OPEN_FOLLOW_UP_STATUSES.includes(entry.status) &&
      new Date(entry.requestedAt).getTime() >= since &&
      normalise(entry.reason) === normalise(reason)
  );
  if (duplicate) return { ok: true, followUp: duplicate, duplicate: true };

  const now = new Date().toISOString();
  const priority = assessPriority(request.tenantId);
  const followUp = saveHospitalFollowUp({
    id: ID("fu"),
    tenantId: request.tenantId,
    canonicalPatientId: request.canonicalPatientId ?? null,
    patientLeadId: patient.id,
    patientName: patient.name,
    appointmentId: request.appointmentId ?? null,
    requestedAt: now,
    reason,
    sourceCallId: request.sourceCallId ?? null,
    preferredAt: request.preferredAt ?? null,
    priority: priority.priority,
    priorityRule: priority.rule,
    department: request.department ?? null,
    assignedTo: null,
    status: "new",
    outcome: null,
    callbackId: null,
    events: [{ at: now, actor: request.actor, action: "requested", detail: reason.slice(0, 160) }],
    createdAt: now,
    updatedAt: now,
    demo: Boolean(request.demo),
  });

  audit(request.tenantId, request.actor, "followup.requested", followUp.id, reason.slice(0, 160));
  return { ok: true, followUp, duplicate: false };
}

/**
 * Whether anything raises this request above normal.
 *
 * Nothing does, today, and that is the correct behaviour rather than a gap:
 * deciding that a described symptom is urgent is a clinical judgement, and a
 * hospital has to configure the rule before its agent acts on one. When a rule
 * is configured it will be named on the record, so a raised priority can
 * always be traced to the rule that raised it.
 */
function assessPriority(tenantId: string): { priority: "normal" | "raised"; rule: string | null } {
  void hospitalProfile(tenantId);
  return { priority: "normal", rule: null };
}

export type UpdateResult = { ok: true; followUp: HospitalFollowUp } | { ok: false; problem: string };

export function setFollowUpStatus(
  tenantId: string,
  id: string,
  status: HospitalFollowUpStatus,
  actor: string,
  detail?: { outcome?: string | null; note?: string | null }
): UpdateResult {
  const followUp = getHospitalFollowUp(tenantId, id);
  if (!followUp) return { ok: false, problem: "No such follow-up." };

  // Only the scheduler sets this, and only when a callback exists. Setting it
  // by hand would be the panel claiming a callback that was never arranged.
  if (status === "callback_scheduled" && !followUp.callbackId) {
    return {
      ok: false,
      problem: "No callback has been scheduled for this request yet. Schedule one, and the status follows.",
    };
  }

  const next = saveHospitalFollowUp({
    ...followUp,
    status,
    outcome: detail?.outcome ?? followUp.outcome,
    events: [
      ...followUp.events,
      { at: new Date().toISOString(), actor, action: `status_${status}`, detail: detail?.note ?? null },
    ],
  });
  audit(tenantId, actor, `followup.${status}`, id, detail?.note ?? null);
  return { ok: true, followUp: next };
}

export function assignFollowUp(
  tenantId: string,
  id: string,
  assignment: { assignedTo?: string | null; department?: string | null },
  actor: string
): UpdateResult {
  const followUp = getHospitalFollowUp(tenantId, id);
  if (!followUp) return { ok: false, problem: "No such follow-up." };

  const next = saveHospitalFollowUp({
    ...followUp,
    assignedTo: assignment.assignedTo ?? followUp.assignedTo,
    department: assignment.department ?? followUp.department,
    status: followUp.status === "new" || followUp.status === "pending_review" ? "assigned" : followUp.status,
    events: [
      ...followUp.events,
      {
        at: new Date().toISOString(),
        actor,
        action: "assigned",
        detail: [assignment.assignedTo, assignment.department].filter(Boolean).join(" · ") || null,
      },
    ],
  });
  audit(tenantId, actor, "followup.assigned", id, next.assignedTo ?? next.department ?? null);
  return { ok: true, followUp: next };
}

export type ScheduleResult =
  | { ok: true; followUp: HospitalFollowUp; callbackId: string }
  | { ok: false; problem: string };

/**
 * Arranges a callback through the platform's own scheduler.
 *
 * The status moves to `callback_scheduled` only once the callback row exists.
 * Everything that can stop it — no time, a time in the past, a patient who has
 * opted out, a demonstration record — stops it before anything is written, and
 * the request stays honestly unscheduled.
 */
export function scheduleCallback(
  tenantId: string,
  id: string,
  when: string,
  actor: string
): ScheduleResult {
  const followUp = getHospitalFollowUp(tenantId, id);
  if (!followUp) return { ok: false, problem: "No such follow-up." };
  if (followUp.callbackId) return { ok: false, problem: "A callback has already been scheduled for this request." };

  const at = new Date(when);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: "That callback time could not be read." };
  if (at.getTime() <= Date.now()) return { ok: false, problem: "That callback time has already passed." };

  const patient = getLeads().find((lead) => lead.tenantId === tenantId && lead.id === followUp.patientLeadId);
  if (!patient) return { ok: false, problem: "That patient is not in this hospital's records." };
  if (patient.suppressed) {
    return { ok: false, problem: "This patient has opted out of automated calls, so no callback is scheduled." };
  }
  if (followUp.demo) {
    // A demonstration record must never put a real number in the dialler.
    return {
      ok: false,
      problem: "This is a demonstration follow-up, so no real callback is scheduled. Nothing was dialled.",
    };
  }

  const profile = hospitalProfile(tenantId);
  const now = new Date().toISOString();
  const callbackId = `fu_hosp_${followUp.id}`;
  const callback: PlatformCallback = {
    id: callbackId,
    tenantId,
    leadId: patient.id,
    lead: patient as Lead,
    previousResponse: followUp.reason,
    interest: null,
    requestedCallback: followUp.preferredAt ?? when,
    scheduledTime: at.toISOString(),
    timezone: profile.timezone,
    status: "scheduled",
    nextAction: `Hospital follow-up: ${followUp.reason.slice(0, 120)}`,
    source: "manual",
    attemptId: null,
    callId: followUp.sourceCallId ?? null,
    interpretation: "Scheduled from a hospital follow-up request.",
    executionAttempts: 0,
    lockedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  let saved: PlatformCallback;
  try {
    saved = saveFollowUp(callback);
  } catch (failure) {
    return { ok: false, problem: failure instanceof Error ? failure.message : "The callback could not be scheduled." };
  }

  const next = saveHospitalFollowUp({
    ...followUp,
    callbackId: saved.id,
    status: "callback_scheduled",
    events: [...followUp.events, { at: now, actor, action: "callback_scheduled", detail: at.toISOString() }],
  });
  audit(tenantId, actor, "followup.callback_scheduled", id, at.toISOString());
  return { ok: true, followUp: next, callbackId: saved.id };
}

export function listFollowUps(tenantId: string): HospitalFollowUp[] {
  return getHospitalFollowUps(tenantId)
    .slice()
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
}

export function openFollowUps(tenantId: string): HospitalFollowUp[] {
  return listFollowUps(tenantId).filter((entry) => OPEN_FOLLOW_UP_STATUSES.includes(entry.status));
}
