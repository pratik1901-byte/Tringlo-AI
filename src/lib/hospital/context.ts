// ============================================================
// Tringlo AI — What the agent knows, at the moment she is asked
// ============================================================
//
// The hospital's system changes a doctor's hours; the next caller is offered
// the new hours. Nobody rewrites a prompt in between.
//
// That works because this is read when a call starts, not baked into the
// agent. Sarvam's inbound deployment calls Tringlo's context hook at the start
// of each call; this module is what that hook answers with for a hospital
// workspace. A doctor the hospital stopped listing a minute ago is simply not
// in the answer.
//
// The agent's name is the workspace's own setting — see lib/hospital/agent —
// and nothing here depends on what she is called.
//
// What it deliberately does not do:
//
//   - It does not send the whole directory as prose for the model to reason
//     over. Availability is a calculation, and it stays one: the summary names
//     who consults and when, and the live slots come from `availabilityFor`.
//   - It does not carry clinical detail, and it does not carry any patient's
//     medical history. An agent needs to know whether somebody is a new
//     patient; it does not need to be told their allergies in order to ask
//     about them.
//   - It does not tell the agent anything about a caller who has not been
//     identified. A phone number resolving to a lead is not identification.
//   - It does not invent a fact about the hospital. An unconfigured helpline,
//     address or escalation procedure is reported as unconfigured, and the
//     agent is told to say it will have it confirmed.
//   - It does not cross workspaces.
// ============================================================

import { getAppointments, getHospitalFaqs, getHospitalProfile } from "@/lib/db";
import { OPEN_APPOINTMENT_STATUSES } from "./types";
import { hospitalProfile, localDate, localTime } from "./service";
import { consultingProviders, directoryStatus } from "./directory";
import { MAX_QUESTIONNAIRE_QUESTIONS, QUESTIONNAIRE } from "./records";
import { historyForPatient } from "./history";

/** A compact description of who is consulting, for the agent's context. */
export interface HospitalContext {
  hospitalName: string;
  timezone: string;
  openingHours: string;
  /** Unconfigured facts are said to be unconfigured, never invented. */
  helpline: string | null;
  address: string | null;
  staffContact: string | null;
  escalationProtocol: string | null;
  doctors: Array<{ name: string; specialty: string; days: string; hours: string }>;
  specialties: string[];
  faqs: Array<{ question: string; answer: string }>;
  notes: string | null;
  /** Where the doctor list came from, and when. */
  directory: { source: "demo" | "live"; fetchedAt: string | null; stale: boolean; problem: string | null };
}

export function hospitalContext(tenantId: string): HospitalContext {
  const profile = hospitalProfile(tenantId);
  const doctors = consultingProviders(tenantId)
    .slice()
    .sort((a, b) => a.specialty.localeCompare(b.specialty) || a.name.localeCompare(b.name));
  const directory = directoryStatus(tenantId);

  return {
    hospitalName: profile.name,
    timezone: profile.timezone,
    openingHours: profile.openingHours
      ? `${profile.openingHours.days.join(", ")} ${profile.openingHours.start}–${profile.openingHours.end}`
      : "not configured",
    helpline: profile.helpline ?? null,
    address: profile.address ?? null,
    staffContact: profile.staffContact ?? null,
    escalationProtocol: profile.escalationProtocol ?? null,
    doctors: doctors.map((doctor) => ({
      name: doctor.name,
      specialty: doctor.specialty,
      days: doctor.days.join(", "),
      hours: doctor.hours ? `${doctor.hours.start}–${doctor.hours.end}` : "by arrangement",
    })),
    specialties: [...new Set(doctors.map((doctor) => doctor.specialty))],
    faqs: getHospitalFaqs(tenantId)
      .filter((faq) => faq.active)
      .map((faq) => ({ question: faq.question, answer: faq.answer })),
    notes: profile.notes ?? null,
    directory: {
      source: directory.source,
      fetchedAt: directory.fetchedAt,
      stale: directory.stale,
      problem: directory.problem,
    },
  };
}

/**
 * The rules of the intake workflow, as text for the agent.
 *
 * Stated here rather than left to a hand-written prompt so that the panel and
 * the agent cannot drift apart, and so the nine-question limit is told to the
 * agent in the same words the code enforces. The code is still what stops a
 * tenth question: this is so the agent does not try.
 */
export function intakeGuidance(tenantId: string): string {
  const profile = hospitalProfile(tenantId);
  const escalation =
    profile.escalationProtocol?.trim() ||
    "This hospital has not configured an escalation procedure. If anything sounds urgent, stop and direct the caller to a qualified member of hospital staff.";
  const handoff = profile.staffContact?.trim()
    ? `If you cannot answer, offer to put the caller through to ${profile.staffContact.trim()}.`
    : "If you cannot answer, say the hospital will confirm and that a member of staff will come back to them.";

  return [
    `Identify the caller by the hospital's process before discussing any appointment or record. A phone number is not identification: ask for a date of birth or the hospital patient number.`,
    `If the hospital has no record of them, you may ask the ${MAX_QUESTIONNAIRE_QUESTIONS} preliminary health questions, and only those ${MAX_QUESTIONNAIRE_QUESTIONS}, after they agree to answer them. Ask each one once. Let them skip any. Do not add questions of your own.`,
    `If the hospital already has a record of them, do not run the questionnaire again. Note anything new about this visit instead.`,
    `Do not give a diagnosis, an opinion on symptoms, or any treatment advice.`,
    `Answer general questions about the hospital only from the approved information you have been given. ${handoff}`,
    `A caller may ask to cancel an appointment at any time. Take the request, and tell them it has been passed to the hospital. Do not tell them it is cancelled until the hospital's system has confirmed it.`,
    `Escalation: ${escalation}`,
  ].join(" ");
}

