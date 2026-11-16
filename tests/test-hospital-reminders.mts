// ============================================================
// Hospital — Maya's outbound appointment reminder workflow
// ============================================================
//
// The confirmation/reschedule workflow end to end, with Sarvam mocked: the
// variables a reminder carries, how a finished call feeds back into the
// appointment, and every rule that protects a patient — identity, no
// auto-cancellation, a reschedule validated against real availability, a
// no-answer retried not confirmed, duplicates ignored, and an uninterpretable
// result handed to a person rather than guessed at.
//
// No real call is placed: globalThis.fetch is mocked, and the database is a
// throwaway one (tests/isolated-db).
// ============================================================

import { isolateDatabase } from "./isolated-db";

// The reminder worker builds its provider from the server environment. These
// are test values; no real call is placed (fetch is mocked below).
process.env.SARVAM_API_KEY = "test-key-not-a-real-credential";
process.env.SARVAM_ORG_ID = "org_test";
process.env.SARVAM_WORKSPACE_ID = "ws_test";

isolateDatabase("hospital-reminders");

// Typed `any`: it is only read in assertions, and a closure-assigned `let`
// otherwise trips the type checker's narrowing.
let lastSent: any = null;
let sentCount = 0;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { attempt_id: "attempt_1" } };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  // Only count the outbound-trigger POSTs; health probes and anything else pass.
  if (/\/api\/outbounds\//.test(url)) {
    sentCount += 1;
    lastSent = { url, body: JSON.parse(String(init?.body ?? "{}")) };
  }
  return new Response(JSON.stringify(nextResponse.body), {
    status: nextResponse.status,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const db = await import("@/lib/db");
const { saveWorkspaceProvider } = await import("@/lib/providers/config");
const {
  bookAppointment,
  enableHospital,
  hospitalProfile,
  localDate,
  localTime,
  rescheduleAppointment: svcReschedule,
  slotsFor,
  updateHospitalProfile,
} = await import("@/lib/hospital/service");
const { refreshProviderDirectory } = await import("@/lib/hospital/directory");
const { runReminderTick } = await import("@/lib/hospital/reminders");
const { interpretReminderCall, applyReminderCallResult } = await import("@/lib/hospital/reminder-outcomes");
const { reminderCallVariables, REMINDER_INPUT_VARIABLES } = await import("@/lib/hospital/reminder-variables");
const { listCancellationRequests } = await import("@/lib/hospital/cancellations");
const { listFollowUps } = await import("@/lib/hospital/followups");
const { defaultSchedule } = await import("@/lib/hospital/types");
const { isHospitalWorkspace } = await import("@/lib/hospital/context");
const { runAgentTool } = await import("@/lib/hospital/agent-tools");

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const HOSPITAL = "ws_wellness";
const NON_HOSPITAL = "ws_sales";
const now = new Date().toISOString();

// --- Two workspaces: one hospital (Maya), one ordinary (to prove isolation) ---
for (const [id, name] of [[HOSPITAL, "Wellness Hospital"], [NON_HOSPITAL, "TenWeb"]]) {
  db.saveTenant({ id, name, createdAt: now });
  db.saveAgentConfig(id, { companyName: name, productName: "Appointments", industry: "Healthcare" });
}
enableHospital(HOSPITAL, "Wellness Hospital", "staff_1");
db.saveWebhookBaseUrl("https://tringlo.example.com");

saveWorkspaceProvider(
  HOSPITAL,
  {
    outbound: {
      appId: "Amrita---We-4517816a-a47a",
      appVersion: 1,
      connectionId: "8800e72c-9c-8f9c2a3f-4876",
      phoneNumber: "+918064269489",
      agentName: "Maya",
      // The appointment variables Maya accepts, so they actually travel.
      agentVariables: REMINDER_INPUT_VARIABLES,
    },
  },
  "setup"
);
// A plain sales workspace, also with an outbound agent, so a call there proves
// the hospital hook never touches a non-hospital workspace.
saveWorkspaceProvider(
  NON_HOSPITAL,
  { outbound: { appId: "Conversatio-x", appVersion: 4, connectionId: "conn-x", phoneNumber: "+918064269194", agentVariables: [] } },
  "setup"
);

const profile = hospitalProfile(HOSPITAL, "Wellness Hospital");
const TZ = profile.timezone;
const dayAhead = (days: number) => localDate(new Date(Date.now() + days * 86400_000), TZ);

// A doctor in the demonstration hospital server's directory.
db.saveDoctor({
  id: "doc_1",
  tenantId: HOSPITAL,
  name: "Dr. Asha Rao",
  specialty: "Cardiology",
  department: "Cardiac",
  qualifications: null,
  about: null,
  avatar: null,
  phone: null,
  email: null,
  schedule: {
    ...defaultSchedule(),
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    start: "09:00",
    end: "12:00",
    slotMinutes: 30,
    breaks: [{ start: "10:00", end: "10:30" }],
  },
  exceptions: [],
  status: "active",
  demo: false,
  createdAt: now,
  updatedAt: now,
} as never);
await refreshProviderDirectory(HOSPITAL);
updateHospitalProfile(HOSPITAL, { address: "1 Health Rd", helpline: "+918000000000" }, "staff_1");

let phoneSeq = 1000;
function book(date: string, time: string, patientName = "Test Patient", status: "requested" | "confirmed" = "requested") {
  const result = bookAppointment({
    tenantId: HOSPITAL,
    doctorId: "doc_1",
    date,
    time,
    patientName,
    patientPhone: `+9198000${phoneSeq++}`,
    actor: "staff_1",
    status,
  });
  if (!result.ok) throw new Error(`booking failed: ${result.problem}`);
  return result.appointment;
}

/** The patient really verifying on the call: a record in the hospital's directory, then `verify_patient`. */
async function verifyOnCall(appt: { patientPhone: string; patientName: string }) {
  db.saveHisPatient({ id: `hisp_${appt.patientPhone}`, tenantId: HOSPITAL, patientId: `WH-${appt.patientPhone.slice(-6)}`, name: appt.patientName, phone: appt.patientPhone, dateOfBirth: "1985-02-20", hasHistory: false, demo: true, createdAt: now } as never);
  const r = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: appt.patientPhone, date_of_birth: "1985-02-20" });
  if (!r.ok) throw new Error(`verification failed: ${JSON.stringify(r)}`);
  return (r as any).data.verification_id as string;
}

