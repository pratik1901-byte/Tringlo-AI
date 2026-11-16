// ============================================================
// Tringlo AI — Hospital operations service
// ============================================================
//
// Everything the hospital panel and the agent both need, in one place, so a
// booking made by a person and one made by the agent on a call go through the
// same checks and leave the same trail.
//
// Two rules this module exists to keep:
//
//   1. A slot is offered only if it is genuinely free. Availability is
//      recomputed from the doctor's current schedule and the appointments
//      that exist right now — never from a cached list and never from
//      anything the model was told earlier in the call.
//
//   2. A booking is rechecked at the moment it is written. A caller can be
//      offered 11:00, spend two minutes deciding, and have a colleague take
//      it meanwhile; the write refuses rather than double-books.
//
// Times are stored as UTC instants and reasoned about in the hospital's
// timezone, which is configuration, not a constant.
// ============================================================

import {
  deleteAppointment as dbDeleteAppointment,
  getAppointment,
  getAppointments,
  getHospitalProfile,
  getLeads,
  getReminder,
  getReminderForAppointment,
  recordAppointmentEvent,
  recordHospitalAudit,
  saveAppointment,
  saveHospitalProfile,
  saveLead,
  saveReminder,
} from "@/lib/db";
import { normalisePhone } from "@/lib/customers/identity";
import { consultingProviders, providerFor } from "./directory";
import type { Lead } from "@/lib/types";
import {
  OPEN_APPOINTMENT_STATUSES,
  defaultHospitalProfile,
  type Appointment,
  type AppointmentStatus,
  type ConfirmationOutcome,
  type HospitalProfile,
  type Reminder,
  type Weekday,
} from "./types";

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

// ------------------------------------------------------------
// Time, in the hospital's zone
// ------------------------------------------------------------

/** The parts of an instant as they read in a timezone. */
function partsIn(instant: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "long",
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday as Weekday,
  };
}

/** The offset a timezone was at on a given instant, in minutes. */
function offsetMinutes(instant: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - instant.getTime()) / 60000;
}

/**
 * The instant at which a local date and time occurs in a timezone.
 *
 * Done by guessing from the zone's current offset and correcting once, which
 * settles even across a daylight-saving change. India does not observe one,
 * but the hospital's timezone is configuration and may not be India.
 */
export function instantFor(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  const firstGuess = new Date(naive - offsetMinutes(new Date(naive), timezone) * 60000);
  return new Date(naive - offsetMinutes(firstGuess, timezone) * 60000);
}

export function localDate(instant: string | Date, timezone: string): string {
  return partsIn(new Date(instant), timezone).date;
}

export function localTime(instant: string | Date, timezone: string): string {
  return partsIn(new Date(instant), timezone).time;
}

const toMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const fromMinutes = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// ------------------------------------------------------------
// The hospital itself
// ------------------------------------------------------------

/** The hospital's settings, created empty on first use rather than guessed at. */
/**
 * The hospital's settings — WITHOUT creating them.
 *
 * It used to save a profile the first time anything asked for one, and that
 * was a quiet mistake: every read made a workspace look slightly more like a
 * hospital, so a panel pointed at the wrong workspace turned that workspace
 * into a hospital merely by being opened. A workspace becomes a hospital when
 * somebody says so — see `enableHospital` — and until then this hands back
 * defaults that nothing has written down.
 */
export function hospitalProfile(tenantId: string, name?: string): HospitalProfile {
  return getHospitalProfile(tenantId) ?? defaultHospitalProfile(tenantId, name);
}

/**
 * Turns this workspace into a hospital, once, deliberately.
 *
 * The one place a hospital profile is created. Enabling is explicit so that
 * "is this a hospital?" has an answer somebody chose, rather than one that
 * accumulated.
 */
export function enableHospital(tenantId: string, name: string, actor: string): HospitalProfile {
  const existing = getHospitalProfile(tenantId);
  const profile = saveHospitalProfile({
    ...(existing ?? defaultHospitalProfile(tenantId, name)),
    name: existing?.name ?? name,
    enabled: true,
  });
  audit(tenantId, actor, "hospital.enabled", tenantId, name);
  return profile;
}

