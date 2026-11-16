// ============================================================
// Tringlo AI — Maya's in-call tools (deterministic action layer)
// ============================================================
//
// The functions Maya invokes DURING a call to look up doctors, check real
// availability, and book / reschedule / cancel. Every one runs against the
// hospital's actual database through the existing appointment services — the
// LLM never touches the database and never writes SQL. Each returns a plain
// structured result ({ ok, data } or { ok:false, error }) so the agent can
// speak the truth: an operation is reported successful only when the database
// confirmed it.
//
// These are the operations behind the HTTP tool endpoint Sarvam calls. They are
// deliberately fast and synchronous where the data allows, so a tool call
// returns within a voice turn rather than leaving the agent waiting.
// ============================================================

import { getAppointment, getAppointments } from "@/lib/db";
import { normalisePhone } from "@/lib/customers/identity";
import { requestCancellation } from "./cancellations";
import { isDemoDoctorId } from "./demo-doctors";
import { providerFor, providers } from "./directory";
import { hospitalServer, type HisProvider } from "./his";
import { VERIFICATION_TTL_MS, activeVerification, issueVerification, type PatientVerification } from "./verification";
import {
  availabilityFor,
  bookAppointment as bookAppointmentService,
  localDate,
  localTime,
  hospitalProfile,
  rescheduleAppointment as rescheduleService,
  slotsFor,
} from "./service";

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: string; data?: unknown };

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string, code?: string, data?: unknown): ToolResult => ({
  ok: false,
  error,
  code,
  ...(data === undefined ? {} : { data }),
});

/** A doctor as the agent should hear it — no internal plumbing. */
const listing = (p: HisProvider) => ({
  doctor_id: p.id,
  doctor_name: p.name,
  specialty: p.specialty,
  department: p.department,
  consulting_days: p.days,
  consulting_hours: p.hours ? `${p.hours.start}-${p.hours.end}` : null,
  consultation_fee: p.consultationFee ?? null,
});

function doctorView(tenantId: string, id: string) {
  const p = providerFor(tenantId, id);
  if (!p) return null;
  return { ...listing(p), accepting: p.accepting };
}

/** The times a doctor is genuinely free on a date, read from the database now. */
function freeTimes(tenantId: string, doctorId: string, date: string): string[] {
  return slotsFor(tenantId, doctorId, date)
    .filter((s) => s.available)
    .map((s) => s.time);
}

/**
 * What to offer instead: the free times on the day asked for, or failing that
 * the next day within a fortnight that has any.
 */
function alternativesFor(tenantId: string, doctorId: string, date: string): { date: string; slots: string[] } | null {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  for (let i = 0; i <= 14; i += 1) {
    const day = new Date(base + i * 86400_000).toISOString().slice(0, 10);
    const slots = freeTimes(tenantId, doctorId, day);
    if (slots.length > 0) return { date: day, slots };
  }
  return null;
}

// ------------------------------------------------------------
// A — get_doctors
// ------------------------------------------------------------
export function getDoctors(tenantId: string): ToolResult {
  const list = providers(tenantId)
    .filter((p) => p.accepting)
    .map(listing);
  return ok({ doctors: list, count: list.length });
}

// ------------------------------------------------------------
// get_departments
// ------------------------------------------------------------
export function getDepartments(tenantId: string): ToolResult {
  const byDepartment = new Map<string, { specialties: Set<string>; doctors: number }>();
  for (const p of providers(tenantId)) {
    if (!p.accepting) continue;
    const name = p.department ?? p.specialty;
    const entry = byDepartment.get(name) ?? { specialties: new Set<string>(), doctors: 0 };
    entry.specialties.add(p.specialty);
    entry.doctors += 1;
    byDepartment.set(name, entry);
  }
  const departments = [...byDepartment.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, entry]) => ({ department, specialties: [...entry.specialties], doctor_count: entry.doctors }));
  return ok({ departments, count: departments.length });
}