/**
 * Link a reminder to a (mock) call and build the call record that webhook would
 * save. When the outputs claim the patient was verified, the patient is really
 * verified through the backend during the call — that, not the claim, is what
 * post-call processing now requires. Pass `{ backend: false }` to make only the
 * claim.
 */
async function connected(appointmentId: string, outputVariables: Record<string, unknown>, status = "connected", options: { backend?: boolean } = {}) {
  const appt = db.getAppointment(HOSPITAL, appointmentId)!;
  const reminder = db.getReminderForAppointment(HOSPITAL, appointmentId)!;
  const callId = `call_${appointmentId}_${Math.random().toString(36).slice(2, 7)}`;
  db.saveReminder({ ...reminder, status: "sent", attempts: Math.max(1, reminder.attempts), callId, attemptId: `att_${callId}`, lastAttemptAt: new Date().toISOString() });
  if (outputVariables.identity_verified === "true" && options.backend !== false) await verifyOnCall(appt);
  return db.saveCallRecord({
    id: callId,
    leadId: appt.patientLeadId,
    tenantId: HOSPITAL,
    lead: { id: appt.patientLeadId, name: appt.patientName, phone: appt.patientPhone } as never,
    status,
    provider: "sarvam",
    origin: "scheduler",
    direction: "outbound",
    attempts: 1,
    requestedAt: now,
    startedAt: null,
    connectedAt: null,
    endedAt: new Date().toISOString(),
    duration: null,
    transcript: null,
    transcriptTurns: null,
    aiSummary: null,
    aiResult: null,
    lastContactedAt: null,
    nextAction: null,
    humanHandoffStatus: "none",
    providerAttemptId: `att_${callId}`,
    inputVariables: null,
    outputVariables,
  } as never);
}

// ------------------------------------------------------------
section("The variables a reminder carries");

const vApptDate = dayAhead(2);
const vAppt = book(vApptDate, "09:00", "Variable Patient");
const vars = reminderCallVariables(db.getAppointment(HOSPITAL, vAppt.id)!);
check("Appointment date and time are sent", vars.appointment_date === vApptDate && vars.appointment_time === "09:00", vars);
check("The doctor and department are sent", vars.doctor_name === "Dr. Asha Rao" && vars.department_name === "Cardiac", vars);
check("The hospital identifies itself", vars.hospital_name === "Wellness Hospital" && vars.hospital_address === "1 Health Rd");
check("The reminder names itself a confirmation", vars.reminder_type === "confirmation" && vars.timezone === TZ);
check("The patient's first name is derived", vars.patient_first_name === "Variable");
check("Consent reflects the patient is callable", vars.communication_consent === "true");
check("No empty variable is sent", Object.values(vars).every((v) => v.trim() !== ""), vars);
check("Every name is one the brief lists", Object.keys(vars).every((k) => REMINDER_INPUT_VARIABLES.includes(k)), Object.keys(vars));

// ------------------------------------------------------------
section("Reading what Maya extracted (interpretation only)");

check("A connected confirmation is read as confirmed",
  interpretReminderCall({ identity_verified: "true", appointment_confirmation_status: "confirmed" }, true).response === "confirmed");
check("A reschedule request is read as such, not as a confirmation",
  interpretReminderCall({ identity_verified: "true", appointment_confirmation_status: "confirmed", reschedule_requested: "true" }, true).response === "reschedule_requested");
check("An unverified caller never yields a confirmation",
  interpretReminderCall({ identity_verified: "false", appointment_confirmation_status: "confirmed" }, true).response === "unclear");