export function disableHospital(tenantId: string, actor: string): HospitalProfile | null {
  const existing = getHospitalProfile(tenantId);
  if (!existing) return null;
  // Nothing is deleted: the appointments, histories and calls stay exactly
  // where they are, and turning it back on finds them again.
  const profile = saveHospitalProfile({ ...existing, enabled: false });
  audit(tenantId, actor, "hospital.disabled", tenantId, null);
  return profile;
}

export function updateHospitalProfile(tenantId: string, changes: Partial<HospitalProfile>, actor: string): HospitalProfile {
  const current = hospitalProfile(tenantId);
  const next = saveHospitalProfile({
    ...current,
    ...changes,
    tenantId: current.tenantId,
    createdAt: current.createdAt,
  });
  audit(tenantId, actor, "hospital.settings_changed", "profile", Object.keys(changes).join(", "));
  return next;
}

export function audit(tenantId: string, actor: string, action: string, subject: string, detail?: string | null): void {
  recordHospitalAudit({
    id: ID("aud"),
    tenantId,
    at: new Date().toISOString(),
    actor,
    action,
    subject,
    detail: detail ?? null,
  });
}

// ------------------------------------------------------------
// Availability
// ------------------------------------------------------------

export interface Slot {
  /** "HH:MM" in the hospital's timezone. */
  time: string;
  /** The instant it begins. */
  at: string;
  available: boolean;
  /** Why not, when it is not. */
  reason?: "booked" | "break" | "past";
}

/**
 * The slots a doctor has on one local date.
 *
 * The doctor and their hours come from the hospital's own system, through the
 * provider directory — Tringlo keeps no schedule of its own to disagree with
 * it. What Tringlo does know is which of those slots it has already booked,
 * and that is what narrows the list.
 *
 * A provider the hospital is not listing as accepting appointments has no
 * slots at all, and neither does one on a date the hospital says they are
 * away.
 */
export function slotsFor(tenantId: string, doctorId: string, date: string, now = new Date()): Slot[] {
  const provider = providerFor(tenantId, doctorId);
  if (!provider || !provider.accepting) return [];
  const profile = hospitalProfile(tenantId);
  const timezone = profile.timezone;

  if (provider.unavailableDates.includes(date)) return [];

  const weekday = partsIn(instantFor(date, "12:00", timezone), timezone).weekday;
  const special = provider.specialHours.find((entry) => entry.date === date);
  const hours = special
    ? { start: special.start, end: special.end }
    : provider.days.includes(weekday) && provider.hours
      ? provider.hours
      : null;
  if (!hours) return [];

  const taken = new Set(
    getAppointments(tenantId)
      .filter(
        (appointment) =>
          appointment.doctorId === doctorId &&
          OPEN_APPOINTMENT_STATUSES.includes(appointment.status) &&
          localDate(appointment.scheduledAt, timezone) === date
      )
      .map((appointment) => localTime(appointment.scheduledAt, timezone))
  );

  const slots: Slot[] = [];
  const step = Math.max(5, provider.slotMinutes);
  for (let minute = toMinutes(hours.start); minute + step <= toMinutes(hours.end); minute += step) {
    const time = fromMinutes(minute);
    const at = instantFor(date, time, timezone);

    const inBreak = provider.breaks.some(
      (gap) => minute < toMinutes(gap.end) && minute + step > toMinutes(gap.start)
    );
    const past = at.getTime() <= now.getTime();
    const booked = taken.has(time);

    slots.push({
      time,
      at: at.toISOString(),
      available: !inBreak && !past && !booked,
      ...(booked ? { reason: "booked" as const } : inBreak ? { reason: "break" as const } : past ? { reason: "past" as const } : {}),
    });
  }
  return slots;
}

/** Doctors who have at least one free slot on a date, with those slots. */
export function availabilityFor(tenantId: string, date: string, options: { specialty?: string; doctorId?: string } = {}) {
  const matching = consultingProviders(tenantId).filter((provider) => {
    if (options.doctorId && provider.id !== options.doctorId) return false;
    if (options.specialty && provider.specialty.toLowerCase() !== options.specialty.toLowerCase()) return false;
    return true;
  });

  return matching.map((provider) => {
    const slots = slotsFor(tenantId, provider.id, date);
    return {
      doctorId: provider.id,
      doctorName: provider.name,
      specialty: provider.specialty,
      slots: slots.filter((slot) => slot.available).map((slot) => ({ time: slot.time, at: slot.at })),
    };
  });
}