// ------------------------------------------------------------
// B — search_doctors
// ------------------------------------------------------------
export function searchDoctors(tenantId: string, args: { query?: string; specialty?: string; name?: string }): ToolResult {
  const q = (args.query ?? args.specialty ?? args.name ?? "").trim().toLowerCase();
  if (!q) return getDoctors(tenantId);
  const list = providers(tenantId)
    .filter((p) => p.accepting)
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.specialty.toLowerCase().includes(q) ||
        (p.department ?? "").toLowerCase().includes(q)
    )
    .map(listing);
  return ok({ doctors: list, count: list.length, query: q });
}

// ------------------------------------------------------------
// C — check_doctor_availability
// ------------------------------------------------------------
export function checkDoctorAvailability(tenantId: string, args: { doctor_id?: string; date?: string }): ToolResult {
  if (!args.doctor_id) return fail("A doctor must be chosen first.", "missing_doctor");
  if (!args.date) return fail("A date is needed to check availability.", "missing_date");
  const doctor = doctorView(tenantId, args.doctor_id);
  if (!doctor) return fail("That doctor is not in the hospital's directory.", "unknown_doctor");
  const slots = slotsFor(tenantId, args.doctor_id, args.date);
  const free = slots.filter((s) => s.available).map((s) => s.time);
  // Explicit availability envelope: a day with no slots is a clear, speakable
  // "no availability" result, never an empty success the agent has to guess at.
  return ok({
    doctor,
    date: args.date,
    available: free.length > 0,
    slots: free,
    available_slots: free,
    any_available: free.length > 0,
    message: free.length > 0 ? `${free.length} slot${free.length === 1 ? "" : "s"} available on ${args.date}.` : "No available appointments were found for the requested date.",
  });
}

// ------------------------------------------------------------
// D — get_available_slots (a range of days)
// ------------------------------------------------------------
export function getAvailableSlots(tenantId: string, args: { doctor_id?: string; specialty?: string; from_date?: string; days?: number }): ToolResult {
  const tz = hospitalProfile(tenantId).timezone;
  const start = args.from_date ?? localDate(new Date(), tz);
  const horizon = Math.min(Math.max(args.days ?? 7, 1), 14);
  const out: Array<{ date: string; doctors: ReturnType<typeof availabilityFor> }> = [];
  const base = new Date(`${start}T00:00:00`);
  for (let i = 0; i < horizon; i += 1) {
    const date = localDate(new Date(base.getTime() + i * 86400_000), tz);
    const day = availabilityFor(tenantId, date, { doctorId: args.doctor_id, specialty: args.specialty }).filter((d) => d.slots.length > 0);
    if (day.length > 0) out.push({ date, doctors: day });
  }
  return ok({
    from: start,
    days: horizon,
    available: out.length > 0,
    availability: out,
    message: out.length > 0 ? `Availability found on ${out.length} day${out.length === 1 ? "" : "s"}.` : "No available appointments were found in the requested range.",
  });
}

