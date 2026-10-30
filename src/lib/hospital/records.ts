// ============================================================
// Tringlo AI — Hospital intake records
// ============================================================
//
// The records the voice agent produces when it talks to a patient, as distinct
// from the appointment book in `types.ts`.
//
// Four things are kept apart here on purpose, because collapsing them is how a
// patient ends up with five competing medical histories:
//
//   A. Longitudinal medical history — ONE record per canonical patient, ever.
//      Keyed on the hospital's own patient id. Updated by revision, never
//      overwritten, never created twice.
//   B. Visit-specific information — what was said about one encounter. As many
//      as there are encounters. Never promoted into (A).
//   C. Call history — the platform's own call records. Not touched here.
//   D. Follow-up requests — somebody wants to be rung back about something.
//
// Two further rules this file exists to make structural rather than hoped for:
//
//   - The questionnaire is NINE questions. `QUESTIONNAIRE` is frozen, and the
//     assertion below runs at import, so a future edit that adds a tenth
//     question fails the process rather than lengthening a phone call.
//   - Nothing here is a diagnosis. Every answer is patient-reported and is
//     labelled as such, kept separate from anything the hospital has verified.
// ============================================================

/**
 * What the hospital's own system says about who this caller is.
 *
 * `unverified` is the honest default and the safe one: it is what a caller is
 * until the hospital's record has been matched by the hospital's own rules. It
 * is NOT a synonym for new — assuming a caller is new is how a duplicate
 * patient record gets created.
 */
export type PatientStatus = "new" | "returning" | "unverified";

/** Consent, recorded before any health information is collected. */
export interface ConsentRecord {
  granted: boolean;
  /** What the patient was actually told, kept verbatim. */
  statement: string;
  at: string;
  /** How it was obtained: spoken on a call, or entered by staff. */
  via: "voice" | "staff";
  /** Who recorded it — a call id, or a staff user id. */
  recordedBy: string;
}

// ------------------------------------------------------------
// The questionnaire
// ------------------------------------------------------------

export interface QuestionnaireQuestion {
  id: string;
  /** The short label the panel shows. */
  label: string;
  /** Asked exactly as written. Phrased to be understood when spoken aloud. */
  prompt: string;
}

/**
 * The preliminary history questions, in order.
 *
 * Nine, fixed. They are not generated, not extended per hospital and not
 * chosen by the model: a voice questionnaire that grows is a voice
 * questionnaire nobody finishes, and a clinical question set is not something
 * an agent should be improvising.
 */
export const QUESTIONNAIRE: readonly QuestionnaireQuestion[] = Object.freeze([
  { id: "reason", label: "Reason for visit", prompt: "What brings you to the hospital today?" },
  { id: "symptoms", label: "Main symptoms", prompt: "What symptoms or health concerns are you experiencing?" },
  { id: "duration", label: "Duration", prompt: "How long have you been experiencing these symptoms?" },
  {
    id: "conditions",
    label: "Existing conditions",
    prompt: "Do you have any existing medical conditions that the hospital should know about?",
  },
  { id: "medications", label: "Current medications", prompt: "Are you currently taking any medications?" },
  { id: "allergies", label: "Allergies", prompt: "Do you have any known allergies, including medication allergies?" },
  {
    id: "history",
    label: "Relevant medical history",
    prompt:
      "Have you had any previous surgeries, major illnesses, or hospitalizations that are relevant to your visit?",
  },
  { id: "family", label: "Relevant family history", prompt: "Is there any relevant family medical history you would like to share?" },
  {
    id: "additional",
    label: "Additional information",
    prompt: "Is there anything else about your health that you think the medical team should know?",
  },
] as const);

/** The ceiling, in one place, so the limit is a number and not a hope. */
export const MAX_QUESTIONNAIRE_QUESTIONS = 9;