// ------------------------------------------------------------
// Patients
// ------------------------------------------------------------

/**
 * The patient a number belongs to in this hospital, creating the record on
 * first contact.
 *
 * Patients are Tringlo leads: the same record the call history and the
 * customer's memory already hang off, matched on the normalised number within
 * this workspace alone. A number known to another hospital is a different
 * person here, and is never joined up.
 */
export function patientFor(tenantId: string, phone: string, name?: string): Lead {
  const normalised = normalisePhone(phone);
  const existing = getLeads().find(
    (lead) => lead.tenantId === tenantId && normalisePhone(lead.phone).national === normalised.national
  );
  if (existing) {
    if (name && name.trim() && existing.name !== name.trim()) {
      return saveLead({ ...existing, name: name.trim() });
    }
    return existing;
  }

  return saveLead({
    id: ID("lead"),
    tenantId,
    name: (name || "").trim() || "Unknown caller",
    phone: normalised.e164 ?? phone,
    status: "queued",
    suppressed: false,
    source: "manual",
    createdAt: new Date().toISOString(),
    callingDate: "",
    callingTime: "",
    timezone: hospitalProfile(tenantId).timezone,
  } as Lead);
}

// ------------------------------------------------------------
// Appointments
// ------------------------------------------------------------

export interface BookingRequest {
  tenantId: string;
  doctorId: string;
  /** "YYYY-MM-DD" and "HH:MM" in the hospital's timezone. */
  date: string;
  time: string;
  patientName: string;
  patientPhone: string;
  reason?: string | null;
  source?: Appointment["source"];
  status?: AppointmentStatus;
  callId?: string | null;
  demo?: boolean;
  actor: string;
}

export type BookingResult =
  | { ok: true; appointment: Appointment; reminder: Reminder | null }
  | { ok: false; problem: string };

/**
 * Books an appointment, rechecking the slot as it writes.
 *
 * The recheck is the point: availability shown a moment ago is a fact about a
 * moment ago. Between offering 11:00 and confirming it, a colleague at the
 * desk or another caller may have taken it, and the booking must lose rather
 * than double-book the doctor.
 */
export function bookAppointment(request: BookingRequest): BookingResult {
  const { tenantId } = request;
  const doctor = providerFor(tenantId, request.doctorId);
  if (!doctor) return { ok: false, problem: "That doctor is not in the hospital's directory." };
  if (!doctor.accepting) return { ok: false, problem: `${doctor.name} is not taking appointments.` };

  const profile = hospitalProfile(tenantId);
  const at = instantFor(request.date, request.time, profile.timezone);
  if (Number.isNaN(at.getTime())) return { ok: false, problem: "That date and time could not be read." };

  // Rechecked here, against what is true now.
  const slots = slotsFor(tenantId, doctor.id, request.date);
  const slot = slots.find((entry) => entry.time === request.time);
  if (!slot) return { ok: false, problem: `${doctor.name} does not consult at ${request.time} on ${request.date}.` };
  if (!slot.available) {
    const reason =
      slot.reason === "booked"
        ? "that slot has just been taken"
        : slot.reason === "break"
          ? "that time falls in a break"
          : "that time has passed";
    return { ok: false, problem: `Not booked — ${reason}. Choose another time.` };
  }

  const patient = patientFor(tenantId, request.patientPhone, request.patientName);
  const now = new Date().toISOString();
  const appointment = saveAppointment({
    id: ID("apt"),
    tenantId,
    doctorId: doctor.id,
    patientLeadId: patient.id,
    patientName: patient.name,
    patientPhone: patient.phone,
    specialty: doctor.specialty,
    scheduledAt: at.toISOString(),
    durationMinutes: doctor.slotMinutes,
    status: request.status ?? "confirmed",
    source: request.source ?? "staff",
    reason: request.reason ?? null,
    statusNote: null,
    callId: request.callId ?? null,
    demo: Boolean(request.demo),
    createdAt: now,
    updatedAt: now,
  });

  recordAppointmentEvent({
    id: ID("ae"),
    tenantId,
    appointmentId: appointment.id,
    at: now,
    actor: request.actor,
    action: "created",
    to: appointment.scheduledAt,
    note: request.reason ?? null,
  });
  audit(tenantId, request.actor, "appointment.created", appointment.id, `${doctor.name} · ${request.date} ${request.time}`);

  return { ok: true, appointment, reminder: scheduleReminderFor(appointment) };
}