check("An unanswered call is a no-answer whatever the variables say",
  interpretReminderCall({ appointment_confirmation_status: "confirmed" }, false).response === "no_answer");
check("An empty result on a connected call needs review",
  interpretReminderCall({}, true).needsReview === true);
check("A do-not-call is detected", interpretReminderCall({ do_not_call: "true", identity_verified: "true" }, true).doNotCall === true);

// ------------------------------------------------------------
section("TEST 1 — patient confirms tomorrow's appointment");

const t1 = book(dayAhead(1), "09:00", "Confirm Patient");
await applyReminderCallResult(await connected(t1.id, { identity_verified: "true", appointment_confirmation_status: "confirmed", attendance_status: "attending", patient_response: "yes, I'll be there" }));
check("The existing appointment is marked confirmed", db.getAppointment(HOSPITAL, t1.id)?.status === "confirmed");
check("…its id is unchanged (no new appointment)", db.getAppointments(HOSPITAL).filter((a) => a.id === t1.id).length === 1);
check("…and the patient's words are kept", db.getReminderForAppointment(HOSPITAL, t1.id)?.outcome?.note === "yes, I'll be there");

// ------------------------------------------------------------
section("TEST 2 — availability is real, so slots can be offered");

const availDate = dayAhead(20);
const free = slotsFor(HOSPITAL, "doc_1", availDate).filter((s) => s.available);
check("The backend returns genuinely free slots", free.length > 0 && free.every((s) => s.available), free.length);
check("A break is never offered as free", !slotsFor(HOSPITAL, "doc_1", availDate).some((s) => s.time === "10:00" && s.available));

// ------------------------------------------------------------
section("TEST 3 — patient selects an available slot and it is rescheduled");

const t3 = book(dayAhead(3), "09:30", "Reschedule Patient");
const t3From = db.getAppointment(HOSPITAL, t3.id)!.scheduledAt;
const newDate = dayAhead(15);
const newTime = slotsFor(HOSPITAL, "doc_1", newDate).find((s) => s.available)!.time;
const r3 = await applyReminderCallResult(await connected(t3.id, { identity_verified: "true", reschedule_requested: "true", new_appointment_date: newDate, new_appointment_time: newTime }));
const t3After = db.getAppointment(HOSPITAL, t3.id)!;
check("The appointment is rescheduled, not duplicated", t3After.status === "rescheduled" && r3.rescheduled === true, r3);
check("…to the chosen slot", localDate(t3After.scheduledAt, TZ) === newDate && localTime(t3After.scheduledAt, TZ) === newTime);
check("…and its history is preserved", db.getAppointmentEvents(HOSPITAL, t3.id).some((e) => e.action === "rescheduled" && e.from === t3From && e.to === t3After.scheduledAt));

// ------------------------------------------------------------
section("TEST 4 — chosen slot is not available → human follow-up, no change");

const t4 = book(dayAhead(4), "11:00", "Bad Slot Patient");
const t4Before = db.getAppointment(HOSPITAL, t4.id)!.scheduledAt;
const r4 = await applyReminderCallResult(await connected(t4.id, { identity_verified: "true", reschedule_requested: "true", new_appointment_date: dayAhead(15), new_appointment_time: "10:00" }));
check("The appointment is not moved to an unavailable slot", db.getAppointment(HOSPITAL, t4.id)!.scheduledAt === t4Before && db.getAppointment(HOSPITAL, t4.id)!.status !== "rescheduled");
check("…and a follow-up is raised for a person", Boolean(r4.followUpId) && listFollowUps(HOSPITAL).some((f) => f.id === r4.followUpId));

// ------------------------------------------------------------
section("TEST 5 — patient will not attend but does not reschedule → never auto-cancelled");

const t5 = book(dayAhead(5), "11:30", "Decline Patient");
const r5 = await applyReminderCallResult(await connected(t5.id, { identity_verified: "true", attendance_status: "not attending", patient_response: "I can't make it" }));
check("The appointment is NOT cancelled", db.getAppointment(HOSPITAL, t5.id)!.status !== "cancelled", db.getAppointment(HOSPITAL, t5.id)!.status);
check("…the reply is recorded as declined", db.getReminderForAppointment(HOSPITAL, t5.id)?.outcome?.response === "declined");
check("…and a person is asked to follow up", Boolean(r5.followUpId));

// ------------------------------------------------------------
section("TEST 6 — explicit cancellation goes through the verified workflow");

const t6 = book(dayAhead(6), "09:00", "Cancel Patient");
const cancelsBefore = listCancellationRequests(HOSPITAL).length;
await applyReminderCallResult(await connected(t6.id, { identity_verified: "true", call_disposition: "cancellation requested", patient_response: "please cancel it" }));
check("A cancellation REQUEST is raised (not a silent cancel)", listCancellationRequests(HOSPITAL).length === cancelsBefore + 1);
check("…recorded as reschedule/cancel asked for on the call", db.getReminderForAppointment(HOSPITAL, t6.id)?.outcome?.response === "cancel_requested");

