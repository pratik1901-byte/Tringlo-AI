// ============================================================
// Tringlo AI — The hospital server, as Tringlo sees it
// ============================================================
//
// Tringlo is a voice layer in front of a hospital's own system, not a
// replacement for it. Patient identity, the appointment book and medical
// records belong to that system; this interface is the only way the rest of
// the hospital code is allowed to reach them.
//
// Every method answers with a result that can say "the hospital's API does not
// do this" as plainly as it can say yes or no. That matters more than it
// sounds: the alternative to an explicit `unsupported` is code that treats a
// missing capability as a failure, and a panel that shows a cancellation as
// having gone through when nothing was ever sent.
//
// Two implementations exist:
//
//   demo  — a stand-in with its own fictional records, for development and
//           demonstrations. Says so in `mode`, and everything it returns is
//           marked as demonstration data.
//   live  — real HTTP against the hospital's documented API. Reports itself
//           unconfigured until a base URL, a credential and the path for the
//           operation have actually been entered. It invents no endpoints.
// ============================================================

export type HisCapability =
  | "patient_lookup"
  | "providers_read"
  | "appointments_read"
  | "appointment_confirm"
  | "appointment_cancel"
  | "appointment_reschedule"
  | "history_read"
  | "history_write"
  | "report_submit"
  | "faqs_read";

export const HIS_CAPABILITIES: HisCapability[] = [
  "patient_lookup",
  "providers_read",
  "appointments_read",
  "appointment_confirm",
  "appointment_cancel",
  "appointment_reschedule",
  "history_read",
  "history_write",
  "report_submit",
  "faqs_read",
];

/** How a capability reads in the panel. */
export const CAPABILITY_LABELS: Record<HisCapability, string> = {
  patient_lookup: "Patient lookup and identity matching",
  providers_read: "Doctor and provider directory",
  appointments_read: "Appointment retrieval",
  appointment_confirm: "Appointment confirmation",
  appointment_cancel: "Appointment cancellation",
  appointment_reschedule: "Appointment rescheduling",
  history_read: "Medical history retrieval",
  history_write: "Medical history updates",
  report_submit: "Preliminary history report submission",
  faqs_read: "Hospital service information",
};

export type HisFailureCode =
  /** No base URL or credential has been entered yet. */
  | "not_configured"
  /** The hospital's API does not offer this operation. */
  | "unsupported"
  | "unreachable"
  | "timeout"
  /** The hospital's system answered, and said no. */
  | "rejected"
  | "not_found"
  /** More than one record could be the patient. Never resolved by guessing. */
  | "ambiguous"
  | "malformed";

export type HisResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: HisFailureCode; problem: string };

export const hisFail = <T>(code: HisFailureCode, problem: string): HisResult<T> => ({ ok: false, code, problem });
export const hisOk = <T>(data: T): HisResult<T> => ({ ok: true, data });

/** Whether a failure is worth retrying, or is simply the answer. */
export function isTransient(code: HisFailureCode): boolean {
  return code === "unreachable" || code === "timeout";
}

// ------------------------------------------------------------
// What the hospital's system tells us
// ------------------------------------------------------------

/** A consulting doctor, as the hospital's directory has them. Read-only here. */
export interface HisProvider {
  /** The hospital's own identifier for this provider. */
  id: string;
  name: string;
  specialty: string;
  department: string | null;
  /** Only what the hospital publishes. Never filled in with a guess. */
  qualifications: string | null;
  /** Weekday names the hospital says they consult. */
  days: string[];
  hours: { start: string; end: string } | null;
  slotMinutes: number;
  breaks: Array<{ start: string; end: string }>;
  /** Dates they are away, "YYYY-MM-DD". */
  unavailableDates: string[];
  /** Special hours on particular dates. */
  specialHours: Array<{ date: string; start: string; end: string }>;
  accepting: boolean;
  /** An image the hospital provides, or nothing. */
  avatar: string | null;
  /** True when this came from the demonstration stand-in. */
  demo: boolean;
}