export type ChangeResult = { ok: true; appointment: Appointment; reminder: Reminder | null } | { ok: false; problem: string };

/** Moves an appointment, rechecking the new slot and re-timing its reminder. */
export function rescheduleAppointment(
  tenantId: string,
  appointmentId: string,
  changes: { doctorId?: string; date: string; time: string; note?: string | null },
  actor: string
): ChangeResult {
  const appointment = getAppointment(tenantId, appointmentId);
  if (!appointment) return { ok: false, problem: "That appointment is not in this hospital's records." };

  const doctorId = changes.doctorId ?? appointment.doctorId;
  const doctor = providerFor(tenantId, doctorId);
  if (!doctor) return { ok: false, problem: "That doctor is not in the hospital's directory." };
  if (!doctor.accepting) return { ok: false, problem: `${doctor.name} is not taking appointments.` };

  const profile = hospitalProfile(tenantId);
  const slots = slotsFor(tenantId, doctorId, changes.date);
  const slot = slots.find((entry) => entry.time === changes.time);
  const movingWithinItself =
    doctorId === appointment.doctorId &&
    localDate(appointment.scheduledAt, profile.timezone) === changes.date &&
    localTime(appointment.scheduledAt, profile.timezone) === changes.time;

  // Already there: a repeated request (a retried tool call, a redelivered
  // result) must not move it "again", add history or re-time its reminder.
  if (movingWithinItself) {
    return { ok: true, appointment, reminder: getReminderForAppointment(tenantId, appointment.id) ?? null };
  }
  if (!slot) return { ok: false, problem: `${doctor.name} does not consult at ${changes.time} on ${changes.date}.` };
  if (!slot.available) return { ok: false, problem: "That slot is no longer free. Choose another time." };

  const from = appointment.scheduledAt;
  const at = instantFor(changes.date, changes.time, profile.timezone);
  const next = saveAppointment({
    ...appointment,
    doctorId,
    specialty: doctor.specialty,
    scheduledAt: at.toISOString(),
    durationMinutes: doctor.slotMinutes,
    status: "rescheduled",
    statusNote: changes.note ?? appointment.statusNote ?? null,
  });

  recordAppointmentEvent({
    id: ID("ae"),
    tenantId,
    appointmentId: next.id,
    at: new Date().toISOString(),
    actor,
    action: "rescheduled",
    from,
    to: next.scheduledAt,
    note: changes.note ?? null,
  });
  audit(tenantId, actor, "appointment.rescheduled", next.id, `${from} → ${next.scheduledAt}`);

  // The agent moving an appointment DURING a confirmation call about it. That
  // reminder belongs to the call still in progress: re-timing it here would
  // unlink it from the call, so the call's outcome would be lost when it
  // arrives and the patient would be rung again about a time they just chose.
  // It is left as it is; the post-call result records the outcome.
  const inFlight = getReminderForAppointment(tenantId, next.id);
  if (actor === "agent" && inFlight && (inFlight.status === "sent" || inFlight.status === "calling") && !inFlight.outcome) {
    return { ok: true, appointment: next, reminder: inFlight };
  }

  // The old reminder was for a time that no longer exists.
  cancelReminderFor(tenantId, next.id, "the appointment moved");
  return { ok: true, appointment: next, reminder: scheduleReminderFor(next) };
}

/** Sets a status. A cancellation stops the reminder; nothing is deleted. */
export function setAppointmentStatus(
  tenantId: string,
  appointmentId: string,
  status: AppointmentStatus,
  actor: string,
  note?: string | null
): ChangeResult {
  const appointment = getAppointment(tenantId, appointmentId);
  if (!appointment) return { ok: false, problem: "That appointment is not in this hospital's records." };

  const next = saveAppointment({ ...appointment, status, statusNote: note ?? appointment.statusNote ?? null });
  recordAppointmentEvent({
    id: ID("ae"),
    tenantId,
    appointmentId: next.id,
    at: new Date().toISOString(),
    actor,
    action: status === "cancelled" ? "cancelled" : status === "completed" ? "completed" : status === "missed" ? "missed" : "confirmed",
    from: appointment.status,
    to: status,
    note: note ?? null,
  });
  audit(tenantId, actor, `appointment.${status}`, next.id, note ?? null);

  if (status === "cancelled" || status === "completed" || status === "missed") {
    cancelReminderFor(tenantId, next.id, `the appointment was ${status}`);
  }
  return { ok: true, appointment: next, reminder: getReminderForAppointment(tenantId, next.id) ?? null };
}