/**
 * The context as agent variables, under whatever names this hospital's agent
 * declares.
 *
 * Nothing is sent that the agent has not declared — the platform's rule, and
 * the reason a hospital agent is not handed a sales schema. A hospital whose
 * agent declares none of these gets none of them, and the agent works from
 * its own prompt.
 */
export function hospitalContextVariables(tenantId: string, declared: Set<string>): Record<string, string> {
  if (declared.size === 0) return {};
  const context = hospitalContext(tenantId);
  const out: Record<string, string> = {};

  const offer = (name: string, value: string) => {
    if (declared.has(name) && value.trim()) out[name] = value;
  };

  offer("hospital_name", context.hospitalName);
  offer("hospital_hours", context.openingHours);
  offer("hospital_specialties", context.specialties.join(", "));
  offer(
    "hospital_doctors",
    context.doctors.map((doctor) => `${doctor.name} (${doctor.specialty}), ${doctor.days} ${doctor.hours}`).join("; ")
  );
  offer("hospital_faqs", context.faqs.map((faq) => `Q: ${faq.question} A: ${faq.answer}`).join("\n"));
  offer("hospital_intake_rules", intakeGuidance(tenantId));
  offer("hospital_questionnaire", QUESTIONNAIRE.map((question, index) => `${index + 1}. ${question.prompt}`).join(" "));
  offer("hospital_questionnaire_limit", String(MAX_QUESTIONNAIRE_QUESTIONS));
  if (context.helpline) offer("hospital_helpline", context.helpline);
  if (context.address) offer("hospital_address", context.address);
  if (context.staffContact) offer("hospital_staff_contact", context.staffContact);
  if (context.escalationProtocol) offer("hospital_escalation", context.escalationProtocol);
  if (context.notes) offer("hospital_notes", context.notes);

  return out;
}

/**
 * What the agent may be told about this caller.
 *
 * Nothing, unless the hospital has identified them. `patient_status` is the
 * one thing an unidentified caller produces — "unverified" — because the agent
 * needs to know to ask, and that is not a disclosure about anybody.
 */
export function callerVariables(
  tenantId: string,
  declared: Set<string>,
  identity: { status: "new" | "returning" | "unverified"; canonicalPatientId: string | null; hasHistory: boolean; needs: string[] },
  patientLeadId: string | null
): Record<string, string> {
  if (declared.size === 0) return {};
  const out: Record<string, string> = {};
  const offer = (name: string, value: string) => {
    if (declared.has(name) && value.trim()) out[name] = value;
  };

  offer("patient_status", identity.status);

  if (identity.status === "unverified") {
    offer(
      "patient_verification_needed",
      identity.needs.length ? identity.needs.join(", ") : "the hospital's own identifying information"
    );
    return out;
  }

  if (identity.status === "new") {
    offer("patient_history_on_file", "no");
    offer("patient_next_step", `Offer the ${MAX_QUESTIONNAIRE_QUESTIONS} preliminary health questions, with their agreement.`);
    return out;
  }

  // Returning, and identified. Whether a history exists — not what is in it.
  const history = historyForPatient(tenantId, {
    canonicalPatientId: identity.canonicalPatientId,
    patientLeadId,
  });
  offer("patient_history_on_file", identity.hasHistory || history ? "yes" : "no");
  offer(
    "patient_next_step",
    history
      ? "Do not run the questionnaire. Note anything new about this visit."
      : "Their history is held by the hospital. Do not collect it again."
  );
  if (identity.canonicalPatientId) offer("patient_reference", identity.canonicalPatientId);
  return out;
}

/**
 * What this caller already has booked, for a caller Tringlo recognises.
 *
 * Only their own appointments, found from the lead their number resolves to in
 * this workspace. A caller cannot ask about somebody else's booking by giving
 * another number: the number the hook is given is the number the call came
 * from, and the lookup is scoped to this hospital.
 */
export function callerAppointments(tenantId: string, leadId: string | null) {
  if (!leadId) return [];
  const profile = hospitalProfile(tenantId);
  const doctors = new Map(consultingProviders(tenantId).map((provider) => [provider.id, provider.name]));

  return getAppointments(tenantId)
    .filter(
      (appointment) =>
        appointment.patientLeadId === leadId &&
        OPEN_APPOINTMENT_STATUSES.includes(appointment.status) &&
        new Date(appointment.scheduledAt).getTime() >= Date.now() - 3600_000
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5)
    .map((appointment) => ({
      id: appointment.id,
      doctor: doctors.get(appointment.doctorId) ?? "a doctor",
      specialty: appointment.specialty,
      date: localDate(appointment.scheduledAt, profile.timezone),
      time: localTime(appointment.scheduledAt, profile.timezone),
      status: appointment.status,
    }));
}

/**
 * True when this workspace is running the hospital panel.
 *
 * Keyed on somebody having enabled it. Two earlier versions of this test were
 * both wrong in the same direction — "does it have any doctors", then "does a
 * hospital profile exist" — because each could become true by accident, and a
 * workspace that drifts into being a hospital gets a hospital's agent context
 * on its next call.
 */
export function isHospitalWorkspace(tenantId: string): boolean {
  return getHospitalProfile(tenantId)?.enabled === true;
}