/** The identifiers offered for a lookup. A phone number alone is not identity. */
export interface HisPatientLookup {
  phone?: string | null;
  name?: string | null;
  /** "YYYY-MM-DD". */
  dateOfBirth?: string | null;
  /** The hospital's own patient number, when the caller knows it. */
  patientId?: string | null;
}

/**
 * The hospital's answer about who this is.
 *
 * `confidence` is the whole point. "match" is a record the hospital's own
 * matching rules identified; "ambiguous" means the identifiers given were not
 * enough, which is the normal answer to a phone number on its own; "none"
 * means the hospital looked and has no such patient — and only that last one
 * is grounds for treating somebody as new.
 */
export interface HisPatientMatch {
  confidence: "match" | "ambiguous" | "none";
  /** The canonical patient id, when there is a confident match. */
  patientId: string | null;
  name: string | null;
  /** Which identifiers corroborated it. */
  matchedOn: string[];
  /** How many records could be this person, when ambiguous. */
  candidates: number;
  /** Whether the hospital holds a medical history for them already. */
  hasHistory: boolean;
  demo: boolean;
}

export interface HisAppointment {
  id: string;
  patientId: string | null;
  providerId: string;
  providerName: string | null;
  /** ISO instant. */
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  demo: boolean;
}

export interface HisHistorySummary {
  exists: boolean;
  /** The hospital's own reference for the history record. */
  reference: string | null;
  /** Only what the integration is authorised to return. */
  summary: string | null;
  updatedAt: string | null;
}

export interface HisFaq {
  question: string;
  answer: string;
  category: string | null;
}

/**
 * A patient in the demonstration stand-in's own directory.
 *
 * Kept separate from Tringlo's leads on purpose: it stands in for records a
 * hospital holds and Tringlo does not, which is what makes "the hospital has
 * never heard of this caller" a state the demo can actually produce.
 */
export interface DemoHisPatient {
  id: string;
  tenantId: string;
  /** The canonical patient id — what a history is keyed on. */
  patientId: string;
  name: string;
  phone: string;
  /** "YYYY-MM-DD". The corroborating identifier a phone number is not. */
  dateOfBirth: string;
  hasHistory: boolean;
  demo: boolean;
  createdAt: string;
}

/** What a submitted report is acknowledged as. */
export interface HisSubmissionReceipt {
  /** The hospital's reference, so a submission can be traced. */
  reference: string;
  acceptedAt: string;
}

// ------------------------------------------------------------
// The interface
// ------------------------------------------------------------

export interface HospitalServer {
  readonly mode: "demo" | "live";
  /** What to call it on screen. */
  readonly label: string;
  /** Whether an operation is available at all, before it is attempted. */
  supports(capability: HisCapability): boolean;
  /** A real check against the hospital's system, for the panel to show. */
  health(): Promise<HisResult<{ detail: string }>>;

  findPatient(lookup: HisPatientLookup): Promise<HisResult<HisPatientMatch>>;
  listProviders(): Promise<HisResult<HisProvider[]>>;
  getProvider(providerId: string): Promise<HisResult<HisProvider>>;
  listAppointments(options: { patientId?: string; from?: string; to?: string }): Promise<HisResult<HisAppointment[]>>;

  confirmAppointment(reference: string, by: string): Promise<HisResult<{ status: string }>>;
  cancelAppointment(reference: string, reason: string | null): Promise<HisResult<{ status: string }>>;
  rescheduleAppointment(reference: string, scheduledAt: string): Promise<HisResult<{ status: string }>>;

  getMedicalHistory(patientId: string): Promise<HisResult<HisHistorySummary>>;
  updateMedicalHistory(patientId: string, answers: Record<string, string | null>): Promise<HisResult<{ reference: string }>>;
  submitReport(payload: unknown): Promise<HisResult<HisSubmissionReceipt>>;

  listFaqs(): Promise<HisResult<HisFaq[]>>;
}