/**
 * Removes an appointment outright.
 *
 * Its events stay, and so do any calls it produced: a record that someone
 * deleted a booking is worth more than a tidy table. The pending reminder is
 * cancelled first, so nothing is dialled for an appointment that is gone.
 */
export function removeAppointment(tenantId: string, appointmentId: string, actor: string, note?: string | null): boolean {
  const appointment = getAppointment(tenantId, appointmentId);
  if (!appointment) return false;
  cancelReminderFor(tenantId, appointmentId, "the appointment was deleted");
  recordAppointmentEvent({
    id: ID("ae"),
    tenantId,
    appointmentId,
    at: new Date().toISOString(),
    actor,
    action: "deleted",
    from: appointment.scheduledAt,
    note: note ?? null,
  });
  audit(tenantId, actor, "appointment.deleted", appointmentId, note ?? null);
  return dbDeleteAppointment(tenantId, appointmentId);
}

// ------------------------------------------------------------
// Reminders
// ------------------------------------------------------------

/**
 * The shortest notice a confirmation call is placed at.
 *
 * An appointment booked for this afternoon still gets a confirmation call, but
 * not in the same breath as the booking: a quarter of an hour's grace means
 * the patient is off the phone before it rings, and a correction made right
 * after booking has time to land.
 */
const SOONEST_CONFIRMATION_MINUTES = 15;

/**
 * Schedules the confirmation call for an appointment, if one is owed.
 *
 * Owed means: the appointment is still standing, the patient has not opted
 * out, and there is still time to ring them before it.
 *
 * Normally that is the hospital's lead time before the appointment — a day, by
 * default. An appointment booked INSIDE that window still gets a call, placed
 * as soon as is reasonable rather than skipped, because a confirmation is most
 * useful precisely for the appointment somebody booked this morning for this
 * afternoon. What gets no call is an appointment too close to ring about at
 * all, and that is recorded as skipped with the reason rather than dropped.
 *
 * One call per appointment per cycle. Rescheduling makes a new cycle, and the
 * old one is cancelled; calling this twice for the same cycle updates the one
 * record rather than making a second.
 *
 * A demonstration appointment gets a record, so the page is honest about what
 * would happen, marked `demo` so the worker never dials it.
 */
