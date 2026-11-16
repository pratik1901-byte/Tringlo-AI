// ============================================================
// Tringlo AI — The demonstration hospital server
// ============================================================
//
// A stand-in for a hospital's own system, so the panel and the agent can be
// built and shown without one. It is not a hospital server and never claims to
// be: `mode` is "demo", everything it returns is marked `demo: true`, and the
// panel says so on every screen that depends on it.
//
// It is written to behave like a real one in the ways that matter:
//
//   - It has its OWN patient directory, separate from Tringlo's leads. That is
//     what lets it answer "I have never heard of this person", which is the
//     only honest basis for treating a caller as new.
//   - It matches identity by the hospital's rules, not by phone number. A
//     phone number on its own comes back `ambiguous`, every time, because a
//     number is shared, reassigned and spoofed.
//   - It declines the operations a typical hospital API does not expose.
//     Medical-history writes are deliberately NOT supported, so the ordinary
//     development path is the honest one: the history is held in Tringlo and
//     labelled as held in Tringlo.
//
// The provider directory it serves is the local `doctors` collection. In demo
// mode that collection belongs to this stand-in, not to Tringlo: the panel has
// no doctor management, and nothing outside this adapter writes to it.
// ============================================================

import {
  getAppointments,
  getDoctor,
  getDoctors,
  getHisPatients,
  getHospitalFaqs,
  getMedicalHistoryByPatient,
} from "@/lib/db";
import { normalisePhone } from "@/lib/customers/identity";
import type { Doctor } from "../types";
import {
  hisFail,
  hisOk,
  type HisAppointment,
  type HisCapability,
  type HisFaq,
  type HisHistorySummary,
  type HisPatientLookup,
  type HisPatientMatch,
  type HisProvider,
  type HisResult,
  type HisSubmissionReceipt,
  type HospitalServer,
} from "./types";

/**
 * What the stand-in offers.
 *
 * `history_write` is absent on purpose — see the header. So a hospital that
 * genuinely does accept history writes has to be configured as a live server,
 * rather than inheriting a capability from a demonstration.
 */
const DEMO_CAPABILITIES: HisCapability[] = [
  "patient_lookup",
  "providers_read",
  "appointments_read",
  "appointment_confirm",
  "appointment_cancel",
  "appointment_reschedule",
  "history_read",
  "report_submit",
  "faqs_read",
];

export class DemoHospitalServer implements HospitalServer {
  readonly mode = "demo" as const;
  readonly label = "Demonstration hospital server";

  constructor(private readonly tenantId: string) {}

  supports(capability: HisCapability): boolean {
    return DEMO_CAPABILITIES.includes(capability);
  }

  async health(): Promise<HisResult<{ detail: string }>> {
    return hisOk({
      detail: "Demonstration stand-in. No hospital server is connected, and no patient data leaves this installation.",
    });
  }

