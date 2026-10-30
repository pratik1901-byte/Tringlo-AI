// ============================================================
// Hospital — call history
// ============================================================
//
// The platform's own call records, read for this workspace. Nothing here is
// generated: a duration, a summary or a transcript appears only because the
// provider reported one, and a call with none shows none.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { scopeToTenant } from "@/lib/auth/guard";
import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getAppointments, getCallRecords, getReminders } from "@/lib/db";
import { providers as hospitalProviders } from "@/lib/hospital/directory";
import { hospitalProfile } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

function mask(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${phone.startsWith("+") ? "+" : ""}${digits.slice(0, 2)} ••••• ${digits.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const tenantId = auth.tenantId;
  const params = new URL(request.url).searchParams;
  const calls = scopeToTenant(getCallRecords(), tenantId);
  const reminders = getReminders(tenantId);
  const appointments = getAppointments(tenantId);
  const doctors = new Map(hospitalProviders(tenantId).map((provider) => [provider.id, provider.name]));

  // The appointment a call relates to: the one a confirmation reminder placed
  // it for, or — for an inbound call Maya booked on — the one that records this
  // call as its origin. Either way the booking result shows on the call.
  const appointmentForCall = (callId: string) => {
    const reminder = reminders.find((entry) => entry.callId === callId);
    if (reminder) {
      const viaReminder = appointments.find((row) => row.id === reminder.appointmentId);
      if (viaReminder) return viaReminder;
    }
    return appointments.find((row) => row.callId === callId);
  };

  const id = params.get("id");
  if (id) {
    const call = calls.find((record) => record.id === id);
    if (!call) return NextResponse.json({ error: { message: "Not found." } }, { status: 404, headers: noStore });
    const appointment = appointmentForCall(call.id);
    return NextResponse.json(
      {
        call: {
          ...call,
          phoneMasked: mask(call.lead?.phone),
          appointmentId: appointment?.id ?? null,
          doctorName: appointment ? doctors.get(appointment.doctorId) ?? null : null,
        },
      },
      { headers: noStore }
    );
  }

  const direction = params.get("direction");
  const status = params.get("status");
  const search = (params.get("q") ?? "").trim().toLowerCase();

  const rows = calls
    .filter((call) => (direction ? (call.direction ?? "outbound") === direction : true))
    .filter((call) => (status ? call.status === status : true))
    .filter((call) =>
      search
        ? (call.lead?.name ?? "").toLowerCase().includes(search) ||
          (call.lead?.phone ?? "").replace(/\D/g, "").includes(search.replace(/\D/g, ""))
        : true
    )
    .sort((a, b) => (b.requestedAt ?? b.startedAt ?? "").localeCompare(a.requestedAt ?? a.startedAt ?? ""))
    .slice(0, 300)
    .map((call) => {
      const reminder = reminders.find((entry) => entry.callId === call.id);
      const appointment = appointmentForCall(call.id);
      return {
        id: call.id,
        name: call.lead?.name ?? null,
        phoneMasked: mask(call.lead?.phone),
        direction: call.direction ?? "outbound",
        at: call.requestedAt ?? call.startedAt,
        status: call.status,
        duration: call.duration,
        summary: call.aiSummary,
        /** Why the call happened, as far as the records show. */
        purpose: reminder ? "Appointment reminder" : call.origin === "scheduler" ? "Scheduled callback" : call.origin === "campaign" ? "Campaign" : call.direction === "inbound" ? "Inbound enquiry" : "Outbound call",
        appointmentId: appointment?.id ?? null,
        doctorName: appointment ? doctors.get(appointment.doctorId) ?? null : null,
        handoff: call.humanHandoffStatus ?? "none",
        agent: call.agentName ?? null,
        hasTranscript: Boolean(call.transcriptTurns?.length || call.transcript),
      };
    });

  return NextResponse.json({ calls: rows, timezone: hospitalProfile(tenantId).timezone }, { headers: noStore });
}
