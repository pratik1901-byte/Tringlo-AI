// ============================================================
// Hospital — overview
// ============================================================
//
// Everything the dashboard needs in one read: the hospital's own settings, the
// work waiting on somebody, and the state of the integration it all depends
// on. Scoped to the workspace the caller is signed into — the tenant comes
// from the session, never from the request, so a panel cannot ask for another
// hospital's day.
//
// Every figure below is counted from records that exist. None is estimated,
// and `demo` counts are reported separately so the panel can say which of the
// activity on screen is fictional.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { scopeToTenant } from "@/lib/auth/guard";
import { requireHospitalAuth, workspaceView } from "@/lib/hospital/guard";
import { getAppointments, getCallRecords, getReminders } from "@/lib/db";
import { pendingCancellations } from "@/lib/hospital/cancellations";
import { directoryStatus, providers } from "@/lib/hospital/directory";
import { openFollowUps } from "@/lib/hospital/followups";
import { integrationStatus } from "@/lib/hospital/his";
import { listUnanswered } from "@/lib/hospital/inquiries";
import { awaitingReview, listReports } from "@/lib/hospital/reports";
import { hospitalProfile, localDate } from "@/lib/hospital/service";
import { OPEN_APPOINTMENT_STATUSES } from "@/lib/hospital/types";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const tenantId = auth.tenantId;
  const profile = hospitalProfile(tenantId);
  const now = new Date();
  const today = localDate(now, profile.timezone);

  const directory = providers(tenantId);
  const appointments = getAppointments(tenantId);
  const confirmations = getReminders(tenantId);
  const calls = scopeToTenant(getCallRecords(), tenantId);

  const open = appointments.filter((appointment) => OPEN_APPOINTMENT_STATUSES.includes(appointment.status));
  const upcoming = open
    .filter((appointment) => new Date(appointment.scheduledAt).getTime() >= now.getTime())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const inbound = calls.filter((call) => call.direction === "inbound");
  const outbound = calls.filter((call) => call.direction !== "inbound");
  const cancellations = pendingCancellations(tenantId);
  const reports = listReports(tenantId);
  const unanswered = listUnanswered(tenantId, { status: "open" });
  const followUps = openFollowUps(tenantId);

  const doctorName = (doctorId: string) => directory.find((provider) => provider.id === doctorId)?.name ?? null;

  return NextResponse.json(
    {
      profile,
      today,
      // Which Tringlo workspace these records belong to, and whether this
      // panel named it or merely followed the session.
      workspace: workspaceView(tenantId),
      integration: integrationStatus(tenantId),
      directory: directoryStatus(tenantId),
      metrics: {
        appointmentsToday: open.filter((a) => localDate(a.scheduledAt, profile.timezone) === today).length,
        upcoming: upcoming.length,
        // Still only requested: nobody has said the patient is coming.
        awaitingConfirmation: appointments.filter((a) => a.status === "requested").length,
        confirmationsScheduled: confirmations.filter((c) => c.status === "scheduled").length,
        confirmationsPending: confirmations.filter((c) => c.status === "due" || c.status === "calling").length,
        confirmationsCompleted: confirmations.filter((c) => c.status === "sent").length,
        confirmationsFailed: confirmations.filter((c) => c.status === "failed").length,
        confirmationsCancelled: confirmations.filter((c) => c.status === "cancelled").length,
        cancellationsAwaiting: cancellations.length,
        reportsAwaitingReview: awaitingReview(tenantId).length,
        reportsSubmissionFailed: reports.filter((report) => report.status === "failed").length,
        unansweredInquiries: unanswered.length,
        openFollowUps: followUps.length,
        inboundCalls: inbound.length,
        outboundCalls: outbound.length,
        missed: appointments.filter((a) => a.status === "missed").length,
        handoffs: calls.filter((c) => c.humanHandoffStatus && c.humanHandoffStatus !== "none").length,
        doctorsListed: directory.filter((provider) => provider.accepting).length,
        /** So the panel can say plainly which rows are demonstration data. */
        demoAppointments: appointments.filter((a) => a.demo).length,
        demoFollowUps: followUps.filter((followUp) => followUp.demo).length,
      },
      upcoming: upcoming.slice(0, 8).map((appointment) => ({
        ...appointment,
        doctorName: doctorName(appointment.doctorId),
        confirmation: confirmations.find((c) => c.appointmentId === appointment.id && c.status !== "cancelled") ?? null,
      })),
      // The work that needs a person, each with enough to act on.
      cancellationsAwaiting: cancellations.slice(0, 6).map((entry) => ({
        id: entry.id,
        appointmentId: entry.appointmentId,
        status: entry.status,
        requestedAt: entry.requestedAt,
        failureReason: entry.failureReason,
        patientName: appointments.find((a) => a.id === entry.appointmentId)?.patientName ?? null,
      })),
      reportsAwaitingReview: awaitingReview(tenantId)
        .slice(0, 6)
        .map((report) => ({
          id: report.id,
          patientName: report.patientName,
          collectedAt: report.collectedAt,
          status: report.status,
          failureReason: report.failureReason,
          demo: report.demo,
        })),
      followUps: followUps.slice(0, 6).map((followUp) => ({
        id: followUp.id,
        patientName: followUp.patientName,
        reason: followUp.reason,
        requestedAt: followUp.requestedAt,
        status: followUp.status,
        demo: followUp.demo,
      })),
      unanswered: unanswered.slice(0, 6).map((inquiry) => ({
        id: inquiry.id,
        question: inquiry.question,
        at: inquiry.at,
        handoff: inquiry.handoff,
      })),
      recentCalls: calls
        .slice()
        .sort((a, b) => (b.requestedAt ?? b.startedAt ?? "").localeCompare(a.requestedAt ?? a.startedAt ?? ""))
        .slice(0, 8)
        .map((call) => ({
          id: call.id,
          name: call.lead?.name ?? null,
          phone: call.lead?.phone ?? null,
          direction: call.direction ?? "outbound",
          at: call.requestedAt ?? call.startedAt,
          status: call.status,
          summary: call.aiSummary,
          origin: call.origin ?? null,
          handoff: call.humanHandoffStatus ?? "none",
        })),
      attention: {
        requested: appointments.filter((a) => a.status === "requested").length,
        missed: appointments.filter((a) => a.status === "missed").length,
        failedConfirmations: confirmations.filter((c) => c.status === "failed").length,
        skippedConfirmations: confirmations.filter((c) => c.status === "skipped").length,
        cancellationsAwaiting: cancellations.length,
        reportsAwaitingReview: awaitingReview(tenantId).length,
        unansweredInquiries: unanswered.length,
        openFollowUps: followUps.length,
      },
    },
    { headers: noStore }
  );
}
