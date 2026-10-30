// ============================================================
// Hospital — Maya's in-call tools & the demo doctor list
// ============================================================
//
// The deterministic action layer Maya calls during a call (doctor lookup, real
// availability, book / reschedule / cancel), and the demo doctor list that
// feeds it. Everything runs against a throwaway database; no real call is
// placed and no provider is reached (the actions are local DB operations).
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("hospital-agent-tools");

const db = await import("@/lib/db");
const { saveWorkspaceProvider } = await import("@/lib/providers/config");
const { enableHospital, hospitalProfile, localDate } = await import("@/lib/hospital/service") as any;
const { refreshProviderDirectory, providers } = await import("@/lib/hospital/directory");
const { runAgentTool, agentToolsDiagnostics } = await import("@/lib/hospital/agent-tools");
const { seedDemoDoctors, listDemoDoctors, demoDoctorId } = await import("@/lib/hospital/demo-doctors");
const svc = await import("@/lib/hospital/service");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);
const dataOf = (r: any) => (r.ok ? r.data : null);

const HOSPITAL = "ws_wellness";
const OTHER = "ws_clinic";
const now = new Date().toISOString();

for (const [id, name] of [[HOSPITAL, "Wellness Hospital"], [OTHER, "Other Clinic"]]) {
  db.saveTenant({ id, name, createdAt: now });
  db.saveAgentConfig(id, { companyName: name, productName: "Appointments", industry: "Healthcare" });
}
enableHospital(HOSPITAL, "Wellness Hospital", "staff_1");
enableHospital(OTHER, "Other Clinic", "staff_1");
saveWorkspaceProvider(HOSPITAL, { outbound: { appId: "Amrita---We-4517816a-a47a", appVersion: 3, connectionId: "c", phoneNumber: "+918064269489", agentVariables: [] } }, "setup");

const TZ = hospitalProfile(HOSPITAL, "Wellness Hospital").timezone;
const dayAhead = (n: number) => localDate(new Date(Date.now() + n * 86400_000), TZ);

// Seed demo doctors into both hospitals.
seedDemoDoctors(HOSPITAL);
// A doctor unique to the OTHER clinic, to prove isolation.
db.saveDoctor({ id: demoDoctorId(OTHER, "z"), tenantId: OTHER, name: "Dr. Other Z", specialty: "Cardiology", department: "Cardiac", qualifications: null, about: null, avatar: null, phone: null, email: null, schedule: { days: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], start: "09:00", end: "17:00", slotMinutes: 30, breaks: [] }, exceptions: [], status: "active", demo: true, createdAt: now, updatedAt: now } as never);
await refreshProviderDirectory(HOSPITAL);
await refreshProviderDirectory(OTHER);

const docA = demoDoctorId(HOSPITAL, "a"); // General Medicine, 09:00–17:00, break 13:00–14:00
const docB = demoDoctorId(HOSPITAL, "b"); // Cardiology

// ------------------------------------------------------------
section("Demo doctors: idempotent seeding");

const reseed = seedDemoDoctors(HOSPITAL);
check("Seeding again creates no duplicates", reseed.created === 0, reseed.created);
check("Five demo doctors exist", listDemoDoctors(HOSPITAL).length === 5, listDemoDoctors(HOSPITAL).length);

// ------------------------------------------------------------
section("A — get_doctors / B — search_doctors");

const all = await runAgentTool(HOSPITAL, "get_doctors", {});
check("get_doctors returns the demo doctors", dataOf(all)?.count >= 5, dataOf(all)?.count);
const bySpec = await runAgentTool(HOSPITAL, "search_doctors", { query: "cardio" });
check("search by specialty finds the cardiologist", dataOf(bySpec)?.doctors?.some((d: any) => d.doctor_id === docB), dataOf(bySpec));
const byName = await runAgentTool(HOSPITAL, "search_doctors", { query: "Rhea" });
check("search by name finds Dr. Rhea Sharma", dataOf(byName)?.doctors?.some((d: any) => d.doctor_id === docA));

// ------------------------------------------------------------
section("C/D — availability");