// ------------------------------------------------------------
section("TEST 7 — no answer → not confirmed, retried then exhausted");

const t7 = book(dayAhead(7), "09:30", "No Answer Patient");
// First attempt within the hospital's limit (default 2): requeued.
const r7a = await applyReminderCallResult(await connected(t7.id, {}, "no_answer"));
check("A no-answer does not confirm the appointment", db.getAppointment(HOSPITAL, t7.id)!.status !== "confirmed");
check("…and it is requeued for another try", r7a.action === "requeued_for_retry" && db.getReminderForAppointment(HOSPITAL, t7.id)?.status === "scheduled");
// Exhaust the limit.
const rem7 = db.getReminderForAppointment(HOSPITAL, t7.id)!;
db.saveReminder({ ...rem7, status: "sent", attempts: profile.reminderMaxAttempts, callId: `call_${t7.id}_x`, attemptId: `att_x` });
const t7call = db.saveCallRecord({
  id: `call_${t7.id}_x`, leadId: db.getAppointment(HOSPITAL, t7.id)!.patientLeadId, tenantId: HOSPITAL,
  lead: { id: "x", name: "x", phone: "x" } as never, status: "no_answer", provider: "sarvam", origin: "scheduler",
  direction: "outbound", attempts: 2, requestedAt: now, startedAt: null, connectedAt: null, endedAt: now, duration: null,
  transcript: null, transcriptTurns: null, aiSummary: null, aiResult: null, lastContactedAt: null, nextAction: null,
  humanHandoffStatus: "none", providerAttemptId: "att_x", inputVariables: null, outputVariables: {},
} as never);
const r7b = await applyReminderCallResult(t7call);
check("…and after the limit it is marked failed", r7b.action === "failed_no_answer" && db.getReminderForAppointment(HOSPITAL, t7.id)?.status === "failed");

// ------------------------------------------------------------
section("TEST 8 — wrong person answers → no confirmation, no disclosure acted on");

const t8 = book(dayAhead(8), "11:00", "Wrong Number Patient");
const r8 = await applyReminderCallResult(await connected(t8.id, { identity_verified: "false", appointment_confirmation_status: "confirmed", attendance_status: "attending" }));
check("An unverified caller cannot confirm the appointment", db.getAppointment(HOSPITAL, t8.id)!.status !== "confirmed");
check("…the result is recorded as unclear", db.getReminderForAppointment(HOSPITAL, t8.id)?.outcome?.response === "unclear");
check("…and a person is asked to follow up", Boolean(r8.followUpId));

// ------------------------------------------------------------
section("TEST 9 — do-not-call is respected: the worker never dials an opted-out patient");

const t9 = book(dayAhead(9), "09:30", "Opted Out Patient");
const rem9 = db.getReminderForAppointment(HOSPITAL, t9.id)!;
const lead9 = db.getLeads().find((l) => l.id === db.getAppointment(HOSPITAL, t9.id)!.patientLeadId)!;
db.saveLead({ ...lead9, suppressed: true, suppressedReason: "asked not to be called" });
updateHospitalProfile(HOSPITAL, { remindersEnabled: true }, "staff_1");
db.saveReminder({ ...rem9, status: "scheduled", dueAt: new Date(Date.now() - 60_000).toISOString() });
const callsBefore9 = db.getCallRecords().length;
await runReminderTick();
check("An opted-out patient is skipped, not dialled",
  /opted out/.test(db.getReminderForAppointment(HOSPITAL, t9.id)?.skippedReason ?? ""), db.getReminderForAppointment(HOSPITAL, t9.id)?.skippedReason);
check("…and no call was placed", db.getCallRecords().length === callsBefore9);
updateHospitalProfile(HOSPITAL, { remindersEnabled: false }, "staff_1");

// ------------------------------------------------------------
section("TEST 10 — the same reminder is never dialled twice");

const t10 = book(dayAhead(11), "11:00", "Once Only Patient");
updateHospitalProfile(HOSPITAL, { remindersEnabled: true }, "staff_1");
const rem10 = db.getReminderForAppointment(HOSPITAL, t10.id)!;
db.saveReminder({ ...rem10, status: "scheduled", dueAt: new Date(Date.now() - 60_000).toISOString() });
sentCount = 0;
await runReminderTick();
const afterFirst = sentCount;
check("The confirmation call is placed once", afterFirst === 1, afterFirst);
check("…and the reminder is marked sent", db.getReminderForAppointment(HOSPITAL, t10.id)?.status === "sent");
check("…the appointment variables actually travelled", Boolean(lastSent?.body?.app_config?.agent_variables?.appointment_date), lastSent?.body);
await runReminderTick();
check("A second pass does not place it again", sentCount === afterFirst, sentCount);
updateHospitalProfile(HOSPITAL, { remindersEnabled: false }, "staff_1");

// ------------------------------------------------------------
section("TEST 11 — a duplicate call result does not update the appointment twice");

