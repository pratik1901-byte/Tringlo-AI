// ============================================================
// Hospital — the confirmation call schedule
// ============================================================
//
// Reading the schedule, recording what a patient said when the agent rang, and
// the few actions staff may take. Placing the calls is the server's own job and
// happens on the platform scheduler; this route never dials.
//
// Recording an outcome is the one action here that can change an appointment,
// and it changes one only on an explicit confirmation — see
// `recordConfirmationOutcome`. A cancellation asked for on a confirmation call
// is recorded and handed to the cancellation workflow; it is not actioned here.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getAppointment, getReminder, getReminders, saveReminder } from "@/lib/db";
import {
  audit,
  hospitalProfile,
  recordConfirmationOutcome,
  reminderView,
  scheduleReminderFor,
} from "@/lib/hospital/service";
import { pauseReminderCampaign, runDailyReminders, type Strategy } from "@/lib/hospital/reminder-batch";
import { requestCancellation } from "@/lib/hospital/cancellations";
import type { ConfirmationOutcome } from "@/lib/hospital/types";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const status = new URL(request.url).searchParams.get("status");
  const profile = hospitalProfile(auth.tenantId);
  const rows = getReminders(auth.tenantId)
    .filter((reminder) => (status ? reminder.status === status : true))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map((reminder) => reminderView(auth.tenantId, reminder));

  return NextResponse.json(
    {
      reminders: rows,
      timezone: profile.timezone,
      /** So the page can say plainly why nothing is being dialled. */
      remindersEnabled: profile.remindersEnabled,
      leadHours: profile.reminderLeadHours,
      maxAttempts: profile.reminderMaxAttempts,
      /** The counts the dashboard shows, in the brief's own words. */
      counts: {
        scheduled: rows.filter((row) => row.status === "scheduled").length,
        pending: rows.filter((row) => row.status === "due" || row.status === "calling").length,
        completed: rows.filter((row) => row.status === "sent").length,
        failed: rows.filter((row) => row.status === "failed").length,
        cancelled: rows.filter((row) => row.status === "cancelled").length,
        skipped: rows.filter((row) => row.status === "skipped").length,
        answered: rows.filter((row) => Boolean(row.outcome)).length,
        confirmed: rows.filter((row) => row.outcome?.response === "confirmed").length,
        rescheduled: rows.filter((row) => row.outcome?.response === "reschedule_requested").length,
        noAnswer: rows.filter((row) => row.outcome?.response === "no_answer").length,
        batch: rows.filter((row) => row.dispatchMethod === "batch").length,
        instant: rows.filter((row) => row.dispatchMethod === "instant").length,
      },
      /** Distinct Sarvam campaigns these reminders were dispatched in. */
      campaigns: [...new Set(rows.map((row) => row.providerCampaignId).filter(Boolean))],
    },
    { headers: noStore }
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  const action = String(body?.action ?? "");

  // --- Bulk actions (no single reminder id) ---

  // Process every eligible appointment for a day — tomorrow by default — and
  // dispatch them as instant calls or a batch campaign (AUTO chooses by volume).
  if (action === "send_all") {
    const strategy = (["auto", "instant", "batch"] as const).includes(body?.strategy) ? (body.strategy as Strategy) : "auto";
    const summary = await runDailyReminders(auth.tenantId, { strategy, date: typeof body?.date === "string" ? body.date : undefined });
    audit(auth.tenantId, auth.user.id, "reminders.send_all", summary.date, `${summary.method}: ${summary.queued}/${summary.eligibleCount}`);
    return NextResponse.json({ summary }, { headers: noStore });
  }

  // Pause an active reminder campaign at Sarvam.
  if (action === "pause_campaign") {
    const campaignId = String(body?.campaignId ?? "");
    if (!campaignId) return NextResponse.json({ error: { message: "No campaign id." } }, { status: 400, headers: noStore });
    const result = await pauseReminderCampaign(auth.tenantId, campaignId);
    if (!result.ok) return NextResponse.json({ error: { message: result.problem } }, { status: 502, headers: noStore });
    return NextResponse.json({ paused: true, campaignId }, { headers: noStore });
  }

  const reminder = getReminder(auth.tenantId, id);
  if (!reminder) return NextResponse.json({ error: { message: "Not found." } }, { status: 404, headers: noStore });

  // What the patient said. The only action that may confirm an appointment.
  if (action === "outcome") {
    const response = String(body?.response ?? "") as ConfirmationOutcome["response"];
    const allowed: ConfirmationOutcome["response"][] = [
      "confirmed",
      "cancel_requested",
      "reschedule_requested",
      "declined",
      "no_answer",
      "unclear",
    ];
    if (!allowed.includes(response)) {
      return NextResponse.json({ error: { message: "That is not a confirmation outcome." } }, { status: 400, headers: noStore });
    }

    const result = recordConfirmationOutcome(
      auth.tenantId,
      id,
      { response, note: typeof body?.note === "string" ? body.note : null },
      auth.user.id
    );
    if (!result.ok) return NextResponse.json({ error: { message: result.problem } }, { status: 409, headers: noStore });

    // A cancellation asked for on the call becomes a cancellation request,
    // which goes to the hospital's system like any other. The appointment is
    // not cancelled here.
    let cancellation = null;
    if (response === "cancel_requested") {
      const outcome = await requestCancellation({
        tenantId: auth.tenantId,
        appointmentId: result.reminder.appointmentId,
        requestedVia: "confirmation_call",
        reason: typeof body?.note === "string" ? body.note : "Asked to cancel on the confirmation call.",
        actor: auth.user.id,
        identityVerified: true,
      });
      cancellation = "error" in outcome ? { problem: outcome.error } : outcome;
    }

    return NextResponse.json(
      {
        reminder: reminderView(auth.tenantId, result.reminder),
        appointmentConfirmed: result.appointmentConfirmed,
        note: result.note,
        cancellation,
      },
      { headers: noStore }
    );
  }

  if (action === "cancel") {
    const next = saveReminder({ ...reminder, status: "cancelled", lockedAt: null, skippedReason: "cancelled by staff" });
    audit(auth.tenantId, auth.user.id, "reminder.cancelled", id, null);
    return NextResponse.json({ reminder: next }, { headers: noStore });
  }

  if (action === "retry") {
    if (reminder.status !== "failed") {
      return NextResponse.json({ error: { message: "Only a failed reminder can be retried." } }, { status: 409, headers: noStore });
    }
    // Queued for the next pass rather than dialled here: the worker is the
    // only thing that places calls, and it applies the same safety checks.
    const next = saveReminder({
      ...reminder,
      status: "scheduled",
      dueAt: new Date().toISOString(),
      lockedAt: null,
      failureReason: null,
      attempts: 0,
    });
    audit(auth.tenantId, auth.user.id, "reminder.retried", id, null);
    return NextResponse.json({ reminder: next }, { headers: noStore });
  }

  if (action === "reschedule") {
    const dueAt = new Date(String(body?.dueAt ?? ""));
    if (Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: { message: "That time could not be read." } }, { status: 400, headers: noStore });
    }
    const next = saveReminder({ ...reminder, status: "scheduled", dueAt: dueAt.toISOString(), lockedAt: null });
    audit(auth.tenantId, auth.user.id, "reminder.rescheduled", id, dueAt.toISOString());
    return NextResponse.json({ reminder: next }, { headers: noStore });
  }

  if (action === "reinstate") {
    const appointment = getAppointment(auth.tenantId, reminder.appointmentId);
    if (!appointment) {
      return NextResponse.json({ error: { message: "The appointment no longer exists." } }, { status: 409, headers: noStore });
    }
    const next = scheduleReminderFor(appointment);
    audit(auth.tenantId, auth.user.id, "reminder.reinstated", id, null);
    return NextResponse.json({ reminder: next }, { headers: noStore });
  }

  // Place this one now. The reminder is only queued here — the server's worker
  // is the single thing that dials, so every safety gate (reminders switched
  // off, demo data, an opted-out patient, a cancelled or already-answered
  // appointment) is still applied when it picks the reminder up, and a blocked
  // one is marked skipped rather than called. A few obvious cases are checked
  // up front so staff get an answer instead of a silent skip.
  if (action === "send") {
    const profile = hospitalProfile(auth.tenantId);
    const appointment = getAppointment(auth.tenantId, reminder.appointmentId);
    if (!appointment) {
      return NextResponse.json({ error: { message: "The appointment no longer exists." } }, { status: 409, headers: noStore });
    }
    if (reminder.demo || appointment.demo) {
      return NextResponse.json(
        { error: { message: "This is a demonstration appointment, so no real call is placed." } },
        { status: 409, headers: noStore }
      );
    }
    if (!profile.remindersEnabled) {
      return NextResponse.json(
        { error: { message: "Reminder calling is switched off for this hospital. Turn it on in Settings first." } },
        { status: 409, headers: noStore }
      );
    }
    if (appointment.status === "cancelled" || appointment.status === "completed" || appointment.status === "missed") {
      return NextResponse.json(
        { error: { message: `The appointment is ${appointment.status}, so there is nothing to confirm.` } },
        { status: 409, headers: noStore }
      );
    }
    if (reminder.outcome && reminder.cycle === appointment.scheduledAt) {
      return NextResponse.json(
        { error: { message: `The patient has already answered this confirmation call (${reminder.outcome.response.replace(/_/g, " ")}).` } },
        { status: 409, headers: noStore }
      );
    }
    const next = saveReminder({
      ...reminder,
      status: "scheduled",
      dueAt: new Date().toISOString(),
      lockedAt: null,
      failureReason: null,
      skippedReason: null,
    });
    audit(auth.tenantId, auth.user.id, "reminder.sent_manually", id, null);
    return NextResponse.json(
      { reminder: reminderView(auth.tenantId, next), queued: true, message: "Queued. The confirmation call will be placed on the next pass." },
      { headers: noStore }
    );
  }

  return NextResponse.json({ error: { message: "Unknown action." } }, { status: 400, headers: noStore });
}
