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
const { listCancellationRequests } = await import("@/lib/hospital/cancellations");

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
section("Patient verification — the hospital's records, not a name or number");

// The demonstration hospital server's own patient directory: who it can verify.
const DOB = "1990-05-17";
const registered = new Set<string>();
const register = (phone: string, name: string, dateOfBirth = DOB) => {
  if (registered.has(phone)) return;
  registered.add(phone);
  db.saveHisPatient({ id: `hisp_${phone}`, tenantId: HOSPITAL, patientId: `WH-${phone.slice(-6)}`, name, phone, dateOfBirth, hasHistory: false, demo: true, createdAt: now } as never);
};
const verify = async (phone: string, name = "Test Patient") => {
  register(phone, name);
  const r = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: phone, date_of_birth: DOB });
  if (!r.ok) throw new Error(`verification failed for ${phone}: ${JSON.stringify(r)}`);
  return dataOf(r).verification_id as string;
};

register("+919812345670", "Asha Patient");
const noDob = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: "+919812345670" });
check("a phone number alone is not enough to verify", noDob.ok === false && (noDob as any).code === "missing_identity", noDob);
const wrongDob = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: "+919812345670", date_of_birth: "1991-05-17" });
check("a wrong date of birth is refused", wrongDob.ok === false && (wrongDob as any).code === "not_verified", wrongDob);
const unknownPerson = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: "+910000000000", date_of_birth: DOB });
check("…with the same answer as a number the hospital does not know (no disclosure)", unknownPerson.ok === false && (unknownPerson as any).error === (wrongDob as any).error);
const ashaV = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: "+91 98123 45670", date_of_birth: "17/05/1990" });
check("phone + date of birth matching the record verifies (formats normalised)", ashaV.ok === true && /^pv_[0-9a-f]{32}$/.test(dataOf(ashaV)?.verification_id) && dataOf(ashaV)?.patient_name === "Asha Patient", ashaV);
check("…and the date of birth is never echoed back", !JSON.stringify(ashaV).includes("1990"));
const ashaVid = dataOf(ashaV).verification_id as string;

register("+919812345699", "Locked Patient");
for (let i = 0; i < 3; i += 1) await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: "+919812345699", date_of_birth: `1980-01-0${i + 1}` });
const locked = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: "+919812345699", date_of_birth: DOB });
check("three wrong dates of birth lock the number, even against the right one", locked.ok === false && (locked as any).code === "verification_locked", locked);

// ------------------------------------------------------------
section("F — get_patient_appointments (verified only)");

const unverifiedList = await runAgentTool(HOSPITAL, "get_patient_appointments", { patient_phone: "+919812345670" });
check("a phone number without verification lists nothing", unverifiedList.ok === false && (unverifiedList as any).code === "verification_required", unverifiedList);
const forged = await runAgentTool(HOSPITAL, "get_patient_appointments", { verification_id: "pv_" + "0".repeat(32) });
check("a made-up verification id is refused", forged.ok === false && (forged as any).code === "verification_invalid");
const mine = await runAgentTool(HOSPITAL, "get_patient_appointments", { verification_id: ashaVid });
check("the verified patient's appointment is listed", dataOf(mine)?.count === 1 && dataOf(mine)?.appointments[0]?.appointment_id === dataOf(booked)?.appointment_id && dataOf(mine)?.appointments[0]?.upcoming === true, mine);
const mineIgnoringPhone = await runAgentTool(HOSPITAL, "get_patient_appointments", { verification_id: ashaVid, patient_phone: "+919812345671" });
check("a different phone passed alongside cannot widen the lookup", dataOf(mineIgnoringPhone)?.count === 1 && dataOf(mineIgnoringPhone)?.appointments[0]?.appointment_id === dataOf(booked)?.appointment_id);

// ------------------------------------------------------------
section("G — reschedule_appointment (verified, own appointment, history preserved)");