  /**
   * Identity, by the hospital's rules rather than by caller ID.
   *
   * A phone number narrows the search and nothing more. A match needs it
   * corroborated — by the hospital's patient number or by date of birth — and
   * without corroboration the answer is `ambiguous` even when exactly one
   * record has that number. "Only one person has this phone" is not the same
   * fact as "this is that person".
   */
  async findPatient(lookup: HisPatientLookup): Promise<HisResult<HisPatientMatch>> {
    const directory = getHisPatients(this.tenantId);

    if (lookup.patientId) {
      const byId = directory.find((patient) => patient.patientId === lookup.patientId);
      if (byId) {
        return hisOk({
          confidence: "match",
          patientId: byId.patientId,
          name: byId.name,
          matchedOn: ["patientId"],
          candidates: 1,
          hasHistory: byId.hasHistory,
          demo: true,
        });
      }
      // A patient number that is not in the directory is a definite absence:
      // the hospital looked it up and has nothing.
      return hisOk({
        confidence: "none",
        patientId: null,
        name: null,
        matchedOn: [],
        candidates: 0,
        hasHistory: false,
        demo: true,
      });
    }

    const wanted = lookup.phone ? normalisePhone(lookup.phone).national : null;
    const byPhone = wanted
      ? directory.filter((patient) => normalisePhone(patient.phone).national === wanted)
      : [];

    if (lookup.dateOfBirth) {
      const corroborated = byPhone.filter((patient) => patient.dateOfBirth === lookup.dateOfBirth);
      if (corroborated.length === 1) {
        return hisOk({
          confidence: "match",
          patientId: corroborated[0].patientId,
          name: corroborated[0].name,
          matchedOn: wanted ? ["phone", "dateOfBirth"] : ["dateOfBirth"],
          candidates: 1,
          hasHistory: corroborated[0].hasHistory,
          demo: true,
        });
      }
      if (corroborated.length > 1) {
        return hisOk({
          confidence: "ambiguous",
          patientId: null,
          name: null,
          matchedOn: ["phone", "dateOfBirth"],
          candidates: corroborated.length,
          hasHistory: false,
          demo: true,
        });
      }
      // A date of birth was given and nothing matched it. The hospital has
      // looked properly and has no such patient — this is what "new" means.
      const elsewhere = directory.filter((patient) => patient.dateOfBirth === lookup.dateOfBirth);
      if (elsewhere.length === 0) {
        return hisOk({
          confidence: "none",
          patientId: null,
          name: null,
          matchedOn: [],
          candidates: 0,
          hasHistory: false,
          demo: true,
        });
      }
      // The date of birth matches somebody, but on a different number. Not
      // confident enough to be either person's record.
      return hisOk({
        confidence: "ambiguous",
        patientId: null,
        name: null,
        matchedOn: ["dateOfBirth"],
        candidates: elsewhere.length,
        hasHistory: false,
        demo: true,
      });
    }

    // Nothing but a phone number — or less. Never a match, never an absence.
    return hisOk({
      confidence: "ambiguous",
      patientId: null,
      name: null,
      matchedOn: byPhone.length ? ["phone"] : [],
      candidates: byPhone.length,
      hasHistory: false,
      demo: true,
    });
  }

  async listProviders(): Promise<HisResult<HisProvider[]>> {
    return hisOk(getDoctors(this.tenantId).map(asProvider));
  }

  async getProvider(providerId: string): Promise<HisResult<HisProvider>> {
    const doctor = getDoctor(this.tenantId, providerId);
    return doctor ? hisOk(asProvider(doctor)) : hisFail("not_found", "No such provider in the demonstration directory.");
  }

  async listAppointments(options: { patientId?: string; from?: string; to?: string }): Promise<HisResult<HisAppointment[]>> {
    const doctors = new Map(getDoctors(this.tenantId).map((doctor) => [doctor.id, doctor.name]));
    const from = options.from ? new Date(options.from).getTime() : null;
    const to = options.to ? new Date(options.to).getTime() : null;

    return hisOk(
      getAppointments(this.tenantId)
        .filter((appointment) => {
          const at = new Date(appointment.scheduledAt).getTime();
          if (from !== null && at < from) return false;
          if (to !== null && at > to) return false;
          return true;
        })
        .map((appointment) => ({
          id: appointment.id,
          patientId: null,
          providerId: appointment.doctorId,
          providerName: doctors.get(appointment.doctorId) ?? null,
          scheduledAt: appointment.scheduledAt,
          durationMinutes: appointment.durationMinutes,
          status: appointment.status,
          demo: true,
        }))
    );
  }

  // The stand-in accepts these because the appointment book it is standing in
  // for is the local one. The caller still treats the answer as the hospital's
  // answer rather than assuming success, which is what keeps the live path
  // honest when the same code runs against a real server.
  async confirmAppointment(reference: string): Promise<HisResult<{ status: string }>> {
    const appointment = getAppointments(this.tenantId).find((row) => row.id === reference);
    if (!appointment) return hisFail("not_found", "No such appointment in the demonstration records.");
    if (appointment.status === "cancelled") {
      return hisFail("rejected", "That appointment has been cancelled and cannot be confirmed.");
    }
    return hisOk({ status: "confirmed" });
  }

