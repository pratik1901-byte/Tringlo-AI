// ============================================================
// Hospital — patients
// ============================================================
//
// A patient is a person this hospital has a record of: the lead their number
// resolves to in this workspace, with the appointments, calls and remembered
// facts that hang off it. Nothing is joined across workspaces — a number
// known to another Tringlo customer is a different person here.
//
// Numbers are masked in the list, where a screen is read over someone's
// shoulder. The full number is on the patient's own page, which is where
// someone has actually asked for it.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { scopeToTenant } from "@/lib/auth/guard";
import { requireHospitalAuth } from "@/lib/hospital/guard";
import {
  findCustomerProfileByPhone,
  getAppointments,
  getCallRecords,
  getLeads,
  getMemoryItems,
  getReminders,
  saveLead,
} from "@/lib/db";
import { normalisePhone } from "@/lib/customers/identity";
import { providers as hospitalProviders } from "@/lib/hospital/directory";
import { historyForPatient, visitNotesFor } from "@/lib/hospital/history";
import { audit, hospitalProfile } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

/** Shows enough of a number to recognise, not enough to dial. */
function mask(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${phone.startsWith("+") ? "+" : ""}${digits.slice(0, 2)} ••••• ${digits.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const tenantId = auth.tenantId;
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const patients = scopeToTenant(getLeads(), tenantId);
  const appointments = getAppointments(tenantId);
  const calls = scopeToTenant(getCallRecords(), tenantId);

  if (id) {
    const patient = patients.find((lead) => lead.id === id);
    if (!patient) return NextResponse.json({ error: { message: "Not found." } }, { status: 404, headers: noStore });

    const doctors = new Map(hospitalProviders(tenantId).map((provider) => [provider.id, provider.name]));
    const national = normalisePhone(patient.phone).national;
    const profile = national ? findCustomerProfileByPhone(tenantId, national) : undefined;
    const reminders = getReminders(tenantId);

    return NextResponse.json(
      {
        patient: { ...patient, phoneMasked: mask(patient.phone) },
        appointments: appointments
          .filter((appointment) => appointment.patientLeadId === patient.id)
          .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
          .map((appointment) => ({
            ...appointment,
            doctorName: doctors.get(appointment.doctorId) ?? null,
            reminder: reminders.find((r) => r.appointmentId === appointment.id && r.status !== "cancelled")?.status ?? null,
          })),
        calls: calls
          .filter((call) => call.leadId === patient.id)
          .sort((a, b) => (b.requestedAt ?? "").localeCompare(a.requestedAt ?? ""))
          .map((call) => ({
            id: call.id,
            at: call.requestedAt ?? call.startedAt,
            direction: call.direction ?? "outbound",
            status: call.status,
            duration: call.duration,
            summary: call.aiSummary,
            origin: call.origin ?? null,
          })),
        // Administrative memory only: what was agreed, preferred or asked for.
        // Not a clinical record, and not used as one.
        memory: profile ? getMemoryItems(tenantId, profile.id) : [],
        /**
         * Whether this patient has a longitudinal history, and where it is
         * held — not what is in it. The answers are read on the Medical
         * History page, which is the one place access to them is granted.
         */
        history: (() => {
          const history = historyForPatient(tenantId, { patientLeadId: patient.id });
          return history
            ? {
                id: history.id,
                canonicalPatientId: history.canonicalPatientId,
                provisional: history.provisional,
                storage: history.storage,
                sync: history.sync.state,
                updatedAt: history.updatedAt,
                revisions: history.revisions.length,
              }
            : null;
        })(),
        /** Visit-specific notes, which are not the longitudinal history. */
        visitNotes: visitNotesFor(tenantId, patient.id).slice(0, 20),
        consent: {
          optedOut: Boolean(patient.suppressed),
          reason: patient.suppressedReason ?? null,
          since: patient.suppressedAt ?? null,
        },
      },
      { headers: noStore }
    );
  }

  const search = (params.get("q") ?? "").trim().toLowerCase();
  const rows = patients
    .filter((lead) =>
      search ? lead.name.toLowerCase().includes(search) || lead.phone.replace(/\D/g, "").includes(search.replace(/\D/g, "")) : true
    )
    .map((lead) => {
      const theirs = appointments.filter((appointment) => appointment.patientLeadId === lead.id);
      const upcoming = theirs.filter(
        (appointment) =>
          new Date(appointment.scheduledAt).getTime() >= Date.now() &&
          (appointment.status === "confirmed" || appointment.status === "requested" || appointment.status === "rescheduled")
      );
      return {
        id: lead.id,
        name: lead.name,
        phoneMasked: mask(lead.phone),
        appointments: theirs.length,
        upcoming: upcoming.length,
        missed: theirs.filter((appointment) => appointment.status === "missed").length,
        calls: calls.filter((call) => call.leadId === lead.id).length,
        optedOut: Boolean(lead.suppressed),
        demo: theirs.some((appointment) => appointment.demo),
      };
    })
    .sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name));

  return NextResponse.json({ patients: rows, timezone: hospitalProfile(tenantId).timezone }, { headers: noStore });
}

/** Consent: a patient who asks not to be called is not called. */
export async function PUT(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const patient = scopeToTenant(getLeads(), auth.tenantId).find((lead) => lead.id === String(body?.id ?? ""));
  if (!patient) return NextResponse.json({ error: { message: "Not found." } }, { status: 404, headers: noStore });

  if (typeof body?.optedOut === "boolean") {
    const next = saveLead({
      ...patient,
      suppressed: body.optedOut,
      suppressedReason: body.optedOut ? String(body?.reason ?? "asked not to be called") : null,
      suppressedAt: body.optedOut ? new Date().toISOString() : null,
    });
    audit(auth.tenantId, auth.user.id, body.optedOut ? "patient.opted_out" : "patient.opt_in_restored", patient.id, null);
    return NextResponse.json({ patient: { ...next, phoneMasked: mask(next.phone) } }, { headers: noStore });
  }

  if (typeof body?.name === "string" && body.name.trim()) {
    const next = saveLead({ ...patient, name: body.name.trim() });
    audit(auth.tenantId, auth.user.id, "patient.renamed", patient.id, null);
    return NextResponse.json({ patient: { ...next, phoneMasked: mask(next.phone) } }, { headers: noStore });
  }

  return NextResponse.json({ error: { message: "Nothing to change." } }, { status: 400, headers: noStore });
}