const apptId = dataOf(booked)!.appointment_id;
const fromAt = db.getAppointment(HOSPITAL, apptId)!.scheduledAt;
const unverifiedMove = await runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: apptId, new_date: dayAhead(3), new_time: "10:00" });
check("rescheduling without verification is refused and changes nothing", unverifiedMove.ok === false && (unverifiedMove as any).code === "verification_required" && db.getAppointment(HOSPITAL, apptId)!.scheduledAt === fromAt);
const otherV = await verify("+919812345688", "Other Patient");
const othersMove = await runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: apptId, new_date: dayAhead(3), new_time: "10:00", verification_id: otherV });
check("a verified patient cannot move someone else's appointment", othersMove.ok === false && (othersMove as any).code === "not_found_for_patient" && db.getAppointment(HOSPITAL, apptId)!.scheduledAt === fromAt, othersMove);
const resc = await runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: apptId, new_date: dayAhead(3), new_time: "10:00", verification_id: ashaVid });
check("the verified owner can reschedule to a free slot", resc.ok === true && dataOf(resc)?.status === "rescheduled", resc);
check("…and the original time is kept in history", db.getAppointmentEvents(HOSPITAL, apptId).some((e: any) => e.action === "rescheduled" && e.from === fromAt));

// ------------------------------------------------------------
section("H — cancel_appointment (verified, own appointment, explicit confirmation)");

const unverifiedCancel = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: apptId, confirm: true });
check("cancellation without verification is refused", unverifiedCancel.ok === false && (unverifiedCancel as any).code === "verification_required");
const othersCancel = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: apptId, confirm: true, verification_id: otherV });
check("a verified patient cannot cancel someone else's appointment", othersCancel.ok === false && (othersCancel as any).code === "not_found_for_patient");
const noConfirm = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: apptId, verification_id: ashaVid });
check("cancellation without confirmation is refused", noConfirm.ok === false && (noConfirm as any).code === "confirmation_required");
check("…and the appointment is untouched", db.getAppointment(HOSPITAL, apptId)!.status !== "cancelled");
const confirmed = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: apptId, confirm: true, reason: "patient asked", verification_id: ashaVid });
check("verified + confirmed cancellation is processed", confirmed.ok === true && dataOf(confirmed)?.cancelled === true, confirmed);
check("…and the request carries the hospital's patient id", listCancellationRequests(HOSPITAL).some((r: any) => r.appointmentId === apptId && r.canonicalPatientId === "WH-345670"));

// ------------------------------------------------------------
section("I — get_appointment_details (verified only)");

const book2 = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Vik Patient", patient_phone: "+919812345680", doctor_id: docB, appointment_date: dayAhead(2), appointment_time: "10:00" });
const vikV = await verify("+919812345680", "Vik Patient");
const details = await runAgentTool(HOSPITAL, "get_appointment_details", { appointment_id: dataOf(book2)!.appointment_id, verification_id: vikV });
check("details return for the verified owner", details.ok === true && dataOf(details)?.doctor_name === "Dr. Arjun Nair" && dataOf(details)?.doctor_id === docB);
const phoneOnly = await runAgentTool(HOSPITAL, "get_appointment_details", { appointment_id: dataOf(book2)!.appointment_id, patient_phone: "+919812345680" });
check("the right phone number alone no longer reveals details", phoneOnly.ok === false && (phoneOnly as any).code === "verification_required");
const wrong = await runAgentTool(HOSPITAL, "get_appointment_details", { appointment_id: dataOf(book2)!.appointment_id, verification_id: ashaVid });
check("another verified patient gets nothing (no disclosure)", wrong.ok === false && (wrong as any).code === "not_found_for_patient");

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
section("One live database — a booked slot is gone for the next caller");

const DAY = dayAhead(4);
const slotsOf = async (doctorId: string, date: string): Promise<string[]> =>
  dataOf(await runAgentTool(HOSPITAL, "check_doctor_availability", { doctor_id: doctorId, date }))?.available_slots ?? [];

check("10:30 is free before anyone books it", (await slotsOf(docB, DAY)).includes("10:30"));
const patientA = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Patient A", patient_phone: "+919812300001", doctor_id: docB, appointment_date: DAY, appointment_time: "10:30" });
check("Patient A books 10:30", patientA.ok === true, patientA);
check("…and the booking result's own remaining slots exclude it", !dataOf(patientA)?.remaining_slots?.includes("10:30") && dataOf(patientA)?.remaining_slots?.length > 0, dataOf(patientA));
check("…and it carries the doctor's consultation fee", dataOf(patientA)?.consultation_fee === 1200, dataOf(patientA));
check("Patient B's availability lookup no longer offers 10:30", !(await slotsOf(docB, DAY)).includes("10:30"));
const patientB = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Patient B", patient_phone: "+919812300002", doctor_id: docB, appointment_date: DAY, appointment_time: "10:30" });
check("Patient B cannot book the occupied slot", patientB.ok === false && (patientB as any).code === "slot_taken", patientB);
const alt = (patientB as any).data?.alternatives;
check("…and is given real alternatives that exclude it", alt?.date === DAY && alt.slots.length > 0 && !alt.slots.includes("10:30"), alt);

