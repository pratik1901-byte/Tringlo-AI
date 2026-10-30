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

import { getAppointment, getAppointments, getLeads } from "@/lib/db";
import { normalisePhone } from "@/lib/customers/identity";
import { requestCancellation } from "./cancellations";
import { isDemoDoctorId } from "./demo-doctors";
import { providerFor, providers } from "./directory";
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
  | { ok: false; error: string; code?: string };

const ok = (data: unknown): ToolResult => ({ ok: true, data });
const fail = (error: string, code?: string): ToolResult => ({ ok: false, error, code });

/** A doctor as the agent should hear it — no internal plumbing. */
function doctorView(tenantId: string, id: string) {
  const p = providerFor(tenantId, id);
  if (!p) return null;
  return {
    doctor_id: p.id,
    doctor_name: p.name,
    specialty: p.specialty,
    department: p.department,
    accepting: p.accepting,
  };
}

// ------------------------------------------------------------
// A — get_doctors
// ------------------------------------------------------------
export function getDoctors(tenantId: string): ToolResult {
  const list = providers(tenantId)
    .filter((p) => p.accepting)
    .map((p) => ({ doctor_id: p.id, doctor_name: p.name, specialty: p.specialty, department: p.department }));
  return ok({ doctors: list, count: list.length });
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
    .map((p) => ({ doctor_id: p.id, doctor_name: p.name, specialty: p.specialty, department: p.department }));
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
  if (!slot) return fail("That time is not one the doctor consults at.", "no_such_slot");
  if (!slot.available) return fail("That slot has just been taken. Please choose another.", "slot_taken");

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
  if (!result.ok) return fail(result.problem, "not_booked");
  const doctor = doctorView(tenantId, doctor_id);
  return ok({
    booked: true,
    appointment_id: result.appointment.id,
    reference_id: result.appointment.id,
    patient_name,
    doctor_name: doctor?.doctor_name ?? null,
    department: doctor?.department ?? null,
    appointment_date,
    appointment_time,
    status: result.appointment.status,
  });
}

// ------------------------------------------------------------
// F — get_patient_appointments
// ------------------------------------------------------------
export function getPatientAppointments(tenantId: string, args: { patient_phone?: string }): ToolResult {
  if (!args.patient_phone) return fail("A phone number is needed to find appointments.", "missing_phone");
  const national = normalisePhone(args.patient_phone).national;
  if (!national) return fail("That phone number could not be read.", "bad_phone");
  const lead = getLeads().find((l) => l.tenantId === tenantId && normalisePhone(l.phone).national === national);
  if (!lead) return ok({ appointments: [], count: 0 });
  const tz = hospitalProfile(tenantId).timezone;
  const list = getAppointments(tenantId)
    .filter((a) => a.patientLeadId === lead.id && a.status !== "cancelled")
    .map((a) => ({
      appointment_id: a.id,
      doctor_name: providerFor(tenantId, a.doctorId)?.name ?? null,
      appointment_date: localDate(a.scheduledAt, tz),
      appointment_time: localTime(a.scheduledAt, tz),
      status: a.status,
    }));
  return ok({ appointments: list, count: list.length });
}

// ------------------------------------------------------------
// G — reschedule_appointment
// ------------------------------------------------------------
export function rescheduleAppointment(tenantId: string, args: { appointment_id?: string; new_date?: string; new_time?: string }): ToolResult {
  if (!args.appointment_id) return fail("An appointment id is needed to reschedule.", "missing_appointment");
  if (!args.new_date || !args.new_time) return fail("A new date and time are needed.", "missing_slot");
  const result = rescheduleService(
    tenantId,
    args.appointment_id,
    { date: args.new_date, time: args.new_time, note: "Rescheduled by the patient on a call." },
    "agent"
  );
  if (!result.ok) return fail(result.problem, "not_rescheduled");
  const tz = hospitalProfile(tenantId).timezone;
  return ok({
    rescheduled: true,
    appointment_id: result.appointment.id,
    appointment_date: localDate(result.appointment.scheduledAt, tz),
    appointment_time: localTime(result.appointment.scheduledAt, tz),
    status: result.appointment.status,
  });
}

// ------------------------------------------------------------
// H — cancel_appointment (explicit confirmation required)
// ------------------------------------------------------------
export async function cancelAppointment(
  tenantId: string,
  args: { appointment_id?: string; confirm?: boolean; reason?: string }
): Promise<ToolResult> {
  if (!args.appointment_id) return fail("An appointment id is needed to cancel.", "missing_appointment");
  if (args.confirm !== true) return fail("Cancellation needs the patient's explicit confirmation.", "confirmation_required");
  const appointment = getAppointment(tenantId, args.appointment_id);
  if (!appointment) return fail("That appointment is not in the hospital's records.", "unknown_appointment");

  const outcome = await requestCancellation({
    tenantId,
    appointmentId: args.appointment_id,
    requestedVia: "inbound_call",
    reason: args.reason ?? "Cancelled by the patient on a call.",
    actor: "agent",
    identityVerified: true,
  });
  if ("error" in outcome) return fail(outcome.error, "cancel_failed");
  // The appointment is cancelled only if a destination confirmed it; otherwise
  // the request stands with staff and the appointment is unchanged for now.
  return ok({
    appointment_id: args.appointment_id,
    cancelled: outcome.cancelled,
    message: outcome.message,
    needs_staff: outcome.needsStaff,
  });
}

// ------------------------------------------------------------
// I — get_appointment_details
// ------------------------------------------------------------
export function getAppointmentDetails(tenantId: string, args: { appointment_id?: string; patient_phone?: string }): ToolResult {
  if (!args.appointment_id) return fail("An appointment id is needed.", "missing_appointment");
  const a = getAppointment(tenantId, args.appointment_id);
  if (!a) return fail("That appointment is not in the hospital's records.", "unknown_appointment");
  // When a phone is given, it must match the appointment's patient.
  if (args.patient_phone) {
    const lead = getLeads().find((l) => l.id === a.patientLeadId);
    if (!lead || normalisePhone(lead.phone).national !== normalisePhone(args.patient_phone).national) {
      return fail("Those details do not match this appointment.", "verification_failed");
    }
  }
  const tz = hospitalProfile(tenantId).timezone;
  return ok({
    appointment_id: a.id,
    patient_name: a.patientName,
    doctor_name: providerFor(tenantId, a.doctorId)?.name ?? null,
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
  "search_doctors",
  "check_doctor_availability",
  "get_available_slots",
  "book_appointment",
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

/** Runs one named tool. Always returns a structured result; never throws. */
export async function runAgentTool(tenantId: string, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const a = args as never;
  const result = await dispatch(tenantId, tool, a);
  noteError(tool, result);
  return result;
}

async function dispatch(tenantId: string, tool: string, a: never): Promise<ToolResult> {
  try {
    switch (tool) {
      case "get_doctors":
        return getDoctors(tenantId);
      case "search_doctors":
        return searchDoctors(tenantId, a);
      case "check_doctor_availability":
        return checkDoctorAvailability(tenantId, a);
      case "get_available_slots":
        return getAvailableSlots(tenantId, a);
      case "book_appointment":
        return bookAppointment(tenantId, a);
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