const t11 = book(dayAhead(12), "09:00", "Duplicate Patient");
const rec11 = await connected(t11.id, { identity_verified: "true", appointment_confirmation_status: "confirmed" });
const first = await applyReminderCallResult(rec11);
const second = await applyReminderCallResult(rec11);
check("The first result is applied", first.handled === true && db.getAppointment(HOSPITAL, t11.id)!.status === "confirmed");
check("…the duplicate is ignored", second.handled === false, second.reason);

// ------------------------------------------------------------
section("TEST 12 — an uninterpretable result is flagged, never guessed");

const t12 = book(dayAhead(13), "11:30", "Garbled Patient");
const r12 = await applyReminderCallResult(await connected(t12.id, { some_unexpected_field: "???" }));
check("An uninterpretable result does not confirm the appointment", db.getAppointment(HOSPITAL, t12.id)!.status !== "confirmed");
check("…it is recorded as unclear", db.getReminderForAppointment(HOSPITAL, t12.id)?.outcome?.response === "unclear");
check("…and raised for review", Boolean(r12.followUpId));

// ------------------------------------------------------------
section("Isolation — a non-hospital call is never touched by this");

check("The sales workspace is not a hospital", !isHospitalWorkspace(NON_HOSPITAL));
const salesCall = db.saveCallRecord({
  id: "call_sales_1", leadId: "lead_sales", tenantId: NON_HOSPITAL,
  lead: { id: "lead_sales", name: "Buyer", phone: "+919811111111" } as never, status: "connected",
  provider: "sarvam", origin: "manual", direction: "outbound", attempts: 1, requestedAt: now, startedAt: null,
  connectedAt: null, endedAt: now, duration: null, transcript: null, transcriptTurns: null, aiSummary: null,
  aiResult: null, lastContactedAt: null, nextAction: null, humanHandoffStatus: "none", providerAttemptId: "att_sales",
  inputVariables: null, outputVariables: { appointment_confirmation_status: "confirmed" },
} as never);
const salesResult = await applyReminderCallResult(salesCall);
check("A non-hospital call passes straight through untouched", salesResult.handled === false, salesResult.reason);

// ------------------------------------------------------------
section("Maya's explicit answer outranks words in her summary");

const said = (v: Record<string, unknown>) => interpretReminderCall({ identity_verified: "true", ...v }, true).response;
check("Confirmed, with 'no need to cancel' in the summary, stays confirmed", said({ appointment_confirmation_status: "confirmed", attendance_status: "attending", patient_response: "Yes, I'll come. No need to cancel." }) === "confirmed");
check("Confirmed, with 'reschedule' mentioned and declined, stays confirmed", said({ appointment_confirmation_status: "confirmed", reschedule_requested: "false", call_summary: "Asked whether they could reschedule, decided not to." }) === "confirmed");
check("An explicit 'cancelled' is a cancellation", said({ appointment_confirmation_status: "cancelled" }) === "cancel_requested");
check("reschedule_requested=true still wins over a confirmed status", said({ appointment_confirmation_status: "confirmed", reschedule_requested: "true" }) === "reschedule_requested");
check("With no explicit status, free text is still read", said({ patient_response: "please cancel it" }) === "cancel_requested");
check("An explicit 'not_attending' is a decline, whatever the summary says", said({ appointment_confirmation_status: "not_attending", patient_response: "can't come, not sure whether to cancel" }) === "declined");
check("An explicit 'unclear' is unclear and goes to review, never a cancellation", (() => { const d = interpretReminderCall({ identity_verified: "true", appointment_confirmation_status: "unclear", patient_response: "mentioned cancel" }, true); return d.response === "unclear" && d.needsReview; })());

// ------------------------------------------------------------
section("Maya acts during the call — the appointment changes exactly once");

const IN_CALL_DOB = "1985-02-20";
const inCallVerify = async (appointment: { patientPhone: string; patientName: string }) => {
  db.saveHisPatient({ id: `hisp_${appointment.patientPhone}`, tenantId: HOSPITAL, patientId: `WH-${appointment.patientPhone.slice(-6)}`, name: appointment.patientName, phone: appointment.patientPhone, dateOfBirth: IN_CALL_DOB, hasHistory: false, demo: true, createdAt: now } as never);
  const r = await runAgentTool(HOSPITAL, "verify_patient", { patient_phone: appointment.patientPhone, date_of_birth: IN_CALL_DOB });
  return (r as any).data.verification_id as string;
};
/** Places the reminder call (reminder linked to it), runs `during`, then delivers the result. */
async function callWith(appointmentId: string, during: () => Promise<unknown>, outputVariables: Record<string, unknown>) {
  const appt = db.getAppointment(HOSPITAL, appointmentId)!;
  const reminder = db.getReminderForAppointment(HOSPITAL, appointmentId)!;
  const callId = `call_incall_${appointmentId}`;
  db.saveReminder({ ...reminder, status: "sent", attempts: 1, callId, attemptId: `att_${callId}` });
  await during();
  const record = db.saveCallRecord({
    id: callId, leadId: appt.patientLeadId, tenantId: HOSPITAL,
    lead: { id: appt.patientLeadId, name: appt.patientName, phone: appt.patientPhone } as never,
    status: "connected", provider: "sarvam", origin: "scheduler", direction: "outbound", attempts: 1,
    requestedAt: now, startedAt: null, connectedAt: null, endedAt: new Date().toISOString(), duration: null,
    transcript: null, transcriptTurns: null, aiSummary: null, aiResult: null, lastContactedAt: null, nextAction: null,
    humanHandoffStatus: "none", providerAttemptId: `att_${callId}`, inputVariables: null, outputVariables,
  } as never);
  return { callId, result: await applyReminderCallResult(record) };
}
const events = (id: string, action: string) => db.getAppointmentEvents(HOSPITAL, id).filter((e: any) => e.action === action).length;