const appointmentsBefore = db.getAppointments(HOSPITAL).length;
const race = await Promise.all([
  runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Racer One", patient_phone: "+919812300003", doctor_id: docB, appointment_date: DAY, appointment_time: "11:00" }),
  runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Racer Two", patient_phone: "+919812300004", doctor_id: docB, appointment_date: DAY, appointment_time: "11:00" }),
]);
check("two simultaneous bookings of one slot: exactly one wins", race.filter((r) => r.ok).length === 1, race);
check("…and exactly one appointment was written", db.getAppointments(HOSPITAL).length === appointmentsBefore + 1);

const staffBooked = svc.bookAppointment({ tenantId: HOSPITAL, doctorId: docB, date: DAY, time: "12:00", patientName: "Desk Patient", patientPhone: "+919812300005", actor: "staff_1" });
check("a booking made at the desk succeeds", staffBooked.ok === true, staffBooked);
check("…and Maya no longer offers that slot", !(await slotsOf(docB, DAY)).includes("12:00"));

// ------------------------------------------------------------
section("Cancelling and rescheduling release the slot");

const patientAV = await verify("+919812300001", "Patient A");
const patientBV = await verify("+919812300002", "Patient B");
const cancelA = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: dataOf(patientA)!.appointment_id, confirm: true, verification_id: patientAV });
check("Patient A's cancellation is confirmed by the backend", cancelA.ok === true && dataOf(cancelA)?.cancelled === true, cancelA);
check("…the appointment is cancelled in the database", db.getAppointment(HOSPITAL, dataOf(patientA)!.appointment_id)!.status === "cancelled");
check("…the cancellation result shows 10:30 free again", dataOf(cancelA)?.available_slots?.includes("10:30"), dataOf(cancelA));
check("…and so does the next caller's availability lookup", (await slotsOf(docB, DAY)).includes("10:30"));
const rebook = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Patient B", patient_phone: "+919812300002", doctor_id: docB, appointment_date: DAY, appointment_time: "10:30" });
check("Patient B can now book the released slot", rebook.ok === true, rebook);

const moved = await runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: dataOf(rebook)!.appointment_id, new_date: DAY, new_time: "15:00", verification_id: patientBV });
check("rescheduling 10:30 → 15:00 succeeds", moved.ok === true && dataOf(moved)?.appointment_time === "15:00", moved);
const afterMove = await slotsOf(docB, DAY);
check("…the old slot is free and the new one is taken", afterMove.includes("10:30") && !afterMove.includes("15:00"), afterMove);
check("…and the reschedule result says the same", dataOf(moved)?.remaining_slots?.includes("10:30") && !dataOf(moved)?.remaining_slots?.includes("15:00"));
const clash = await runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: dataOf(rebook)!.appointment_id, new_date: DAY, new_time: "11:00", verification_id: patientBV });
check("rescheduling onto an occupied slot is refused, with alternatives", clash.ok === false && (clash as any).data?.alternatives?.slots?.length > 0 && !(clash as any).data.alternatives.slots.includes("11:00"), clash);
check("…and the appointment stays where it was", dataOf(await runAgentTool(HOSPITAL, "get_appointment_details", { appointment_id: dataOf(rebook)!.appointment_id, verification_id: patientBV }))?.appointment_time === "15:00");

// ------------------------------------------------------------
section("Admin changes reach Maya with no refresh step");