// Enforced at import: an edit that adds a tenth question stops the server
// rather than quietly making the call longer.
if (QUESTIONNAIRE.length > MAX_QUESTIONNAIRE_QUESTIONS) {
  throw new Error(
    `The medical history questionnaire may hold at most ${MAX_QUESTIONNAIRE_QUESTIONS} questions; it has ${QUESTIONNAIRE.length}.`
  );
}

export const QUESTION_IDS: readonly string[] = QUESTIONNAIRE.map((question) => question.id);

export type AnswerState = "answered" | "skipped" | "unknown";

export interface QuestionnaireAnswer {
  questionId: string;
  /** Asked once, recorded once. */
  askedAt: string;
  answeredAt: string;
  state: AnswerState;
  /** The patient's own words. Null when skipped or not known. */
  value: string | null;
  /** Why there is no answer, when the patient said. */
  note?: string | null;
}

export type SessionStatus =
  | "consent_pending"
  | "in_progress"
  | "complete"
  | "abandoned"
  /** Urgent symptoms, or anything the agent should not be handling. */
  | "escalated";

/**
 * One run through the questionnaire.
 *
 * A session is the thing that enforces the limit: `askedCount` only ever goes
 * up, and the service refuses to hand out a tenth question whatever the agent
 * asks for. It is also what makes answering idempotent — a question already
 * answered in this session is not asked again.
 */
export interface QuestionnaireSession {
  id: string;
  tenantId: string;
  /** The patient as Tringlo knows them. */
  patientLeadId: string;
  /** The hospital's own id, once identity is established. Null until then. */
  canonicalPatientId: string | null;
  patientStatus: PatientStatus;
  consent: ConsentRecord | null;
  answers: QuestionnaireAnswer[];
  /**
   * The question ids actually put to the patient, in the order they were put.
   *
   * This is the counter the limit is enforced against, and it is a list rather
   * than a number so that handing out the same question twice — an agent that
   * repeats itself, a retried request — cannot inflate it. Its length never
   * exceeds nine.
   */
  asked: string[];
  status: SessionStatus;
  /** Set when the session was stopped for escalation, with the reason. */
  escalation?: { at: string; reason: string; protocol: string } | null;
  /** The call it happened on, when it happened on one. */
  callId: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  demo: boolean;
}

// ------------------------------------------------------------
// Longitudinal history — one per patient
// ------------------------------------------------------------

/** A change to a history, kept so the previous information survives it. */
export interface MedicalHistoryRevision {
  id: string;
  at: string;
  actor: string;
  /** The session the change came from, when it came from a call. */
  sessionId: string | null;
  /** Question ids touched. */
  changed: string[];
  /** What each one said before, so nothing is lost by an update. */
  previous: Record<string, string | null>;
  note?: string | null;
}

/**
 * A patient's preliminary history. Exactly one per canonical patient id.
 *
 * `storage` says where the authority for this record actually lies. When the
 * hospital's own system holds medical history, that is the source of truth and
 * this record is a local cache of what the agent collected; when it does not,
 * this is the only copy, and the panel says so rather than implying the
 * hospital has it.
 */
export interface MedicalHistoryRecord {
  id: string;
  tenantId: string;
  /**
   * The uniqueness key. One record per patient, enforced on write.
   *
   * Normally the hospital's own patient id. For a patient the hospital has
   * never seen, there is no such id yet and none is invented: the record is
   * keyed on a provisional id minted here, `provisional` is true, and the key
   * is replaced by the hospital's once it issues one. The uniqueness rule
   * holds either way, so a provisional record cannot become a second history.
   */
  canonicalPatientId: string;
  provisional: boolean;
  /**
   * Whether this record has reached the hospital's system.
   *
   * There is still only ever one local record. A failed write changes this
   * field and nothing else — it never produces a second history.
   */
  sync: {
    state: "not_attempted" | "unsupported" | "synced" | "failed";
    at: string | null;
    /** The hospital's reference, once it has accepted the record. */
    reference: string | null;
    problem: string | null;
  };
  patientLeadId: string;
  patientName: string;
  consent: ConsentRecord | null;
  /** Patient-reported answers, by question id. Never a clinical conclusion. */
  answers: Record<string, QuestionnaireAnswer>;
  revisions: MedicalHistoryRevision[];
  /** Everything in `answers` came from the patient, not from a record. */
  provenance: "patient_reported";
  storage: "tringlo_local" | "hospital_server";
  /** The session that first created it. */
  originSessionId: string | null;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
}