const m1 = book(dayAhead(6), "09:00", "Moved In Call", "confirmed");
const m1New = { date: dayAhead(7), time: "11:00" };
const m1Call = await callWith(
  m1.id,
  async () => runAgentTool(HOSPITAL, "reschedule_appointment", { appointment_id: m1.id, new_date: m1New.date, new_time: m1New.time, verification_id: await inCallVerify(m1) }),
  { identity_verified: "true", reschedule_requested: "true", reschedule_status: "completed", new_appointment_date: m1New.date, new_appointment_time: m1New.time }
);
const m1After = db.getAppointment(HOSPITAL, m1.id)!;
check("An in-call reschedule keeps the reminder linked to its call", db.getReminders(HOSPITAL).some((r: any) => r.appointmentId === m1.id && r.callId === m1Call.callId));
check("…the post-call result is still processed", m1Call.result.handled === true && m1Call.result.rescheduled === true, m1Call.result);
check("…the appointment was moved exactly once", events(m1.id, "rescheduled") === 1 && localDate(m1After.scheduledAt, TZ) === m1New.date && localTime(m1After.scheduledAt, TZ) === m1New.time, db.getAppointmentEvents(HOSPITAL, m1.id));
const m1Reminder = db.getReminders(HOSPITAL).find((r: any) => r.appointmentId === m1.id)!;
check("…the outcome says it was done during the call", m1Reminder.outcome?.response === "reschedule_requested" && /during the call/.test(m1Reminder.outcome?.action ?? ""), m1Reminder.outcome);
check("…and no second confirmation call is queued for the time just chosen", !db.getReminders(HOSPITAL).some((r: any) => r.appointmentId === m1.id && r.status === "scheduled"));
check("…and no follow-up was opened for it", !listFollowUps(HOSPITAL).some((f: any) => f.appointmentId === m1.id));

const c1 = book(dayAhead(6), "09:30", "Cancelled In Call", "confirmed");
const c1Call = await callWith(
  c1.id,
  async () => runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: c1.id, confirm: true, verification_id: await inCallVerify(c1) }),
  { identity_verified: "true", appointment_confirmation_status: "cancelled" }
);
check("An in-call cancellation: the appointment is cancelled exactly once", db.getAppointment(HOSPITAL, c1.id)!.status === "cancelled" && events(c1.id, "cancelled") === 1, db.getAppointmentEvents(HOSPITAL, c1.id));
check("…one cancellation request, not two", listCancellationRequests(HOSPITAL).filter((r: any) => r.appointmentId === c1.id).length === 1);
const c1Reminder = db.getReminders(HOSPITAL).find((r: any) => r.appointmentId === c1.id)!;
check("…and the outcome says it was cancelled, not that it 'stands'", c1Call.result.handled === true && c1Reminder.outcome?.action === "Cancelled during the call.", c1Reminder.outcome);

const p1 = book(dayAhead(6), "11:00", "Moved After Call", "confirmed");
const p1Call = await callWith(p1.id, async () => inCallVerify(p1), {
  identity_verified: "true", reschedule_requested: "true", new_appointment_date: dayAhead(8), new_appointment_time: "09:00",
});
check("A reschedule only stated on the call is still applied after it, once", p1Call.result.rescheduled === true && events(p1.id, "rescheduled") === 1, p1Call.result);
const p1Again = await applyReminderCallResult(db.getCallRecords().find((c: any) => c.id === p1Call.callId)!);
check("…and a redelivered result does not move it again", p1Again.handled === false && events(p1.id, "rescheduled") === 1, p1Again);

const s1 = book(dayAhead(6), "11:30", "Moved By Staff", "confirmed");
const s1Reminder = db.getReminderForAppointment(HOSPITAL, s1.id)!;
db.saveReminder({ ...s1Reminder, status: "sent", attempts: 1, callId: "call_staff_case" });
const staffMove = svcReschedule(HOSPITAL, s1.id, { date: dayAhead(9), time: "09:00" }, "staff_1");
check("A staff reschedule still re-times the confirmation call as before", staffMove.ok === true && staffMove.reminder?.status === "scheduled" && staffMove.reminder?.callId === null, staffMove.ok ? staffMove.reminder : staffMove);

