// ============================================================
// Hospital — follow-up requests
// ============================================================
//
// A patient's request to be contacted, and what staff do about it. Separate
// from appointments, from medical history and from the call it came out of.
//
// `callback_scheduled` cannot be set from here by hand: the only way a request
// reaches that status is `scheduleCallback` actually creating a callback, so
// the panel can never show a callback that does not exist.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getFollowUps, getLeads } from "@/lib/db";
import {
  assignFollowUp,
  createFollowUp,
  listFollowUps,
  scheduleCallback,
  setFollowUpStatus,
} from "@/lib/hospital/followups";
import { OPEN_FOLLOW_UP_STATUSES, type HospitalFollowUpStatus } from "@/lib/hospital/records";
import { patientFor } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

const STATUSES: HospitalFollowUpStatus[] = [
  "new",
  "pending_review",
  "assigned",
  "callback_scheduled",
  "in_progress",
  "completed",
  "unable_to_reach",
  "cancelled",
];

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  // The platform callbacks these requests point at, so the panel can show
  // when a scheduled callback is actually due.
  // Scoped here: the platform's accessor returns every workspace's callbacks.
  const callbacks = new Map(
    getFollowUps()
      .filter((callback) => (callback.tenantId ?? null) === auth.tenantId)
      .map((callback) => [callback.id, callback])
  );

  const rows = listFollowUps(auth.tenantId)
    .filter((followUp) => {
      if (status === "open") return OPEN_FOLLOW_UP_STATUSES.includes(followUp.status);
      if (status && status !== "all" && followUp.status !== status) return false;
      if (search && !`${followUp.patientName} ${followUp.reason}`.toLowerCase().includes(search)) return false;
      return true;
    })
    .map((followUp) => {
      const callback = followUp.callbackId ? callbacks.get(followUp.callbackId) : undefined;
      return {
        ...followUp,
        callback: callback
          ? { id: callback.id, scheduledTime: callback.scheduledTime, status: callback.status }
          : null,
      };
    });

  return NextResponse.json(
    {
      followUps: rows,
      statuses: STATUSES,
      counts: {
        open: listFollowUps(auth.tenantId).filter((row) => OPEN_FOLLOW_UP_STATUSES.includes(row.status)).length,
        total: listFollowUps(auth.tenantId).length,
      },
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "create");
  const fail = (message: string, status = 400) =>
    NextResponse.json({ error: { message } }, { status, headers: noStore });

  if (action === "create") {
    const phone = String(body?.phone ?? "").trim();
    const leadId = String(body?.patientLeadId ?? "").trim();
    const patient = leadId
      ? getLeads().find((lead) => lead.tenantId === auth.tenantId && lead.id === leadId)
      : phone
        ? patientFor(auth.tenantId, phone, typeof body?.name === "string" ? body.name : undefined)
        : null;
    if (!patient) return fail("A patient is needed: give a phone number or a patient record.");

    const created = createFollowUp({
      tenantId: auth.tenantId,
      patientLeadId: patient.id,
      canonicalPatientId: typeof body?.patientId === "string" ? body.patientId : null,
      appointmentId: typeof body?.appointmentId === "string" ? body.appointmentId : null,
      reason: String(body?.reason ?? ""),
      sourceCallId: typeof body?.callId === "string" ? body.callId : null,
      preferredAt: typeof body?.preferredAt === "string" ? body.preferredAt : null,
      department: typeof body?.department === "string" ? body.department : null,
      actor: auth.user.id,
      demo: Boolean(body?.demo),
    });
    if (!created.ok) return fail(created.problem);

    return NextResponse.json(
      {
        followUp: created.followUp,
        // Said plainly: the agent must not tell a patient their request was
        // noted twice, and staff must not work the same ask twice.
        duplicate: created.duplicate,
        recorded: true,
      },
      { status: created.duplicate ? 200 : 201, headers: noStore }
    );
  }

  if (action === "status") {
    const status = String(body?.status ?? "");
    if (!STATUSES.includes(status as HospitalFollowUpStatus)) return fail("That is not a follow-up status.");
    const result = setFollowUpStatus(auth.tenantId, String(body?.id ?? ""), status as HospitalFollowUpStatus, auth.user.id, {
      outcome: typeof body?.outcome === "string" ? body.outcome : null,
      note: typeof body?.note === "string" ? body.note : null,
    });
    if (!result.ok) return fail(result.problem, 409);
    return NextResponse.json({ followUp: result.followUp }, { headers: noStore });
  }

  if (action === "assign") {
    const result = assignFollowUp(
      auth.tenantId,
      String(body?.id ?? ""),
      {
        assignedTo: typeof body?.assignedTo === "string" ? body.assignedTo : null,
        department: typeof body?.department === "string" ? body.department : null,
      },
      auth.user.id
    );
    if (!result.ok) return fail(result.problem);
    return NextResponse.json({ followUp: result.followUp }, { headers: noStore });
  }

  if (action === "schedule-callback") {
    const result = scheduleCallback(auth.tenantId, String(body?.id ?? ""), String(body?.when ?? ""), auth.user.id);
    if (!result.ok) {
      // 200 with ok:false: the request was understood, the callback was not
      // scheduled, and the panel must not show one.
      return NextResponse.json({ ok: false, problem: result.problem }, { headers: noStore });
    }
    return NextResponse.json({ ok: true, followUp: result.followUp, callbackId: result.callbackId }, { headers: noStore });
  }

  return fail("Unknown action.");
}
