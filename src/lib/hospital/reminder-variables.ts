// ============================================================
// Tringlo AI — Appointment reminder: what Maya is told
// ============================================================
//
// The input variables a confirmation call carries, built from the one
// appointment it is about. This is the whole of what leaves Tringlo for the
// agent — deliberately the minimum a reminder needs, never the patient's
// record. There is no medical reason for a reminder, no history, no notes:
// a confirmation call is overheard by whoever is in the room with the patient.
//
// Every value is a string, because that is what a Sarvam agent variable is.
// An empty field is omitted rather than sent blank, so the agent is never told
// "the doctor is " with nothing after it.
//
// Whether any of these actually reach Maya is a second question, answered by
// her workspace's declared `agentVariables` and by what her Sarvam app
// declares: `buildSarvamAgentVariables` sends only the names the agent accepts.
// This module decides *what could* be sent; the provider layer decides what is.
// ============================================================

import { getDoctor, getLeads } from "@/lib/db";
import type { Appointment } from "./types";
import { providerFor } from "./directory";
import { hospitalProfile, localDate, localTime } from "./service";

/** The reason the call is being placed. Only confirmations exist today. */
export type ReminderType = "confirmation";

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * The variables for one appointment's confirmation call.
 *
 * Returns only non-empty values, each a string. The caller passes this to the
 * provider as `customVariables`; the provider sends the subset the agent
 * declares.
 */
export function reminderCallVariables(
  appointment: Appointment,
  reminderType: ReminderType = "confirmation"
): Record<string, string> {
  const profile = hospitalProfile(appointment.tenantId);
  const tz = profile.timezone;

  // The doctor, from the hospital's directory (the same source the panel and
  // availability use), with the local Doctor record as a fallback.
  const provider = providerFor(appointment.tenantId, appointment.doctorId);
  const doctor = provider ?? getDoctor(appointment.tenantId, appointment.doctorId);
  const doctorName = provider?.name ?? (doctor && "name" in doctor ? doctor.name : "") ?? "";
  const department =
    (provider && "department" in provider ? provider.department : null) ??
    (doctor && "department" in doctor ? doctor.department : null) ??
    appointment.specialty ??
    "";

  // Consent and language come from the patient as Tringlo knows them (a lead in
  // this workspace). A suppressed lead has opted out — the worker never calls
  // them, but if one ever reached here the consent flag says "false".
  const patient = getLeads().find(
    (lead) => lead.tenantId === appointment.tenantId && lead.id === appointment.patientLeadId
  );
  const consent = patient ? (patient.suppressed ? "false" : "true") : "";

  // Exactly the INPUT variables from Maya's Sarvam configuration. Output
  // variables (what Maya extracts) are never sent here.
  const candidate: Record<string, string> = {
    patient_id: appointment.patientLeadId,
    patient_name: appointment.patientName,
    patient_first_name: firstName(appointment.patientName),
    patient_phone: appointment.patientPhone,
    preferred_language: "",
    communication_consent: consent,

    appointment_id: appointment.id,
    appointment_date: localDate(appointment.scheduledAt, tz),
    appointment_time: localTime(appointment.scheduledAt, tz),
    appointment_status: appointment.status,
    doctor_name: doctorName,
    department_name: department,
    hospital_name: profile.name,
    hospital_address: profile.address ?? "",

    reminder_type: reminderType,
    timezone: tz,
  };

  // Omit empties: a blank variable tells the agent nothing and reads badly if
  // the agent's prompt substitutes it into a sentence.
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

/**
 * Exactly the INPUT variable names a confirmation call sends, matching Maya's
 * Sarvam configuration. These are declared on the workspace's outbound/batch
 * agent so the provider sends them.
 */
export const REMINDER_INPUT_VARIABLES: string[] = [
  "patient_id",
  "patient_name",
  "patient_first_name",
  "patient_phone",
  "preferred_language",
  "communication_consent",
  "appointment_id",
  "appointment_date",
  "appointment_time",
  "appointment_status",
  "doctor_name",
  "department_name",
  "hospital_name",
  "hospital_address",
  "reminder_type",
  "timezone",
];

/**
 * The OUTPUT variables Maya extracts, documented for the webhook interpreter and
 * for the Sarvam-app configuration. Tringlo never sends these; it reads them.
 */
export const REMINDER_OUTPUT_VARIABLES: string[] = [
  "identity_verified",
  "appointment_confirmation_status",
  "attendance_status",
  "reschedule_requested",
  "preferred_reschedule_date",
  "preferred_reschedule_time",
  "selected_slot_id",
  "available_slots",
  "new_appointment_date",
  "new_appointment_time",
  "reschedule_status",
  "patient_response",
  "call_disposition",
  "call_summary",
  "call_id",
  "follow_up_required",
  "human_handoff_requested",
  "opt_out_requested",
  "next_action",
];