export function scheduleReminderFor(appointment: Appointment): Reminder | null {
  const profile = hospitalProfile(appointment.tenantId);
  if (!OPEN_APPOINTMENT_STATUSES.includes(appointment.status)) return null;

  const patient = getLeads().find((lead) => lead.id === appointment.patientLeadId);
  const optedOut = Boolean(patient?.suppressed);

  const now = Date.now();
  const appointmentAt = new Date(appointment.scheduledAt).getTime();
  const preferred = appointmentAt - profile.reminderLeadHours * 3600_000;
  const soonest = now + SOONEST_CONFIRMATION_MINUTES * 60_000;
  // Either the usual lead time, or as soon as reasonable for one booked late.
  const dueAt = new Date(Math.max(preferred, soonest));
  const lateBooking = preferred < soonest;

  const existing = getReminderForAppointment(appointment.tenantId, appointment.id);
  const sameCycle = existing?.cycle === appointment.scheduledAt;

  const base: Reminder = {
    id: existing?.id ?? ID("rem"),
    tenantId: appointment.tenantId,
    appointmentId: appointment.id,
    kind: "confirmation",
    cycle: appointment.scheduledAt,
    // A new cycle starts with a clean outcome; the old one went with the old
    // appointment time.
    outcome: sameCycle ? existing?.outcome ?? null : null,
    dueAt: dueAt.toISOString(),
    status: "scheduled",
    attempts: sameCycle ? existing?.attempts ?? 0 : 0,
    lastAttemptAt: sameCycle ? existing?.lastAttemptAt ?? null : null,
    lockedAt: null,
    callId: null,
    attemptId: null,
    failureReason: null,
    skippedReason: null,
    demo: appointment.demo,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (optedOut) {
    return saveReminder({ ...base, status: "skipped", skippedReason: "the patient has opted out of automated calls" });
  }
  if (dueAt.getTime() >= appointmentAt) {
    return saveReminder({
      ...base,
      status: "skipped",
      skippedReason:
        appointmentAt <= now
          ? "the appointment time has passed, so there is nothing to confirm"
          : "the appointment is too soon to place a confirmation call before it",
    });
  }
  if (lateBooking) {
    // Said out loud, because a call arriving fifteen minutes after a booking
    // looks like a fault unless the record explains it.
    return saveReminder({
      ...base,
      skippedReason: null,
      failureReason: null,
      status: "scheduled",
      cycle: appointment.scheduledAt,
      outcome: base.outcome,
      dueAt: dueAt.toISOString(),
    });
  }
  return saveReminder(base);
}

export type OutcomeResult =
  | { ok: true; reminder: Reminder; appointmentConfirmed: boolean; note: string }
  | { ok: false; problem: string };

/**
 * Records what the patient said on a confirmation call.
 *
 * The appointment is marked confirmed on one answer and one only: an explicit
 * confirmation. A no-answer, a voicemail or an ambiguous reply is recorded as
 * what it was and changes nothing about the appointment — a hospital reading
 * "confirmed" needs that to mean a person said yes.
 *
 * A request to cancel or move is recorded here and goes no further: acting on
 * it is the cancellation workflow's job, which checks identity and the
 * hospital's own system before anything is changed.
 */
export function recordConfirmationOutcome(
  tenantId: string,
  reminderId: string,
  outcome: {
    response: ConfirmationOutcome["response"];
    note?: string | null;
    /** What was done, when the agent already acted on the request during the call. */
    action?: string;
  },
  actor: string
): OutcomeResult {
  const reminder = getReminder(tenantId, reminderId);
  if (!reminder) return { ok: false, problem: "No such confirmation call." };
  const appointment = getAppointment(tenantId, reminder.appointmentId);
  if (!appointment) return { ok: false, problem: "That appointment is no longer in this hospital's records." };

  let appointmentConfirmed = false;
  let action: string;

  switch (outcome.response) {
    case "confirmed":
      if (OPEN_APPOINTMENT_STATUSES.includes(appointment.status)) {
        setAppointmentStatus(tenantId, appointment.id, "confirmed", actor, "Confirmed by the patient on a confirmation call.");
        appointmentConfirmed = true;
        action = "The appointment was marked confirmed.";
      } else {
        action = `The appointment is ${appointment.status}, so it was left as it is.`;
      }
      break;
    case "cancel_requested":
      action = "A cancellation request was raised for staff and the hospital's system; the appointment stands until that is confirmed.";
      break;
    case "reschedule_requested":
      action = "The patient asked to move the appointment; it stands until a new time is booked.";
      break;
    case "declined":
      action = "The patient said they will not attend. The appointment was left as it is for staff to deal with.";
      break;
    case "no_answer":
      action = "Nobody answered, so the appointment was left as it is.";
      break;
    default:
      action = "The reply was not clear, so the appointment was left as it is.";
      break;
  }

  if (outcome.action) action = outcome.action;

  const next = saveReminder({
    ...reminder,
    outcome: {
      response: outcome.response,
      note: outcome.note?.trim() || null,
      recordedAt: new Date().toISOString(),
      action,
    },
  });
  audit(tenantId, actor, `confirmation.${outcome.response}`, reminder.id, outcome.note?.slice(0, 160) ?? null);
  return { ok: true, reminder: next, appointmentConfirmed, note: action };
}

export function cancelReminderFor(tenantId: string, appointmentId: string, why: string): void {
  const reminder = getReminderForAppointment(tenantId, appointmentId);
  if (!reminder) return;
  if (reminder.status === "sent" || reminder.status === "cancelled") return;
  saveReminder({ ...reminder, status: "cancelled", lockedAt: null, failureReason: null, skippedReason: why });
}

/** Everything the panel shows about one reminder, joined up. */
export function reminderView(tenantId: string, reminder: Reminder) {
  const appointment = getAppointment(tenantId, reminder.appointmentId);
  const doctor = appointment ? providerFor(tenantId, appointment.doctorId) : undefined;
  return {
    ...reminder,
    appointment: appointment ?? null,
    doctorName: doctor?.name ?? null,
    patientName: appointment?.patientName ?? null,
    patientPhone: appointment?.patientPhone ?? null,
  };
}