  async cancelAppointment(reference: string): Promise<HisResult<{ status: string }>> {
    const appointment = getAppointments(this.tenantId).find((row) => row.id === reference);
    if (!appointment) return hisFail("not_found", "No such appointment in the demonstration records.");
    if (appointment.status === "completed") {
      return hisFail("rejected", "That appointment has already taken place.");
    }
    return hisOk({ status: "cancelled" });
  }

  async rescheduleAppointment(reference: string): Promise<HisResult<{ status: string }>> {
    const appointment = getAppointments(this.tenantId).find((row) => row.id === reference);
    if (!appointment) return hisFail("not_found", "No such appointment in the demonstration records.");
    return hisOk({ status: "rescheduled" });
  }

  async getMedicalHistory(patientId: string): Promise<HisResult<HisHistorySummary>> {
    const patient = getHisPatients(this.tenantId).find((row) => row.patientId === patientId);
    if (!patient) return hisFail("not_found", "No such patient in the demonstration directory.");
    // The stand-in reports what Tringlo itself holds, because in demo mode
    // that is where a collected history lives. It does not invent a clinical
    // record the hospital would have had.
    const local = getMedicalHistoryByPatient(this.tenantId, patientId);
    return hisOk({
      exists: Boolean(local),
      reference: local?.id ?? null,
      summary: local ? "A preliminary, patient-reported history has been collected." : null,
      updatedAt: local?.updatedAt ?? null,
    });
  }

  async updateMedicalHistory(): Promise<HisResult<{ reference: string }>> {
    return hisFail(
      "unsupported",
      "The demonstration hospital server does not accept medical history writes, so the history is held in Tringlo and labelled as such."
    );
  }

  async submitReport(): Promise<HisResult<HisSubmissionReceipt>> {
    return hisOk({
      reference: `demo-${Date.now().toString(36)}`,
      acceptedAt: new Date().toISOString(),
    });
  }

  async listFaqs(): Promise<HisResult<HisFaq[]>> {
    return hisOk(
      getHospitalFaqs(this.tenantId)
        .filter((faq) => faq.active)
        .map((faq) => ({ question: faq.question, answer: faq.answer, category: faq.topic ?? null }))
    );
  }
}

/**
 * The stand-in's provider directory, read directly.
 *
 * The one place anything bypasses the async interface, and only for this
 * implementation: its answer comes from this installation's own records, so
 * there is nothing to wait for. It is what lets the agent's synchronous
 * context assembly work in demonstration mode without a cache warm-up.
 */
export function demoProviders(tenantId: string): HisProvider[] {
  return getDoctors(tenantId).map(asProvider);
}

/** A local doctor row as the provider directory the rest of the code sees. */
function asProvider(doctor: Doctor): HisProvider {
  return {
    id: doctor.id,
    name: doctor.name,
    specialty: doctor.specialty,
    department: doctor.department ?? null,
    qualifications: doctor.qualifications ?? null,
    days: doctor.schedule.days,
    hours: { start: doctor.schedule.start, end: doctor.schedule.end },
    slotMinutes: doctor.schedule.slotMinutes,
    breaks: doctor.schedule.breaks,
    unavailableDates: doctor.exceptions
      .filter((entry) => entry.kind === "leave" || entry.kind === "holiday")
      .map((entry) => entry.date),
    specialHours: doctor.exceptions
      .filter((entry) => entry.kind === "special_hours" && entry.hours)
      .map((entry) => ({ date: entry.date, start: entry.hours!.start, end: entry.hours!.end })),
    accepting: doctor.status === "active",
    consultationFee: doctor.consultationFee ?? null,
    avatar: doctor.avatar ?? null,
    demo: doctor.demo,
  };
}
