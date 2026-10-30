// ============================================================
// Hospital — cancellation requests
// ============================================================
//
// A patient may ask at any hour; there is no window on this endpoint. What it
// will not do is report an appointment cancelled before the hospital's own
// system has confirmed it.
//
// So a successful HTTP response does not mean "cancelled". It means the
// request was taken, and `cancelled` in the body says whether the appointment
// actually came off the book.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { confirm, listCancellationRequests, requestCancellation, submit } from "@/lib/hospital/cancellations";
import { getAppointment } from "@/lib/db";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const rows = listCancellationRequests(auth.tenantId).map((entry) => {
    const appointment = getAppointment(auth.tenantId, entry.appointmentId);
    return {
      ...entry,
      appointment: appointment
        ? {
            id: appointment.id,
            patientName: appointment.patientName,
            scheduledAt: appointment.scheduledAt,
            status: appointment.status,
            specialty: appointment.specialty,
          }
        : null,
    };
  });

  return NextResponse.json(
    {
      requests: rows,
      awaitingStaff: rows.filter((row) => row.routedToStaff && row.status !== "confirmed").length,
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "request");
  const fail = (message: string, status = 400) =>
    NextResponse.json({ error: { message } }, { status, headers: noStore });

  if (action === "request") {
    const outcome = await requestCancellation({
      tenantId: auth.tenantId,
      appointmentId: String(body?.appointmentId ?? ""),
      canonicalPatientId: typeof body?.patientId === "string" ? body.patientId : null,
      requestedVia: ["inbound_call", "confirmation_call", "staff", "agent"].includes(String(body?.via))
        ? body.via
        : "staff",
      reason: typeof body?.reason === "string" ? body.reason : null,
      actor: auth.user.id,
      // Staff working in the panel are authenticated. An agent acting on a
      // call must say that the caller was verified, and the agent only knows
      // that from the hospital's own identity check.
      identityVerified: body?.via === "staff" || body?.via === undefined ? true : Boolean(body?.identityVerified),
    });
    if ("error" in outcome) return fail(outcome.error, 409);

    return NextResponse.json(
      {
        request: outcome.request,
        cancelled: outcome.cancelled,
        message: outcome.message,
        needsStaff: outcome.needsStaff,
      },
      { headers: noStore }
    );
  }

  // Retrying one the hospital's system could not take.
  if (action === "retry") {
    const outcome = await submit(auth.tenantId, String(body?.id ?? ""), auth.user.id);
    if ("error" in outcome) return fail(outcome.error, 404);
    return NextResponse.json(outcome, { headers: noStore });
  }

  // Staff confirming by hand what the hospital's system cannot take from here.
  if (action === "confirm") {
    const outcome = await confirm(
      auth.tenantId,
      String(body?.id ?? ""),
      auth.user.id,
      String(body?.because ?? "").trim() || "confirmed by hospital staff in the panel"
    );
    if ("error" in outcome) return fail(outcome.error, 404);
    return NextResponse.json(outcome, { headers: noStore });
  }

  return fail("Unknown action.");
}
