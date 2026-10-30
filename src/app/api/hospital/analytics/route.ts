// ============================================================
// Hospital — analytics
// ============================================================
//
// Counts of what is in the database, over a window the caller chooses.
//
// Only what the records support. There is no "patient satisfaction", no
// benchmark and no percentage improvement: this hospital's data says how many
// calls happened and what came of them, and saying more than that from call
// volume would be an invention.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { scopeToTenant } from "@/lib/auth/guard";
import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getAppointments, getCallRecords, getReminders } from "@/lib/db";
import { consultingProviders } from "@/lib/hospital/directory";
import { listCancellationRequests } from "@/lib/hospital/cancellations";
import { listFollowUps } from "@/lib/hospital/followups";
import { listUnanswered } from "@/lib/hospital/inquiries";
import { listReports } from "@/lib/hospital/reports";
import { listSessions } from "@/lib/hospital/questionnaire";
import { listHistories } from "@/lib/hospital/history";
import { hospitalProfile, localDate } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const tenantId = auth.tenantId;
  const profile = hospitalProfile(tenantId);
  const days = Math.min(90, Math.max(7, Number(new URL(request.url).searchParams.get("days") ?? 30)));
  const since = Date.now() - days * 86400_000;

  const calls = scopeToTenant(getCallRecords(), tenantId).filter(
    (call) => new Date(call.requestedAt ?? call.startedAt ?? 0).getTime() >= since
  );
  const appointments = getAppointments(tenantId).filter((row) => new Date(row.createdAt).getTime() >= since);
  const reminders = getReminders(tenantId).filter((row) => new Date(row.createdAt).getTime() >= since);
  const doctors = consultingProviders(tenantId);

  // One bucket per day, so an empty day is a zero rather than a gap.
  const byDay = new Map<string, { date: string; inbound: number; outbound: number; appointments: number }>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = localDate(new Date(Date.now() - index * 86400_000), profile.timezone);
    byDay.set(date, { date, inbound: 0, outbound: 0, appointments: 0 });
  }
  for (const call of calls) {
    const date = localDate(call.requestedAt ?? call.startedAt ?? new Date(), profile.timezone);
    const bucket = byDay.get(date);
    if (bucket) bucket[(call.direction ?? "outbound") === "inbound" ? "inbound" : "outbound"] += 1;
  }
  for (const appointment of appointments) {
    const bucket = byDay.get(localDate(appointment.createdAt, profile.timezone));
    if (bucket) bucket.appointments += 1;
  }

  const open = appointments.filter((row) => row.status === "confirmed" || row.status === "rescheduled");
  const utilisation = doctors
    .map((doctor) => ({
      doctorId: doctor.id,
      name: doctor.name,
      specialty: doctor.specialty,
      booked: getAppointments(tenantId).filter(
        (row) => row.doctorId === doctor.id && new Date(row.scheduledAt).getTime() >= Date.now()
      ).length,
    }))
    .sort((a, b) => b.booked - a.booked);

  return NextResponse.json(
    {
      days,
      timezone: profile.timezone,
      totals: {
        inboundCalls: calls.filter((call) => call.direction === "inbound").length,
        outboundCalls: calls.filter((call) => call.direction !== "inbound").length,
        appointmentsCreated: appointments.length,
        confirmed: open.length,
        cancelled: appointments.filter((row) => row.status === "cancelled").length,
        rescheduled: appointments.filter((row) => row.status === "rescheduled").length,
        missed: appointments.filter((row) => row.status === "missed").length,
        completed: appointments.filter((row) => row.status === "completed").length,
        remindersSent: reminders.filter((row) => row.status === "sent").length,
        remindersFailed: reminders.filter((row) => row.status === "failed").length,
        remindersSkipped: reminders.filter((row) => row.status === "skipped").length,
        handoffs: calls.filter((call) => call.humanHandoffStatus && call.humanHandoffStatus !== "none").length,
        /** Said plainly, so no figure above is mistaken for real activity. */
        fromDemoData: appointments.filter((row) => row.demo).length,
      },
      // The intake side, counted the same way: from records that exist.
      intake: (() => {
        const sessions = listSessions(tenantId).filter((row) => new Date(row.startedAt).getTime() >= since);
        const reports = listReports(tenantId).filter((row) => new Date(row.collectedAt).getTime() >= since);
        const followUps = listFollowUps(tenantId).filter((row) => new Date(row.requestedAt).getTime() >= since);
        const cancellations = listCancellationRequests(tenantId).filter(
          (row) => new Date(row.requestedAt).getTime() >= since
        );
        const unanswered = listUnanswered(tenantId).filter((row) => new Date(row.at).getTime() >= since);
        return {
          questionnairesStarted: sessions.length,
          questionnairesCompleted: sessions.filter((row) => row.status === "complete").length,
          questionnairesEscalated: sessions.filter((row) => row.status === "escalated").length,
          consentDeclined: sessions.filter((row) => row.consent && !row.consent.granted).length,
          // One per patient, always. Shown so the rule is visible as a number.
          historiesOnFile: listHistories(tenantId).length,
          reportsReady: reports.filter((row) => row.status === "ready").length,
          reportsSubmitted: reports.filter((row) => row.status === "submitted").length,
          reportsFailed: reports.filter((row) => row.status === "failed").length,
          reportsReviewed: reports.filter((row) => row.status === "reviewed").length,
          followUpsRequested: followUps.length,
          followUpsCompleted: followUps.filter((row) => row.status === "completed").length,
          cancellationsRequested: cancellations.length,
          cancellationsConfirmed: cancellations.filter((row) => row.status === "confirmed").length,
          cancellationsUnresolved: cancellations.filter(
            (row) => row.status !== "confirmed" && row.status !== "rejected"
          ).length,
          inquiriesUnanswered: unanswered.length,
          confirmationsAnswered: reminders.filter((row) => Boolean(row.outcome)).length,
          confirmationsConfirmedByPatient: reminders.filter((row) => row.outcome?.response === "confirmed").length,
        };
      })(),
      series: [...byDay.values()],
      utilisation,
    },
    { headers: noStore }
  );
}
