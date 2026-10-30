// ============================================================
// Hospital — appointments
// ============================================================
//
// Booking, moving, closing and removing. Every one of them goes through the
// service, so a booking made here and one made by the agent on a call are
// checked the same way and leave the same trail.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getAppointmentEvents, getAppointments, getOpenCancellationRequest, getReminders } from "@/lib/db";
import { providers as hospitalProviders } from "@/lib/hospital/directory";
import { requestCancellation } from "@/lib/hospital/cancellations";
import {
  availabilityFor,
  bookAppointment,
  hospitalProfile,
  localDate,
  removeAppointment,
  rescheduleAppointment,
  setAppointmentStatus,
  slotsFor,
} from "@/lib/hospital/service";
import type { AppointmentStatus } from "@/lib/hospital/types";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const tenantId = auth.tenantId;
  const profile = hospitalProfile(tenantId);

  // Free slots for a doctor or a specialty on one date.
  if (params.get("slots")) {
    const date = params.get("date") ?? localDate(new Date(), profile.timezone);
    const doctorId = params.get("doctorId");
    if (doctorId) return NextResponse.json({ date, slots: slotsFor(tenantId, doctorId, date) }, { headers: noStore });
    return NextResponse.json(
      { date, doctors: availabilityFor(tenantId, date, { specialty: params.get("specialty") ?? undefined }) },
      { headers: noStore }
    );
  }

  // Doctors come from the hospital's directory; Tringlo keeps none of its own.
  const doctors = new Map(hospitalProviders(tenantId).map((provider) => [provider.id, provider]));
  const reminders = getReminders(tenantId);
  const id = params.get("id");

  if (id) {
    const appointment = getAppointments(tenantId).find((row) => row.id === id);
    if (!appointment) {
      return NextResponse.json({ error: { message: "Not found." } }, { status: 404, headers: noStore });
    }
    return NextResponse.json(
      {
        appointment: { ...appointment, doctorName: doctors.get(appointment.doctorId)?.name ?? null },
        events: getAppointmentEvents(tenantId, id).sort((a, b) => b.at.localeCompare(a.at)),
        confirmationCall: reminders.find((r) => r.appointmentId === id && r.status !== "cancelled") ?? null,
        cancellationRequest: getOpenCancellationRequest(tenantId, id) ?? null,
      },
      { headers: noStore }
    );
  }

  const status = params.get("status");
  const doctorId = params.get("doctorId");
  const date = params.get("date");
  const search = (params.get("q") ?? "").trim().toLowerCase();

  const rows = getAppointments(tenantId)
    .filter((appointment) => (status ? appointment.status === status : true))
    .filter((appointment) => (doctorId ? appointment.doctorId === doctorId : true))
    .filter((appointment) => (date ? localDate(appointment.scheduledAt, profile.timezone) === date : true))
    .filter((appointment) =>
      search
        ? appointment.patientName.toLowerCase().includes(search) ||
          appointment.patientPhone.includes(search) ||
          appointment.id.toLowerCase().includes(search) ||
          (doctors.get(appointment.doctorId)?.name ?? "").toLowerCase().includes(search)
        : true
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((appointment) => ({
      ...appointment,
      doctorName: doctors.get(appointment.doctorId)?.name ?? null,
      confirmationCall: reminders.find((r) => r.appointmentId === appointment.id && r.status !== "cancelled") ?? null,
      cancellationPending: Boolean(getOpenCancellationRequest(tenantId, appointment.id)),
    }));

  return NextResponse.json({ appointments: rows, timezone: profile.timezone }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  for (const field of ["doctorId", "date", "time", "patientName", "patientPhone"]) {
    if (!String(body?.[field] ?? "").trim()) {
      return NextResponse.json({ error: { message: `${field} is required.` } }, { status: 400, headers: noStore });
    }
  }

  const result = bookAppointment({
    tenantId: auth.tenantId,
    doctorId: String(body.doctorId),
    date: String(body.date),
    time: String(body.time),
    patientName: String(body.patientName),
    patientPhone: String(body.patientPhone),
    reason: body?.reason ? String(body.reason) : null,
    source: "staff",
    status: body?.status === "requested" ? "requested" : "confirmed",
    actor: auth.user.id,
  });

  if (!result.ok) return NextResponse.json({ error: { message: result.problem } }, { status: 409, headers: noStore });
  return NextResponse.json(
    { appointment: result.appointment, confirmationCall: result.reminder },
    { status: 201, headers: noStore }
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!id) return NextResponse.json({ error: { message: "id is required." } }, { status: 400, headers: noStore });

  // Moving it.
  if (body?.date && body?.time) {
    const result = rescheduleAppointment(
      auth.tenantId,
      id,
      { doctorId: body?.doctorId, date: String(body.date), time: String(body.time), note: body?.note ?? null },
      auth.user.id
    );
    if (!result.ok) return NextResponse.json({ error: { message: result.problem } }, { status: 409, headers: noStore });
    // The confirmation call for the old time is cancelled and a new one timed
    // from the new appointment — see `scheduleReminderFor`.
    return NextResponse.json({ appointment: result.appointment, confirmationCall: result.reminder }, { headers: noStore });
  }

  // Or closing it out.
  const status = String(body?.status ?? "") as AppointmentStatus;
  const allowed: AppointmentStatus[] = ["requested", "confirmed", "rescheduled", "completed", "cancelled", "missed"];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: { message: "Give a new date and time, or a status." } }, { status: 400, headers: noStore });
  }

  // A cancellation is not a status flip. It goes to the hospital's own system
  // through the cancellation workflow, and the appointment comes off the book
  // only if that confirms — so the panel cannot show a cancellation the
  // hospital never accepted.
  if (status === "cancelled") {
    const outcome = await requestCancellation({
      tenantId: auth.tenantId,
      appointmentId: id,
      requestedVia: "staff",
      reason: body?.note ? String(body.note) : null,
      actor: auth.user.id,
      // Staff working in the panel are already authenticated.
      identityVerified: true,
    });
    if ("error" in outcome) {
      return NextResponse.json({ error: { message: outcome.error } }, { status: 409, headers: noStore });
    }
    return NextResponse.json(
      {
        appointment: getAppointments(auth.tenantId).find((row) => row.id === id) ?? null,
        cancellation: outcome.request,
        cancelled: outcome.cancelled,
        message: outcome.message,
        needsStaff: outcome.needsStaff,
      },
      { headers: noStore }
    );
  }

  const result = setAppointmentStatus(auth.tenantId, id, status, auth.user.id, body?.note ?? null);
  if (!result.ok) return NextResponse.json({ error: { message: result.problem } }, { status: 404, headers: noStore });
  return NextResponse.json({ appointment: result.appointment, confirmationCall: result.reminder }, { headers: noStore });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const removed = removeAppointment(auth.tenantId, id, auth.user.id, params.get("note"));
  if (!removed) return NextResponse.json({ error: { message: "Not found." } }, { status: 404, headers: noStore });
  return NextResponse.json({ ok: true }, { headers: noStore });
}