// ------------------------------------------------------------
// E — book_appointment
// ------------------------------------------------------------
export function bookAppointment(
  tenantId: string,
  args: { patient_name?: string; patient_phone?: string; doctor_id?: string; appointment_date?: string; appointment_time?: string; reason?: string; call_id?: string }
): ToolResult {
  const { patient_name, patient_phone, doctor_id, appointment_date, appointment_time } = args;
  if (!patient_name || !patient_phone) return fail("The patient's name and phone number are needed.", "missing_patient");
  if (!doctor_id || !appointment_date || !appointment_time) return fail("A doctor, date and time are needed to book.", "missing_slot");

  // Validate the slot is genuinely free immediately before booking; the booking
  // service then guards the transaction against a double-booking race.
  const slots = slotsFor(tenantId, doctor_id, appointment_date);
  const slot = slots.find((s) => s.time === appointment_time);
  if (!slot) {
    return fail("That time is not one the doctor consults at.", "no_such_slot", { alternatives: alternativesFor(tenantId, doctor_id, appointment_date) });
  }
  if (!slot.available) {
    return fail("That slot is not available. Please choose another.", "slot_taken", { alternatives: alternativesFor(tenantId, doctor_id, appointment_date) });
  }

  const result = bookAppointmentService({
    tenantId,
    doctorId: doctor_id,
    date: appointment_date,
    time: appointment_time,
    patientName: patient_name,
    patientPhone: patient_phone,
    reason: args.reason ?? null,
    source: "inbound_call",
    status: "confirmed",
    callId: args.call_id ?? null,
    actor: "agent",
  });
  if (!result.ok) {
    return fail(result.problem, "not_booked", { alternatives: alternativesFor(tenantId, doctor_id, appointment_date) });
  }
  const doctor = doctorView(tenantId, doctor_id);
  return ok({
    booked: true,
    appointment_id: result.appointment.id,
    reference_id: result.appointment.id,
    patient_name,
    doctor_name: doctor?.doctor_name ?? null,
    department: doctor?.department ?? null,
    consultation_fee: doctor?.consultation_fee ?? null,
    appointment_date,
    appointment_time,
    status: result.appointment.status,
    // Read back after the write, so the next offer cannot include this slot.
    remaining_slots: freeTimes(tenantId, doctor_id, appointment_date),
  });
}

// ------------------------------------------------------------
// verify_patient — identity, by the hospital's own records
// ------------------------------------------------------------
//
// A name or a phone number is not identity: anyone can say either. The
// hospital's system is asked whether the phone number AND the date of birth the
// caller gives belong to one patient, and only a confident match on both is a
// verification. What comes back is a short-lived id, and every tool that reads
// or changes an existing appointment requires it and acts only on appointments
// booked under the verified patient's number.
//
// Sessions are kept by ./verification. Repeated failures for one number lock it
// for a while, so a date of birth cannot be guessed by trying.

const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 3;

declare global {
  var __tringloVerificationFailures: Map<string, number[]> | undefined;
}
const verificationFailures = (globalThis.__tringloVerificationFailures ??= new Map());

