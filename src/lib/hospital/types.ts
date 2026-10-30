// ============================================================
// Tringlo AI — Hospital operations
// ============================================================
//
// The records a hospital runs on: who its doctors are, when they work, who is
// booked in, and which reminders are owed. Everything here belongs to one
// workspace — the hospital is a Tringlo tenant like any other, and `tenantId`
// is what keeps one hospital's patients out of another's screens.
//
// What is deliberately *not* here, because Tringlo already has it:
//
//   patients   → customer profiles and leads, matched on the normalised number
//   calls      → call records, written by the provider's webhooks
//   memory     → memory items, scoped to a customer in a workspace
//
// Reusing those keeps one source of truth for a person and their calls, so a
// patient's history is the same history the agent already remembers.
//
// `demo` marks a fictional record created by the seed. It is never inferred
// and never removed by an edit: a demonstration appointment must stay
// identifiable for as long as it exists, because that is what keeps it from
// being dialled.
// ============================================================

export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export const WEEKDAYS: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** A stretch of a day a doctor does not see patients. */
export interface TimeRange {
  /** "HH:MM", in the hospital's timezone. */
  start: string;
  end: string;
}

export interface DoctorSchedule {
  /** The days this doctor normally consults. */
  days: Weekday[];
  start: string;
  end: string;
  /** Minutes per appointment. Decides how a working day divides into slots. */
  slotMinutes: number;
  /** Lunch, rounds, theatre — no slots are offered inside these. */
  breaks: TimeRange[];
}

/**
 * A day that does not follow the weekly pattern: leave, a holiday, or a day
 * with different hours. `hours` absent means the doctor is away entirely.
 */
export interface ScheduleException {
  id: string;
  /** "YYYY-MM-DD" in the hospital's timezone. */
  date: string;
  kind: "leave" | "holiday" | "special_hours";
  hours?: TimeRange;
  note?: string | null;
}