// ------------------------------------------------------------
section("Security — the agent's word is not proof of identity");

let fxSeq = 0;
const fx = (label: string) => {
  const n = fxSeq++;
  return book(dayAhead(20 + Math.floor(n / 5)), ["09:00", "09:30", "10:30", "11:00", "11:30"][n % 5], label, "confirmed");
};
const untouched = (id: string, before: any) => {
  const a = db.getAppointment(HOSPITAL, id)!;
  return a.status === before.status && a.scheduledAt === before.scheduledAt && db.getAppointmentEvents(HOSPITAL, id).length === db.getAppointmentEvents(HOSPITAL, id).filter((e: any) => e.action === "created").length;
};

const s2 = fx("Claims Only Cancel");
const s2Result = await applyReminderCallResult(await connected(s2.id, { identity_verified: "true", appointment_confirmation_status: "cancelled" }, "connected", { backend: false }));
check("identity_verified=true with no backend verification cannot cancel", untouched(s2.id, s2) && !listCancellationRequests(HOSPITAL).some((r: any) => r.appointmentId === s2.id), db.getAppointment(HOSPITAL, s2.id));
check("…it goes to staff review instead", s2Result.response === "unclear" && listFollowUps(HOSPITAL).some((f: any) => f.appointmentId === s2.id));
check("…with the reason recorded", /did not verify the patient/.test(db.getReminders(HOSPITAL).find((r: any) => r.appointmentId === s2.id)!.outcome?.note ?? ""));

const s3 = fx("Claims Only Move");
await applyReminderCallResult(await connected(s3.id, { identity_verified: "true", reschedule_requested: "true", new_appointment_date: dayAhead(11), new_appointment_time: "09:00" }, "connected", { backend: false }));
check("identity_verified=true with no backend verification cannot reschedule", untouched(s3.id, s3));

const s4 = fx("Claims Only Confirm");
db.saveAppointment({ ...db.getAppointment(HOSPITAL, s4.id)!, status: "requested" });
await applyReminderCallResult(await connected(s4.id, { identity_verified: "true", appointment_confirmation_status: "confirmed" }, "connected", { backend: false }));
check("identity_verified=true with no backend verification cannot confirm", db.getAppointment(HOSPITAL, s4.id)!.status === "requested");

const s5 = fx("Someone Else Verified");
const bystander = fx("Bystander");
await verifyOnCall(bystander);
await applyReminderCallResult(await connected(s5.id, { identity_verified: "true", appointment_confirmation_status: "cancelled" }, "connected", { backend: false }));
check("a verification for a DIFFERENT patient during the call does not count", db.getAppointment(HOSPITAL, s5.id)!.status === "confirmed");

const s6 = fx("Forged Id");
await verifyOnCall(s6);
await applyReminderCallResult(await connected(s6.id, { identity_verified: "true", appointment_confirmation_status: "cancelled", verification_id: "pv_" + "f".repeat(32) }, "connected", { backend: false }));
check("a forged verification_id in the outputs is refused, even if a real one exists", db.getAppointment(HOSPITAL, s6.id)!.status === "confirmed");

const s7 = fx("Borrowed Id");
const borrowed = await verifyOnCall(fx("Id Owner"));
await applyReminderCallResult(await connected(s7.id, { identity_verified: "true", appointment_confirmation_status: "cancelled", verification_id: borrowed }, "connected", { backend: false }));
check("another patient's real verification_id is refused", db.getAppointment(HOSPITAL, s7.id)!.status === "confirmed");

const s8 = fx("Stale Verification");
const staleId = await verifyOnCall(s8);
const stale = globalThis.__tringloPatientVerifications!.get(staleId)!;
stale.issuedAt -= 6 * 3600_000; // issued hours before this call was placed
await applyReminderCallResult(await connected(s8.id, { identity_verified: "true", appointment_confirmation_status: "cancelled" }, "connected", { backend: false }));
check("a verification from before the call does not count for it", db.getAppointment(HOSPITAL, s8.id)!.status === "confirmed");

const s9 = fx("Real Id Reported");
const s9Rec = await connected(s9.id, { identity_verified: "true", appointment_confirmation_status: "cancelled" }, "connected", { backend: false });
const s9Id = await verifyOnCall(s9);
db.saveCallRecord({ ...s9Rec, outputVariables: { ...s9Rec.outputVariables, verification_id: s9Id } } as never);
await applyReminderCallResult(db.getCallRecords().find((c: any) => c.id === s9Rec.id)!);
check("the patient's own verification during the call, reported by id, is accepted", db.getAppointment(HOSPITAL, s9.id)!.status === "cancelled");

const s9b = fx("Default Placeholder");
await verifyOnCall(s9b);
await applyReminderCallResult(await connected(s9b.id, { identity_verified: "true", appointment_confirmation_status: "cancelled", verification_id: "<verification_id>" }, "connected", { backend: false }));
check("an unsaved verification_id variable (Sarvam's placeholder default) does not block a backend-verified result", db.getAppointment(HOSPITAL, s9b.id)!.status === "cancelled");