/** "1986-04-11", "11-04-1986", "11/04/1986" or "11.04.1986" → "1986-04-11". */
function normaliseDateOfBirth(value: string): string | null {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  const parts = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [y, m, d] = parts;
  const date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export async function verifyPatient(tenantId: string, args: { patient_phone?: string; date_of_birth?: string }): Promise<ToolResult> {
  if (!args.patient_phone || !args.date_of_birth) {
    return fail("The patient's phone number and date of birth are both needed to verify them.", "missing_identity");
  }
  const phoneNational = normalisePhone(args.patient_phone).national;
  if (!phoneNational) return fail("That phone number could not be read.", "bad_phone");
  const dateOfBirth = normaliseDateOfBirth(args.date_of_birth);
  if (!dateOfBirth) return fail("That date of birth could not be read. It is needed as day, month and year.", "bad_date_of_birth");

  const failureKey = `${tenantId}:${phoneNational}`;
  const now = Date.now();
  const recent = (verificationFailures.get(failureKey) ?? []).filter((at: number) => now - at < FAILURE_WINDOW_MS);
  if (recent.length >= MAX_FAILURES) {
    return fail("Too many unsuccessful attempts for this number. The hospital's staff will need to help.", "verification_locked");
  }

  const server = hospitalServer(tenantId);
  if (!server.supports("patient_lookup")) {
    return fail("The hospital's system cannot verify patients from here.", "verification_unavailable");
  }
  const result = await server.findPatient({ phone: args.patient_phone, dateOfBirth });
  if (!result.ok) return fail("The hospital's records could not be checked just now.", "verification_unavailable");

  const match = result.data;
  const confirmed = match.confidence === "match" && match.matchedOn.includes("phone") && match.matchedOn.includes("dateOfBirth");
  if (!confirmed) {
    recent.push(now);
    verificationFailures.set(failureKey, recent);
    // One answer for "no such patient" and "details do not match", so a caller
    // cannot learn whether a number is on the hospital's books.
    return fail("Those details do not match the hospital's records.", "not_verified");
  }

  verificationFailures.delete(failureKey);
  const verification = issueVerification({ tenantId, phoneNational, patientId: match.patientId, name: match.name });
  return ok({ verified: true, verification_id: verification.id, patient_name: match.name, valid_for_minutes: VERIFICATION_TTL_MS / 60_000 });
}

const VERIFICATION_MESSAGES = {
  verification_required: "The patient must be verified first with their phone number and date of birth.",
  verification_invalid: "That verification is not valid. Verify the patient again.",
  verification_expired: "That verification has expired. Verify the patient again.",
} as const;

/** The verification a tool call carries, or the failure to speak instead. */
function verifiedPatient(tenantId: string, verificationId: unknown): PatientVerification | ToolResult {
  const check = activeVerification(tenantId, verificationId);
  return check.ok ? check.verification : fail(VERIFICATION_MESSAGES[check.code], check.code);
}

const isFailure = (value: PatientVerification | ToolResult): value is ToolResult => "ok" in value;

/** An appointment of the verified patient's, or nothing — never someone else's. */
function ownAppointment(tenantId: string, patient: PatientVerification, appointmentId: string | undefined) {
  if (!appointmentId) return null;
  const appointment = getAppointment(tenantId, appointmentId);
  if (!appointment || normalisePhone(appointment.patientPhone).national !== patient.phoneNational) return null;
  return appointment;
}

const NOT_THEIRS = "No appointment with that reference was found for this patient.";

// ------------------------------------------------------------
// F — get_patient_appointments
// ------------------------------------------------------------
export function getPatientAppointments(tenantId: string, args: { verification_id?: string }): ToolResult {
  const patient = verifiedPatient(tenantId, args.verification_id);
  if (isFailure(patient)) return patient;
  const tz = hospitalProfile(tenantId).timezone;
  const list = getAppointments(tenantId)
    .filter((a) => normalisePhone(a.patientPhone).national === patient.phoneNational && a.status !== "cancelled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((a) => ({
      appointment_id: a.id,
      doctor_name: providerFor(tenantId, a.doctorId)?.name ?? null,
      appointment_date: localDate(a.scheduledAt, tz),
      appointment_time: localTime(a.scheduledAt, tz),
      status: a.status,
      upcoming: new Date(a.scheduledAt).getTime() >= Date.now(),
    }));
  return ok({ appointments: list, count: list.length });
}

// ------------------------------------------------------------
// G — reschedule_appointment
// ------------------------------------------------------------
export function rescheduleAppointment(
  tenantId: string,
  args: { appointment_id?: string; new_date?: string; new_time?: string; verification_id?: string }
): ToolResult {
  if (!args.appointment_id) return fail("An appointment id is needed to reschedule.", "missing_appointment");
  const patient = verifiedPatient(tenantId, args.verification_id);
  if (isFailure(patient)) return patient;
  if (!ownAppointment(tenantId, patient, args.appointment_id)) return fail(NOT_THEIRS, "not_found_for_patient");
  if (!args.new_date || !args.new_time) return fail("A new date and time are needed.", "missing_slot");
  const result = rescheduleService(
    tenantId,
    args.appointment_id,
    { date: args.new_date, time: args.new_time, note: "Rescheduled by the patient on a call." },
    "agent"
  );
  if (!result.ok) {
    const current = getAppointment(tenantId, args.appointment_id);
    return fail(
      result.problem,
      "not_rescheduled",
      current ? { alternatives: alternativesFor(tenantId, current.doctorId, args.new_date) } : undefined
    );
  }
  const tz = hospitalProfile(tenantId).timezone;
  const newDate = localDate(result.appointment.scheduledAt, tz);
  return ok({
    rescheduled: true,
    appointment_id: result.appointment.id,
    doctor_name: providerFor(tenantId, result.appointment.doctorId)?.name ?? null,
    appointment_date: newDate,
    appointment_time: localTime(result.appointment.scheduledAt, tz),
    status: result.appointment.status,
    // The old slot is free again and the new one is taken, as of this read.
    remaining_slots: freeTimes(tenantId, result.appointment.doctorId, newDate),
  });
}