const docE = demoDoctorId(HOSPITAL, "e"); // Pediatrics, 09:00–15:00
const before_e = db.getDoctor(HOSPITAL, docE)!;
db.saveDoctor({ ...before_e, consultationFee: 750, schedule: { ...before_e.schedule, end: "11:00" } } as never);
const shortDay = await slotsOf(docE, DAY);
check("shortened hours are what Maya offers, immediately", shortDay.includes("10:40") && !shortDay.includes("11:00") && !shortDay.includes("14:00"), shortDay);
const peds = await runAgentTool(HOSPITAL, "search_doctors", { query: "pediatric" });
check("a changed fee and the schedule are in the doctor listing", dataOf(peds)?.doctors?.[0]?.consultation_fee === 750 && dataOf(peds)?.doctors?.[0]?.consulting_hours === "09:00-11:00", dataOf(peds));
db.saveDoctor({ ...db.getDoctor(HOSPITAL, docE)!, status: "archived" } as never);
check("a disabled doctor disappears from Maya's list", !dataOf(await runAgentTool(HOSPITAL, "get_doctors", {}))?.doctors?.some((x: any) => x.doctor_id === docE));
const archivedBook = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Late Caller", patient_phone: "+919812300006", doctor_id: docE, appointment_date: DAY, appointment_time: "09:00" });
check("…and cannot be booked", archivedBook.ok === false, archivedBook);
const departments = await runAgentTool(HOSPITAL, "get_departments", {});
check("get_departments lists departments with consulting doctors only", dataOf(departments)?.departments?.some((x: any) => x.department === "Cardiac Sciences") && !dataOf(departments)?.departments?.some((x: any) => x.department === "Child Health"), dataOf(departments));

// ------------------------------------------------------------
section("Arguments as a voice agent sends them");

const { normaliseTime } = await import("@/lib/hospital/agent-tools");
check("times are normalised to HH:MM", normaliseTime("10:30 AM") === "10:30" && normaliseTime("4 pm") === "16:00" && normaliseTime("9.30") === "09:30" && normaliseTime("14:00:00") === "14:00" && normaliseTime("12:15 a.m.") === "00:15");
check("an unreadable time is passed through, not guessed", normaliseTime("half ten") === "half ten" && normaliseTime("25:00") === "25:00" && normaliseTime("10") === "10");
const spoken = await runAgentTool(HOSPITAL, "book_appointment", { patient_name: "Spoken Time", patient_phone: "+919812300007", doctor_id: docB, appointment_date: DAY, appointment_time: "2:30 PM" });
check("a booking with an AM/PM time lands on the right slot", spoken.ok === true && dataOf(spoken)?.appointment_time === "14:30" && svc.localTime(db.getAppointment(HOSPITAL, dataOf(spoken)!.appointment_id)!.scheduledAt, TZ) === "14:30", spoken);
const spokenV = await verify("+919812300007", "Spoken Time");
const stringConfirm = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: dataOf(spoken)!.appointment_id, confirm: "true", verification_id: spokenV });
check("confirm sent as the string \"true\" is accepted", stringConfirm.ok === true && dataOf(stringConfirm)?.cancelled === true, stringConfirm);
const stringNo = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: dataOf(rebook)!.appointment_id, confirm: "false", verification_id: patientBV });
check("confirm sent as \"false\" is still refused", stringNo.ok === false && (stringNo as any).code === "confirmation_required");

const { POST: toolsPost } = await import("@/app/api/hospital/agent-tools/route");
const toolToken = db.getProviderConfig(HOSPITAL)?.webhookToken ?? "";
const post = async (url: string, body?: unknown) =>
  (await toolsPost(new Request(url, { method: "POST", headers: { authorization: `Bearer ${toolToken}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }))).json();
const U = "https://x/api/hospital/agent-tools";
check("endpoint: { tool, args } body", (await post(U, { tool: "search_doctors", args: { query: "cardio" } })).data?.count >= 1);
check("endpoint: ?tool= with flat arguments as the body", (await post(`${U}?tool=search_doctors`, { query: "cardio" })).data?.count >= 1);
check("endpoint: ?tool= with no body at all", (await post(`${U}?tool=get_departments`)).ok === true);
check("endpoint: arguments as a JSON string", (await post(U, { name: "search_doctors", arguments: JSON.stringify({ query: "cardio" }) })).data?.count >= 1);
check("endpoint: a failed tool carries alternatives through", (await post(U, { tool: "book_appointment", args: { patient_name: "X", patient_phone: "+919812300008", doctor_id: docB, appointment_date: DAY, appointment_time: "11:00" } })).data?.alternatives?.slots?.length > 0);
check("endpoint: no tool named is a 400-style failure", (await post(U, {})).ok === false);

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
