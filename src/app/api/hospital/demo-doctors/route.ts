// ============================================================
// /api/hospital/demo-doctors
// ============================================================
//
// The Demo Doctor List: create, edit, block dates for and remove the
// demonstration doctors. Every write refreshes the hospital's provider
// directory, so a change here immediately changes the availability Maya is
// given. Only demo doctors (fixed demo ids) are ever touched — a real doctor
// cannot be edited or deleted here.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { deleteDoctor, getDoctor, saveDoctor } from "@/lib/db";
import { refreshProviderDirectory } from "@/lib/hospital/directory";
import { DEMO_DOCTORS, demoDoctorId, listDemoDoctors, seedDemoDoctors } from "@/lib/hospital/demo-doctors";
import { audit } from "@/lib/hospital/service";
import type { Doctor, ScheduleException, Weekday } from "@/lib/hospital/types";

const noStore = { "Cache-Control": "no-store" };
const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ doctors: listDemoDoctors(auth.tenantId), seedable: DEMO_DOCTORS.length }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "seed");

  if (action === "seed") {
    const result = seedDemoDoctors(auth.tenantId);
    await refreshProviderDirectory(auth.tenantId);
    audit(auth.tenantId, auth.user.id, "demo_doctor.seeded", "demo", `${result.created} created`);
    return NextResponse.json({ created: result.created, doctors: listDemoDoctors(auth.tenantId) }, { headers: noStore });
  }

  if (action === "create") {
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: { message: "A name is needed." } }, { status: 400, headers: noStore });
    const id = demoDoctorId(auth.tenantId, `custom_${Date.now().toString(36)}`);
    const now = new Date().toISOString();
    const days = normaliseDays(body?.days) ?? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const start = HHMM.test(String(body?.start)) ? String(body.start) : "09:00";
    const end = HHMM.test(String(body?.end)) ? String(body.end) : "17:00";
    const slotMinutes = Number.isFinite(body?.slotMinutes) ? Math.min(Math.max(Number(body.slotMinutes), 10), 60) : 30;
    saveDoctor({
      id, tenantId: auth.tenantId, name,
      specialty: String(body?.specialty ?? "General Medicine"),
      department: body?.department ? String(body.department) : null,
      qualifications: null, about: "Demonstration doctor — not a real member of staff.", avatar: null, phone: null, email: null,
      consultationFee: Number.isFinite(body?.consultationFee) ? Math.max(0, Number(body.consultationFee)) : null,
      schedule: { days, start, end, slotMinutes, breaks: [] },
      exceptions: [], status: "active", demo: true, createdAt: now, updatedAt: now,
    } as Doctor);
    await refreshProviderDirectory(auth.tenantId);
    audit(auth.tenantId, auth.user.id, "demo_doctor.created", id, name);
    return NextResponse.json({ doctors: listDemoDoctors(auth.tenantId) }, { headers: noStore });
  }

  return NextResponse.json({ error: { message: "Unknown action." } }, { status: 400, headers: noStore });
}

export async function PUT(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  const doctor = guardDemoDoctor(auth.tenantId, id);
  if (!doctor) return NextResponse.json({ error: { message: "No such demo doctor." } }, { status: 404, headers: noStore });

  const action = String(body?.action ?? "edit");

  if (action === "block" || action === "unblock") {
    const date = String(body?.date ?? "");
    if (!DATE.test(date)) return NextResponse.json({ error: { message: "A valid date (YYYY-MM-DD) is needed." } }, { status: 400, headers: noStore });
    let exceptions: ScheduleException[] = doctor.exceptions.slice();
    if (action === "block") {
      if (!exceptions.some((e) => e.date === date && e.kind === "leave")) {
        exceptions.push({ id: `ex_${Date.now().toString(36)}`, date, kind: "leave", note: body?.note ? String(body.note) : null });
      }
    } else {
      exceptions = exceptions.filter((e) => !(e.date === date && e.kind === "leave"));
    }
    saveDoctor({ ...doctor, exceptions, updatedAt: new Date().toISOString() });
    await refreshProviderDirectory(auth.tenantId);
    audit(auth.tenantId, auth.user.id, `demo_doctor.${action}`, id, date);
    return NextResponse.json({ doctors: listDemoDoctors(auth.tenantId) }, { headers: noStore });
  }

  if (action === "status") {
    const status = body?.status === "archived" ? "archived" : "active";
    saveDoctor({ ...doctor, status, updatedAt: new Date().toISOString() });
    await refreshProviderDirectory(auth.tenantId);
    audit(auth.tenantId, auth.user.id, "demo_doctor.status", id, status);
    return NextResponse.json({ doctors: listDemoDoctors(auth.tenantId) }, { headers: noStore });
  }

  // Default: edit the schedule and details.
  const schedule = {
    days: normaliseDays(body?.days) ?? doctor.schedule.days,
    start: HHMM.test(String(body?.start)) ? String(body.start) : doctor.schedule.start,
    end: HHMM.test(String(body?.end)) ? String(body.end) : doctor.schedule.end,
    slotMinutes: Number.isFinite(body?.slotMinutes) ? Math.min(Math.max(Number(body.slotMinutes), 10), 60) : doctor.schedule.slotMinutes,
    breaks: doctor.schedule.breaks,
  };
  saveDoctor({
    ...doctor,
    name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : doctor.name,
    specialty: typeof body?.specialty === "string" && body.specialty.trim() ? body.specialty.trim() : doctor.specialty,
    department: typeof body?.department === "string" ? body.department.trim() || null : doctor.department,
    consultationFee: body?.consultationFee !== undefined ? (Number.isFinite(body.consultationFee) ? Math.max(0, Number(body.consultationFee)) : null) : doctor.consultationFee,
    schedule,
    updatedAt: new Date().toISOString(),
  });
  await refreshProviderDirectory(auth.tenantId);
  audit(auth.tenantId, auth.user.id, "demo_doctor.edited", id, null);
  return NextResponse.json({ doctors: listDemoDoctors(auth.tenantId) }, { headers: noStore });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!guardDemoDoctor(auth.tenantId, id)) {
    return NextResponse.json({ error: { message: "No such demo doctor." } }, { status: 404, headers: noStore });
  }
  deleteDoctor(auth.tenantId, id);
  await refreshProviderDirectory(auth.tenantId);
  audit(auth.tenantId, auth.user.id, "demo_doctor.deleted", id, null);
  return NextResponse.json({ doctors: listDemoDoctors(auth.tenantId) }, { headers: noStore });
}

/** Only a demo doctor in this workspace may be touched here. */
function guardDemoDoctor(tenantId: string, id: string): Doctor | null {
  if (!id) return null;
  const doctor = getDoctor(tenantId, id);
  return doctor && doctor.demo ? doctor : null;
}

function normaliseDays(value: unknown): Weekday[] | null {
  if (!Array.isArray(value)) return null;
  const days = value.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday));
  return days.length ? days : null;
}