// ------------------------------------------------------------
// H — cancel_appointment (explicit confirmation required)
// ------------------------------------------------------------
export async function cancelAppointment(
  tenantId: string,
  args: { appointment_id?: string; confirm?: boolean; reason?: string; verification_id?: string }
): Promise<ToolResult> {
  if (!args.appointment_id) return fail("An appointment id is needed to cancel.", "missing_appointment");
  const patient = verifiedPatient(tenantId, args.verification_id);
  if (isFailure(patient)) return patient;
  const appointment = ownAppointment(tenantId, patient, args.appointment_id);
  if (!appointment) return fail(NOT_THEIRS, "not_found_for_patient");
  if (args.confirm !== true) return fail("Cancellation needs the patient's explicit confirmation.", "confirmation_required");

  const outcome = await requestCancellation({
    tenantId,
    appointmentId: appointment.id,
    canonicalPatientId: patient.patientId,
    requestedVia: "inbound_call",
    reason: args.reason ?? "Cancelled by the patient on a call.",
    actor: "agent",
    // Verified above, by the hospital's records — not assumed.
    identityVerified: true,
  });
  if ("error" in outcome) return fail(outcome.error, "cancel_failed");
  // The appointment is cancelled only if a destination confirmed it; otherwise
  // the request stands with staff and the appointment is unchanged for now.
  const tz = hospitalProfile(tenantId).timezone;
  const date = localDate(appointment.scheduledAt, tz);
  return ok({
    appointment_id: args.appointment_id,
    cancelled: outcome.cancelled,
    message: outcome.message,
    needs_staff: outcome.needsStaff,
    appointment_date: date,
    appointment_time: localTime(appointment.scheduledAt, tz),
    // Read after the cancellation: the released slot appears here only if the
    // appointment really was cancelled.
    available_slots: freeTimes(tenantId, appointment.doctorId, date),
  });
}

// ------------------------------------------------------------
// I — get_appointment_details
// ------------------------------------------------------------
export function getAppointmentDetails(tenantId: string, args: { appointment_id?: string; verification_id?: string }): ToolResult {
  if (!args.appointment_id) return fail("An appointment id is needed.", "missing_appointment");
  const patient = verifiedPatient(tenantId, args.verification_id);
  if (isFailure(patient)) return patient;
  const a = ownAppointment(tenantId, patient, args.appointment_id);
  if (!a) return fail(NOT_THEIRS, "not_found_for_patient");
  const tz = hospitalProfile(tenantId).timezone;
  return ok({
    appointment_id: a.id,
    patient_name: a.patientName,
    doctor_id: a.doctorId,
    doctor_name: providerFor(tenantId, a.doctorId)?.name ?? null,
    specialty: a.specialty,
    consultation_fee: providerFor(tenantId, a.doctorId)?.consultationFee ?? null,
    appointment_date: localDate(a.scheduledAt, tz),
    appointment_time: localTime(a.scheduledAt, tz),
    status: a.status,
  });
}

// ------------------------------------------------------------
// Dispatcher
// ------------------------------------------------------------

export const AGENT_TOOLS = [
  "get_doctors",
  "get_departments",
  "search_doctors",
  "check_doctor_availability",
  "get_available_slots",
  "book_appointment",
  "verify_patient",
  "get_patient_appointments",
  "reschedule_appointment",
  "cancel_appointment",
  "get_appointment_details",
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number];

// A short in-memory ring of the most recent tool failures, for the diagnostics
// endpoint. No patient values — tool name, code and the (non-sensitive) message.
interface ToolErrorEntry {
  at: string;
  tool: string;
  code?: string;
  error: string;
}
const RECENT_ERRORS: ToolErrorEntry[] = [];
function noteError(tool: string, result: ToolResult) {
  if (result.ok) return;
  RECENT_ERRORS.unshift({ at: new Date().toISOString(), tool, code: result.code, error: result.error });
  if (RECENT_ERRORS.length > 20) RECENT_ERRORS.length = 20;
}
export function recentToolErrors(): ToolErrorEntry[] {
  return RECENT_ERRORS.slice(0, 20);
}