const s10 = fx("Maya Says No");
await verifyOnCall(s10);
await applyReminderCallResult(await connected(s10.id, { identity_verified: "false", appointment_confirmation_status: "cancelled" }, "connected", { backend: false }));
check("backend verified but the agent reports identity_verified=false: nothing changes", db.getAppointment(HOSPITAL, s10.id)!.status === "confirmed");

// ------------------------------------------------------------
section("Security — replayed and duplicated results");

const replayCases: Array<[string, Record<string, unknown>, (id: string) => boolean]> = [
  ["confirm", { identity_verified: "true", appointment_confirmation_status: "confirmed" }, (id) => events(id, "confirmed") === 1],
  ["cancel", { identity_verified: "true", appointment_confirmation_status: "cancelled" }, (id) => events(id, "cancelled") === 1 && listCancellationRequests(HOSPITAL).filter((r: any) => r.appointmentId === id).length === 1],
  ["reschedule", { identity_verified: "true", reschedule_requested: "true", new_appointment_date: dayAhead(12), new_appointment_time: "09:30" }, (id) => events(id, "rescheduled") === 1],
];
for (const [label, outputs, once] of replayCases) {
  const r = fx(`Replay ${label}`);
  if (label === "confirm") db.saveAppointment({ ...db.getAppointment(HOSPITAL, r.id)!, status: "requested" });
  const rec = await connected(r.id, outputs);
  const first = await applyReminderCallResult(rec);
  const replays = await Promise.all([applyReminderCallResult(rec), applyReminderCallResult(rec), applyReminderCallResult({ ...rec } as never)]);
  check(`${label}: applied once, every replay refused`, first.handled === true && replays.every((x) => x.handled === false) && once(r.id), { first, replays, events: db.getAppointmentEvents(HOSPITAL, r.id).map((e: any) => e.action) });
}

const dup = fx("Duplicate Tool Call");
const dupV = await verifyOnCall(dup);
const dupArgs = { appointment_id: dup.id, new_date: dayAhead(12), new_time: "11:00", verification_id: dupV };
const [d1, d2] = [await runAgentTool(HOSPITAL, "reschedule_appointment", dupArgs), await runAgentTool(HOSPITAL, "reschedule_appointment", dupArgs)];
check("a retried reschedule tool call succeeds without moving or logging it twice", d1.ok && d2.ok && events(dup.id, "rescheduled") === 1, { d1, d2 });
const dupC = await Promise.all([1, 2, 3].map(() => runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: dup.id, confirm: true, verification_id: dupV })));
check("three simultaneous identical cancel calls cancel once", dupC.every((x) => x.ok) && events(dup.id, "cancelled") === 1 && listCancellationRequests(HOSPITAL).filter((r: any) => r.appointmentId === dup.id).length === 1, db.getAppointmentEvents(HOSPITAL, dup.id).map((e: any) => e.action));

// ------------------------------------------------------------
section("Security — expired and invalid sessions");

const ex = fx("Expired Session");
const exId = await verifyOnCall(ex);
globalThis.__tringloPatientVerifications!.get(exId)!.expiresAt = Date.now() - 1;
const exTry = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: ex.id, confirm: true, verification_id: exId });
check("an expired verification is refused and changes nothing", exTry.ok === false && (exTry as any).code === "verification_expired" && db.getAppointment(HOSPITAL, ex.id)!.status === "confirmed");
const otherTenantId = (await (async () => {
  const OTHER = "ws_other_hospital";
  db.saveTenant({ id: OTHER, name: "Other", createdAt: now });
  enableHospital(OTHER, "Other", "staff_1");
  db.saveHisPatient({ id: "hisp_other", tenantId: OTHER, patientId: "WH-OTHER", name: "Ex", phone: ex.patientPhone, dateOfBirth: "1985-02-20", hasHistory: false, demo: true, createdAt: now } as never);
  return (await runAgentTool(OTHER, "verify_patient", { patient_phone: ex.patientPhone, date_of_birth: "1985-02-20" }) as any).data.verification_id as string;
})());
const crossTry = await runAgentTool(HOSPITAL, "cancel_appointment", { appointment_id: ex.id, confirm: true, verification_id: otherTenantId });
check("another hospital's verification for the same number is refused here", crossTry.ok === false && (crossTry as any).code === "verification_invalid" && db.getAppointment(HOSPITAL, ex.id)!.status === "confirmed");
for (const bad of ["", "pv_", "pv_xyz", "'; DROP TABLE x;--", 123, null, { id: exId }]) {
  const r = await runAgentTool(HOSPITAL, "get_patient_appointments", { verification_id: bad });
  if (r.ok) check(`malformed verification_id ${JSON.stringify(bad)} refused`, false, r);
}
check("malformed verification ids are all refused", true);

// ------------------------------------------------------------
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