/**
 * Something said about one encounter.
 *
 * This is where a returning patient's "my knee is worse this week" goes. It
 * does not touch the longitudinal record, which is the point: a second history
 * must never be created because somebody rang up with a new complaint.
 */
export interface VisitNote {
  id: string;
  tenantId: string;
  canonicalPatientId: string | null;
  patientLeadId: string;
  appointmentId: string | null;
  callId: string | null;
  at: string;
  /** The patient's own words about this visit. */
  note: string;
  recordedBy: string;
  demo: boolean;
}

// ------------------------------------------------------------
// Reports
// ------------------------------------------------------------

export type ReportStatus = "draft" | "ready" | "submitted" | "failed" | "reviewed";

/**
 * A preliminary, patient-reported history, assembled for a human to read.
 *
 * It carries no interpretation. `submitted` is set only when a destination has
 * confirmed receipt — an attempt that failed says `failed` and keeps the
 * reason, because a report believed delivered and actually lost is worse than
 * one plainly marked undelivered.
 */
export interface HistoryReport {
  id: string;
  tenantId: string;
  historyId: string;
  sessionId: string | null;
  canonicalPatientId: string | null;
  patientLeadId: string;
  patientName: string;
  patientStatus: PatientStatus;
  collectedAt: string;
  consent: ConsentRecord | null;
  /** The nine questions with what each one got, including nothing. */
  answers: Array<{ questionId: string; label: string; prompt: string; state: AnswerState; value: string | null }>;
  skipped: string[];
  unanswered: string[];
  /** Administrative only. Never clinical. */
  notes: string | null;
  status: ReportStatus;
  destination: "hospital_server" | "panel_review";
  submittedAt: string | null;
  /** Why a submission did not land, in words a person can act on. */
  failureReason: string | null;
  attempts: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
}

/** The label every report carries, so its standing is never in doubt. */
export const REPORT_DISCLAIMER =
  "Preliminary, patient-reported history collected by an automated voice assistant. Not a clinical assessment, diagnosis or triage. For review by qualified hospital personnel.";

// ------------------------------------------------------------
// Follow-ups
// ------------------------------------------------------------

export type HospitalFollowUpStatus =
  | "new"
  | "pending_review"
  | "assigned"
  | "callback_scheduled"
  | "in_progress"
  | "completed"
  | "unable_to_reach"
  | "cancelled";

export const OPEN_FOLLOW_UP_STATUSES: HospitalFollowUpStatus[] = [
  "new",
  "pending_review",
  "assigned",
  "callback_scheduled",
  "in_progress",
];

/**
 * Somebody asked to be contacted about something.
 *
 * `priority` is "normal" unless a configured hospital rule says otherwise.
 * Nothing here decides that a request is clinically urgent on its own: that is
 * a clinical judgement, and an agent guessing at it either cries wolf or
 * misses the one that mattered.
 */
export interface HospitalFollowUp {
  /**
   * A follow-up REQUEST, not a scheduled callback.
   *
   * The platform's own `FollowUp` is the scheduled callback — a persistent,
   * server-side thing the existing scheduler dials. This is the patient's ask,
   * which exists from the moment they make it, whether or not a callback has
   * been arranged. `callbackId` is the link to one once it has.
   */
  id: string;
  tenantId: string;
  canonicalPatientId: string | null;
  patientLeadId: string;
  patientName: string;
  appointmentId: string | null;
  requestedAt: string;
  /** The patient's own words for what they want addressed. */
  reason: string;
  sourceCallId: string | null;
  /** When they asked to be rung, if they said. ISO instant. */
  preferredAt: string | null;
  priority: "normal" | "raised";
  /** Why it was raised, naming the rule. Null when normal. */
  priorityRule: string | null;
  department: string | null;
  assignedTo: string | null;
  status: HospitalFollowUpStatus;
  /** What came of it, once somebody dealt with it. */
  outcome: string | null;
  /** The platform callback this is waiting on, once one was scheduled. */
  callbackId: string | null;
  events: Array<{ at: string; actor: string; action: string; detail?: string | null }>;
  createdAt: string;
  updatedAt: string;
  demo: boolean;
}