const avail = await runAgentTool(HOSPITAL, "check_doctor_availability", { doctor_id: docA, date: dayAhead(2) });
check("availability returns genuine free slots", dataOf(avail)?.any_available === true && dataOf(avail)?.available_slots?.includes("09:00"), dataOf(avail));
check("a break is never offered as available", !dataOf(avail)?.available_slots?.includes("13:00"));
const range = await runAgentTool(HOSPITAL, "get_available_slots", { doctor_id: docA, from_date: dayAhead(1), days: 3 });
check("get_available_slots returns a multi-day view", Array.isArray(dataOf(range)?.availability) && dataOf(range).availability.length > 0);

// ------------------------------------------------------------
section("E — book_appointment (real DB), double-booking, invalid slot");

const before = db.getAppointments(HOSPITAL).length;
const booked = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Asha Patient", patient_phone: "+919812345670", doctor_id: docA, appointment_date: dayAhead(2), appointment_time: "09:00" });
check("booking a free slot succeeds", booked.ok === true && Boolean(dataOf(booked)?.appointment_id), booked);
check("…and the appointment is really in the database", db.getAppointments(HOSPITAL).length === before + 1);
check("…returned with a reference id and confirmed status", Boolean(dataOf(booked)?.reference_id) && dataOf(booked)?.status === "confirmed");

const dupe = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Someone Else", patient_phone: "+919812345671", doctor_id: docA, appointment_date: dayAhead(2), appointment_time: "09:00" });
check("the same slot cannot be booked twice", dupe.ok === false && (dupe as any).code === "slot_taken", dupe);
const breakSlot = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Break Test", patient_phone: "+919812345672", doctor_id: docA, appointment_date: dayAhead(2), appointment_time: "13:00" });
check("a break time cannot be booked", breakSlot.ok === false, breakSlot);

// ------------------------------------------------------------
section("F — get_patient_appointments");

const mine = await runAgentTool(HOSPITAL, "get_patient_appointments", { patient_phone: "+919812345670" });
check("the patient's appointment is retrievable by phone", dataOf(mine)?.count === 1 && dataOf(mine)?.appointments[0]?.appointment_id === dataOf(booked)?.appointment_id);
const none = await runAgentTool(HOSPITAL, "get_patient_appointments", { patient_phone: "+910000000000" });
check("an unknown number returns no appointments (not an error)", none.ok === true && dataOf(none)?.count === 0);

// ------------------------------------------------------------
section("G — reschedule_appointment (history preserved)");

const apptId = dataOf(booked)!.appointment_id;
const fromAt = db.getAppointment(HOSPITAL, apptId)!.scheduledAt;
const resc = await runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: apptId, new_date: dayAhead(3), new_time: "10:00" });
check("rescheduling to a free slot succeeds", resc.ok === true && dataOf(resc)?.status === "rescheduled", resc);
check("…and the original time is kept in history", db.getAppointmentEvents(HOSPITAL, apptId).some((e: any) => e.action === "rescheduled" && e.from === fromAt));

// ------------------------------------------------------------
section("H — cancel_appointment (explicit confirmation only)");

const noConfirm = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: apptId });
check("cancellation without confirmation is refused", noConfirm.ok === false && (noConfirm as any).code === "confirmation_required");
check("…and the appointment is untouched", db.getAppointment(HOSPITAL, apptId)!.status !== "cancelled");
const confirmed = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: apptId, confirm: true, reason: "patient asked" });
check("cancellation with confirmation is processed", confirmed.ok === true, confirmed);

// ------------------------------------------------------------
section("I — get_appointment_details with verification");

const book2 = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Vik Patient", patient_phone: "+919812345680", doctor_id: docB, appointment_date: dayAhead(2), appointment_time: "10:00" });
const details = await runAgentTool(HOSPITAL, "get_appointment_details", { appointment_id: dataOf(book2)!.appointment_id, patient_phone: "+919812345680" });
check("details return for the right patient", details.ok === true && dataOf(details)?.doctor_name === "Dr. Arjun Nair");
const wrong = await runAgentTool(HOSPITAL, "get_appointment_details", { appointment_id: dataOf(book2)!.appointment_id, patient_phone: "+910000000000" });
check("a mismatched phone is refused (no disclosure)", wrong.ok === false && (wrong as any).code === "verification_failed");