/**
 * A health snapshot for the diagnostics endpoint: database reachability, doctor
 * and demo-doctor counts, how many slots are actually free today, and the most
 * recent tool errors. No patient data.
 */
export function agentToolsDiagnostics(tenantId: string): Record<string, unknown> {
  let dbConnected = true;
  let doctorCount = 0;
  let demoDoctorCount = 0;
  let availableSlotsToday = 0;
  try {
    const directory = providers(tenantId);
    doctorCount = directory.length;
    demoDoctorCount = directory.filter((d) => isDemoDoctorId(d.id)).length;
    const today = localDate(new Date(), hospitalProfile(tenantId).timezone);
    for (const d of directory) {
      if (!d.accepting) continue;
      availableSlotsToday += slotsFor(tenantId, d.id, today).filter((s) => s.available).length;
    }
  } catch (error) {
    dbConnected = false;
    noteError("diagnostics", fail(error instanceof Error ? error.message : "diagnostics failed"));
  }
  return {
    ok: true,
    endpoint: "healthy",
    dbConnected,
    tools: AGENT_TOOLS,
    doctorCount,
    demoDoctorCount,
    availableSlotsToday,
    recentErrors: recentToolErrors(),
  };
}

/** "10:30", "10:30:00", "9.30", "10:30 AM", "4 pm" → "HH:MM". Anything else is left alone. */
export function normaliseTime(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = value.trim().match(/^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?$/i);
  if (!match || (match[2] === undefined && !match[3])) return value;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return value;
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return value;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Arguments as a voice agent's tool call tends to send them: a time with
 * seconds or an AM/PM, a boolean or a number as a string. Only the shape is
 * tidied — a value that cannot be read is passed through and refused by the
 * tool itself.
 */
function coerceArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(args ?? {}) };
  for (const key of ["appointment_time", "new_time"]) {
    if (key in out) out[key] = normaliseTime(out[key]);
  }
  if (typeof out.confirm === "string") out.confirm = /^(true|yes)$/i.test(out.confirm.trim());
  if (typeof out.days === "string" && out.days.trim() !== "" && Number.isFinite(Number(out.days))) out.days = Number(out.days);
  for (const key of ["doctor_id", "appointment_id", "date", "appointment_date", "new_date", "from_date"]) {
    if (typeof out[key] === "string") out[key] = (out[key] as string).trim();
  }
  return out;
}

/** Runs one named tool. Always returns a structured result; never throws. */
export async function runAgentTool(tenantId: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const a = coerceArgs(args) as never;
  const result = await dispatch(tenantId, tool, a);
  noteError(tool, result);
  return result;
}

async function dispatch(tenantId: string, tool: string, a: never): Promise<ToolResult> {
  try {
    switch (tool) {
      case "get_doctors":
        return getDoctors(tenantId);
      case "get_departments":
        return getDepartments(tenantId);
      case "search_doctors":
        return searchDoctors(tenantId, a);
      case "check_doctor_availability":
        return checkDoctorAvailability(tenantId, a);
      case "get_available_slots":
        return getAvailableSlots(tenantId, a);
      case "book_appointment":
        return bookAppointment(tenantId, a);
      case "verify_patient":
        return await verifyPatient(tenantId, a);
      case "get_patient_appointments":
        return getPatientAppointments(tenantId, a);
      case "reschedule_appointment":
        return rescheduleAppointment(tenantId, a);
      case "cancel_appointment":
        return await cancelAppointment(tenantId, a);
      case "get_appointment_details":
        return getAppointmentDetails(tenantId, a);
      default:
        return fail(`Unknown tool "${tool}".`, "unknown_tool");
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The operation could not be completed.", "tool_error");
  }
}