// ------------------------------------------------------------
// Inquiries that found no approved answer
// ------------------------------------------------------------

/**
 * A general question the agent had no approved answer for.
 *
 * Kept because the alternative is the agent inventing one. Each of these is a
 * FAQ the hospital has not written yet, and the list is the backlog.
 */
export interface UnansweredInquiry {
  id: string;
  tenantId: string;
  at: string;
  /** What was asked, as asked. */
  question: string;
  callId: string | null;
  patientLeadId: string | null;
  /** Whether the caller was handed to a person. */
  handoff: boolean;
  status: "open" | "answered" | "dismissed";
  /** The FAQ written in response, once somebody writes one. */
  resolvedFaqId: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  demo: boolean;
}

// ------------------------------------------------------------
// Cancellation requests
// ------------------------------------------------------------

export type CancellationStatus = "pending" | "submitted" | "confirmed" | "failed" | "rejected";

/**
 * A request to cancel an appointment, and what became of it.
 *
 * A patient may ask at any hour; whether it can be actioned is the hospital's
 * decision and its system's answer. `confirmed` means the hospital's system
 * said so, or staff confirmed it here. Everything short of that stays pending
 * or failed, and goes to a person — telling a patient their appointment is
 * cancelled when it is not is the failure this type is shaped to prevent.
 */
export interface CancellationRequest {
  id: string;
  tenantId: string;
  appointmentId: string;
  canonicalPatientId: string | null;
  patientLeadId: string;
  requestedAt: string;
  requestedVia: "inbound_call" | "confirmation_call" | "staff" | "agent";
  reason: string | null;
  status: CancellationStatus;
  attempts: number;
  lastAttemptAt: string | null;
  /** Why the hospital's system did not take it. */
  failureReason: string | null;
  /** True once a person has been given it to deal with. */
  routedToStaff: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  demo: boolean;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------
// Hospital server integration
// ------------------------------------------------------------

/**
 * How this workspace reaches the hospital's own system.
 *
 * `mode` is the honest switch. "demo" means nothing leaves the building and
 * every record is fictional; "live" means a real base URL has been entered,
 * and until one has, "live" still reports itself unconfigured rather than
 * pretending. The token lives here on the server and is never serialised to
 * the panel — only whether one exists.
 */
export interface HospitalIntegrationConfig {
  mode: "demo" | "live";
  /** The documented base URL of the hospital's API. Empty until provided. */
  baseUrl: string | null;
  /** Server-side only. Never returned by an API route. */
  token: string | null;
  /** Which operations the hospital's API actually supports, as documented. */
  capabilities: string[];
  /**
   * The path for each operation, as the hospital's documentation gives it —
   * keyed by capability, relative to `baseUrl`.
   *
   * Nothing is guessed. An operation with no path entered is reported
   * unsupported, because a plausible-looking URL invented here would be a
   * request sent to a hospital's server on the strength of a guess.
   */
  endpoints: Record<string, string>;
  timeoutMs: number;
  /** Where a finished history report should go. */
  reportDestination: "hospital_server" | "panel_review";
  updatedAt: string;
  /** The last health check, so the panel can show something real. */
  lastCheck: { at: string; ok: boolean; detail: string } | null;
}

export function defaultIntegrationConfig(): HospitalIntegrationConfig {
  return {
    mode: "demo",
    baseUrl: null,
    token: null,
    capabilities: [],
    endpoints: {},
    timeoutMs: 10_000,
    reportDestination: "panel_review",
    updatedAt: new Date().toISOString(),
    lastCheck: null,
  };
}