const unknownTool = await runAgentTool(HOSPITAL, "do_something_weird", {});
check("an unknown tool is a structured failure, not a crash", unknownTool.ok === false && (unknownTool as any).code === "unknown_tool");

// ------------------------------------------------------------
section("Admin edits immediately affect Maya's availability");

// Block dayAhead(5) for Dr. Demo A via the demo-doctor exception, then confirm
// the tool reports no availability that day.
const d = db.getDoctor(HOSPITAL, docA)!;
db.saveDoctor({ ...d, exceptions: [{ id: "ex1", date: dayAhead(5), kind: "leave", note: "blocked" }] } as never);
await refreshProviderDirectory(HOSPITAL);
const blockedDay = await runAgentTool(HOSPITAL, "check_doctor_availability", { doctor_id: docA, date: dayAhead(5) });
check("a blocked date offers no slots to Maya", dataOf(blockedDay)?.any_available === false, dataOf(blockedDay));
check("…with an explicit, speakable 'no availability' envelope", dataOf(blockedDay)?.available === false && Array.isArray(dataOf(blockedDay)?.slots) && dataOf(blockedDay)?.slots.length === 0 && /No available/.test(dataOf(blockedDay)?.message), dataOf(blockedDay));

// ------------------------------------------------------------
section("Endpoint authentication — header and query token");

const { authenticateWebhook } = await import("@/lib/security/webhook-auth");
const token = db.getProviderConfig(HOSPITAL)?.webhookToken ?? "";
check("the workspace has a webhook token", token.length > 0);
const viaHeader = authenticateWebhook(new Request("https://x/api/hospital/agent-tools", { headers: { authorization: `Bearer ${token}` } }));
check("a Bearer header authenticates to the right workspace", viaHeader.ok && (viaHeader as any).tenantId === HOSPITAL, viaHeader);
const viaQuery = authenticateWebhook(new Request(`https://x/api/hospital/agent-tools?k=${token}`));
check("the ?k= query token still works", viaQuery.ok && (viaQuery as any).tenantId === HOSPITAL);
const viaXHeader = authenticateWebhook(new Request("https://x/api/hospital/agent-tools", { headers: { "x-webhook-token": token } }));
check("an X-Webhook-Token header works", viaXHeader.ok && (viaXHeader as any).tenantId === HOSPITAL);
const noToken = authenticateWebhook(new Request("https://x/api/hospital/agent-tools"));
check("no token is rejected", noToken.ok === false);
const badToken = authenticateWebhook(new Request("https://x/api/hospital/agent-tools", { headers: { authorization: "Bearer not-a-real-token" } }));
check("a wrong token is rejected", badToken.ok === false);

// ------------------------------------------------------------
section("Diagnostics snapshot");

const diag = agentToolsDiagnostics(HOSPITAL);
check("diagnostics reports the database reachable", diag.dbConnected === true);
check("…counts the doctors and the five demo doctors", (diag.doctorCount as number) >= 5 && diag.demoDoctorCount === 5, { doctorCount: diag.doctorCount, demoDoctorCount: diag.demoDoctorCount });
check("…and reports a numeric free-slot count and an errors list", typeof diag.availableSlotsToday === "number" && Array.isArray(diag.recentErrors));

// ------------------------------------------------------------
section("Isolation — one hospital never sees another's doctors");

check("Wellness get_doctors excludes the other clinic's doctor", !dataOf(await runAgentTool(HOSPITAL, "get_doctors", {}))?.doctors?.some((x: any) => x.doctor_id === demoDoctorId(OTHER, "z")));
check("…and the other clinic has its own directory", providers(OTHER).some((p) => p.id === demoDoctorId(OTHER, "z")) && !providers(OTHER).some((p) => p.id === docA));

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