export interface Doctor {
  id: string;
  tenantId: string;
  name: string;
  specialty: string;
  department?: string | null;
  /** Only what the hospital has entered. Never invented. */
  qualifications?: string | null;
  about?: string | null;
  /** A local asset path, so no image is fetched from elsewhere. */
  avatar?: string | null;
  phone?: string | null;
  email?: string | null;
  schedule: DoctorSchedule;
  exceptions: ScheduleException[];
  /** Archived doctors keep their history and take no new bookings. */
  status: "active" | "archived";
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentStatus =
  | "requested"
  | "confirmed"
  | "rescheduled"
  | "completed"
  | "cancelled"
  | "missed";

export const OPEN_APPOINTMENT_STATUSES: AppointmentStatus[] = ["requested", "confirmed", "rescheduled"];

export interface Appointment {
  id: string;
  tenantId: string;
  doctorId: string;
  /** The patient, as Tringlo knows them: a lead in this workspace. */
  patientLeadId: string;
  patientName: string;
  patientPhone: string;
  specialty: string;
  /** ISO instant. Always stored in UTC; shown in the hospital's timezone. */
  scheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  /** Where the booking came from. `agent` means the voice agent took it. */
  source: "staff" | "agent" | "inbound_call" | "seed";
  reason?: string | null;
  /** Why it was cancelled or moved, when someone said. */
  statusNote?: string | null;
  /** The call this booking came out of, when there was one. */
  callId?: string | null;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Every status change, kept so a cancellation can still be accounted for. */
export interface AppointmentEvent {
  id: string;
  tenantId: string;
  appointmentId: string;
  at: string;
  /** Who did it: a staff user id, or "agent" / "system". */
  actor: string;
  action: "created" | "confirmed" | "rescheduled" | "cancelled" | "completed" | "missed" | "deleted" | "restored";
  from?: string | null;
  to?: string | null;
  note?: string | null;
}

export type ReminderStatus =
  | "scheduled"
  | "due"
  | "calling"
  | "sent"
  | "failed"
  | "cancelled"
  | "skipped";

/**
 * What a patient said when the agent rang to confirm.
 *
 * `response` is what they actually said, not what the system would like it to
 * mean. In particular an appointment is marked confirmed ONLY on "confirmed" —
 * a no-answer, a voicemail or an unclear reply leaves it exactly as it was,
 * because treating silence as agreement is how a hospital ends up with a
 * confirmed appointment nobody attends.
 */
export interface ConfirmationOutcome {
  response: "confirmed" | "cancel_requested" | "reschedule_requested" | "declined" | "no_answer" | "unclear";
  /** The patient's own words, when there were any. */
  note: string | null;
  recordedAt: string;
  /** What Tringlo did about it, and whether that worked. */
  action: string | null;
}

export interface Reminder {
  id: string;
  tenantId: string;
  appointmentId: string;
  /**
   * What this call is for. Only confirmations exist today; named so a future
   * second kind of call cannot be mistaken for one.
   */
  kind?: "confirmation";
  /**
   * The appointment time this confirmation belongs to.
   *
   * A rescheduled appointment is a new cycle, so the confirmation for the old
   * time can be cancelled and a fresh one scheduled without the two ever
   * being confused for a duplicate of each other.
   */
  cycle?: string;
  /** What the patient said. Null until the call has happened. */
  outcome?: ConfirmationOutcome | null;
  /** When the call should be placed. ISO instant. */
  dueAt: string;
  status: ReminderStatus;
  attempts: number;
  lastAttemptAt?: string | null;
  /** Held while a worker is placing the call, so two cannot both dial. */
  lockedAt?: string | null;
  /** The call the reminder placed, once the provider accepted it. */
  callId?: string | null;
  attemptId?: string | null;
  /** How it was dispatched: one instant call, or as part of a batch campaign. */
  dispatchMethod?: "instant" | "batch";
  /** When dispatched in a batch, the Sarvam campaign and cohort it rode in. */
  providerCampaignId?: string | null;
  providerCohortId?: string | null;
  /** Why it did not go, in words. */
  failureReason?: string | null;
  /** Why it was never going to go: no consent, demo data, too late to matter. */
  skippedReason?: string | null;
  /** A reminder for a demonstration appointment is never actually dialled. */
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HospitalFaq {
  id: string;
  tenantId: string;
  question: string;
  answer: string;
  topic?: string | null;
  active: boolean;
  /**
   * How often the agent has answered from this text, and when it last did.
   *
   * Kept apart from `updatedAt`, which is when the ANSWER last changed — the
   * timestamp staff look at to know whether the wording is current. Using a
   * FAQ is not editing it.
   */
  usedCount?: number;
  lastUsedAt?: string | null;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the hospital is, as far as the agent and the panel are concerned.
 *
 * Every field starts empty. A hospital's address, helpline and payment terms
 * are facts about a real business: shown as unconfigured until someone enters
 * them, and never filled in with a plausible guess.
 */
export interface HospitalProfile {
  tenantId: string;
  /**
   * Whether this workspace actually runs the hospital panel.
   *
   * Absent on a profile written before this field existed, which reads as
   * false — the safe answer, and the right one: those profiles were created
   * by a read rather than by anybody deciding this was a hospital.
   */
  enabled?: boolean;
  name: string;
  timezone: string;
  /** "HH:MM" — when the hospital itself is open, apart from any doctor. */
  openingHours: { days: Weekday[]; start: string; end: string } | null;
  address?: string | null;
  helpline?: string | null;
  email?: string | null;
  website?: string | null;
  /** Anything staff want the agent to know that is not a FAQ. */
  notes?: string | null;
  /**
   * What the agent is to do when a caller describes something urgent, in the
   * hospital's own words.
   *
   * Null until the hospital writes it. An escalation protocol is a clinical
   * safety procedure; an invented one is worse than none, because none at
   * least makes the panel say it is missing.
   */
  escalationProtocol?: string | null;
  /** Who a caller is handed to when the agent cannot answer. */
  staffContact?: string | null;
  /** How long before an appointment a reminder is placed. */
  reminderLeadHours: number;
  /**
   * Reminder calls are not placed until this is switched on, and never for a
   * demonstration appointment. Off is the safe state and the default.
   */
  remindersEnabled: boolean;
  /** Most attempts for one reminder, so a failure cannot dial forever. */
  reminderMaxAttempts: number;
  /**
   * How this workspace reaches the hospital's own system.
   *
   * Absent on an older profile, which reads as the demonstration stand-in —
   * the safe default, since it connects to nothing.
   */
  integration?: import("./records").HospitalIntegrationConfig;
  createdAt: string;
  updatedAt: string;
}

/** A record of something worth being able to account for later. */
export interface HospitalAuditEvent {
  id: string;
  tenantId: string;
  at: string;
  actor: string;
  action: string;
  subject: string;
  detail?: string | null;
}

export function defaultHospitalProfile(tenantId: string, name = "Wellness Hospital"): HospitalProfile {
  const now = new Date().toISOString();
  return {
    tenantId,
    name,
    timezone: "Asia/Kolkata",
    openingHours: { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], start: "09:00", end: "18:00" },
    address: null,
    helpline: null,
    email: null,
    website: null,
    notes: null,
    escalationProtocol: null,
    staffContact: null,
    reminderLeadHours: 24,
    remindersEnabled: false,
    reminderMaxAttempts: 2,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultSchedule(): DoctorSchedule {
  return {
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    start: "09:00",
    end: "17:00",
    slotMinutes: 30,
    breaks: [{ start: "13:00", end: "14:00" }],
  };
}
