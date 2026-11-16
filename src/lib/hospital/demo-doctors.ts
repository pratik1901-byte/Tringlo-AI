// ============================================================
// Tringlo AI — Demo doctor list
// ============================================================
//
// A clearly-separated set of fictional doctors for demonstrations, kept in the
// same `doctors` collection the hospital's directory reads, so a change here
// immediately changes the availability Maya is given. Every record is marked
// `demo: true` and is never mistaken for a real doctor.
//
// Seeding is idempotent: a demo doctor is created only when its fixed id is not
// already present, so running it twice changes nothing and an administrator's
// edits to an existing demo doctor are preserved. Real doctors are never
// touched, and no appointment is ever overwritten.
//
// Availability is a calculation, not stored slots: a doctor's schedule decides
// which times are offered, and `slotsFor` only ever returns future, free times
// — so "slots from now through Sunday" falls out of the schedule without any
// past slot being created.
// ============================================================

import { getDoctor, getDoctors, saveDoctor } from "@/lib/db";
import { localDate, slotsFor } from "./service";
import { hospitalProfile } from "./service";
import type { Doctor, Weekday } from "./types";

const DEMO_PREFIX = "demo_doctor_";
const ALL_DAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface DemoSpec {
  key: string;
  name: string;
  specialty: string;
  department: string;
  start: string;
  end: string;
  slotMinutes: number;
  consultationFee: number;
}

/**
 * The five demonstration doctors, fixed ids so seeding never duplicates them.
 * They carry realistic names but are still demonstration records (`demo: true`,
 * shown with a DEMO tag) and are never mistaken for real staff.
 */
export const DEMO_DOCTORS: DemoSpec[] = [
  { key: "a", name: "Dr. Rhea Sharma", specialty: "General Medicine", department: "Medicine", start: "09:00", end: "17:00", slotMinutes: 20, consultationFee: 500 },
  { key: "b", name: "Dr. Arjun Nair", specialty: "Cardiology", department: "Cardiac Sciences", start: "10:00", end: "16:00", slotMinutes: 30, consultationFee: 1200 },
  { key: "c", name: "Dr. Kavya Reddy", specialty: "Dermatology", department: "Skin & Aesthetics", start: "11:00", end: "17:00", slotMinutes: 20, consultationFee: 800 },
  { key: "d", name: "Dr. Vivaan Malhotra", specialty: "Orthopedics", department: "Orthopedics", start: "09:30", end: "16:30", slotMinutes: 30, consultationFee: 1000 },
  { key: "e", name: "Dr. Sara Thomas", specialty: "Pediatrics", department: "Child Health", start: "09:00", end: "15:00", slotMinutes: 20, consultationFee: 600 },
];

export function demoDoctorId(tenantId: string, key: string): string {
  return `${DEMO_PREFIX}${key}`;
}

export function isDemoDoctorId(id: string): boolean {
  return id.startsWith(DEMO_PREFIX);
}

/**
 * Create any missing demo doctors. Idempotent: existing ones (and any admin
 * edits to them) are left exactly as they are. Returns how many were created.
 */
export function seedDemoDoctors(tenantId: string): { created: number; ids: string[] } {
  const now = new Date().toISOString();
  let created = 0;
  const ids: string[] = [];
  for (const spec of DEMO_DOCTORS) {
    const id = demoDoctorId(tenantId, spec.key);
    ids.push(id);
    const existing = getDoctor(tenantId, id);
    if (existing) {
      // Preserve edits; never duplicate. Only a fee nobody has ever set is filled.
      if (existing.consultationFee === undefined) saveDoctor({ ...existing, consultationFee: spec.consultationFee });
      continue;
    }
    saveDoctor({
      id,
      tenantId,
      name: spec.name,
      specialty: spec.specialty,
      department: spec.department,
      qualifications: null,
      about: "Demonstration doctor — not a real member of staff.",
      avatar: null,
      phone: null,
      email: null,
      consultationFee: spec.consultationFee,
      schedule: { days: ALL_DAYS, start: spec.start, end: spec.end, slotMinutes: spec.slotMinutes, breaks: [{ start: "13:00", end: "14:00" }] },
      exceptions: [],
      status: "active",
      demo: true,
      createdAt: now,
      updatedAt: now,
    } as Doctor);
    created += 1;
  }
  return { created, ids };
}

export interface DemoDoctorView {
  id: string;
  name: string;
  specialty: string;
  department: string | null;
  consultationFee: number | null;
  days: Weekday[];
  hours: { start: string; end: string };
  slotMinutes: number;
  status: Doctor["status"];
  blockedDates: Array<{ date: string; note?: string | null }>;
  /** Slot tallies from now through the end of this week, per the schedule. */
  week: Array<{ date: string; available: number; booked: number; blocked: number }>;
}

/** The days from today through Sunday, in the hospital's timezone. */
function daysThroughSunday(tenantId: string): string[] {
  const tz = hospitalProfile(tenantId).timezone;
  const out: string[] = [];
  const today = new Date();
  // 0 = Sunday … 6 = Saturday, in the hospital timezone.
  const dow = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(today) === "Sun" ? 0 : new Date(today.toLocaleString("en-US", { timeZone: tz })).getDay());
  const toSunday = dow === 0 ? 0 : 7 - dow;
  for (let i = 0; i <= toSunday; i += 1) out.push(localDate(new Date(today.getTime() + i * 86400_000), tz));
  return out;
}

export function listDemoDoctors(tenantId: string): DemoDoctorView[] {
  return getDoctors(tenantId)
    .filter((d) => d.demo)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => {
      const week = daysThroughSunday(tenantId).map((date) => {
        const slots = slotsFor(tenantId, d.id, date);
        return {
          date,
          available: slots.filter((s) => s.available).length,
          booked: slots.filter((s) => s.reason === "booked").length,
          blocked: slots.filter((s) => s.reason === "break").length,
        };
      });
      return {
        id: d.id,
        name: d.name,
        specialty: d.specialty,
        department: d.department ?? null,
        consultationFee: d.consultationFee ?? null,
        days: d.schedule.days,
        hours: { start: d.schedule.start, end: d.schedule.end },
        slotMinutes: d.schedule.slotMinutes,
        status: d.status,
        blockedDates: d.exceptions.filter((e) => e.kind === "leave" || e.kind === "holiday").map((e) => ({ date: e.date, note: e.note })),
        week,
      };
    });
}
