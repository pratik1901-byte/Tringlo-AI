// ============================================================
// Hospital operations — the workflows the panel depends on
// ============================================================
//
// Doctors and availability (read from the hospital's system, not Tringlo's),
// booking and its double-booking guard, confirmation calls and what a patient
// said on one, cancellation that is never reported before the hospital agrees,
// patient identity, the nine-question limit, one history per patient, reports,
// follow-ups, FAQs, and workspace isolation.
//
// No call is placed and no provider is reached. The database is a throwaway
// one — see tests/isolated-db — and the live hospital adapter is pointed at
// nothing, which is how the "integration is not configured" paths are tested.
// ============================================================

import { isolateDatabase } from "./isolated-db";

isolateDatabase("hospital");

const db = await import("@/lib/db");
const { saveWorkspaceProvider } = await import("@/lib/providers/config");
const {
  availabilityFor,
  bookAppointment,
  hospitalProfile,
  localDate,
  localTime,
  recordConfirmationOutcome,
  removeAppointment,
  rescheduleAppointment,
  slotsFor,
  updateHospitalProfile,
} = await import("@/lib/hospital/service");
const { seedHospital } = await import("@/lib/hospital/seed");
const { hospitalContext, hospitalContextVariables, callerVariables, callerAppointments, intakeGuidance } =
  await import("@/lib/hospital/context");
const { runReminderTick } = await import("@/lib/hospital/reminders");
const { providers, providerFor, refreshProviderDirectory } = await import("@/lib/hospital/directory");
const { identifyPatient, shouldCollectHistory } = await import("@/lib/hospital/identity");
const { escalate, nextQuestion, recordAnswer, recordConsent, sessionProgress, startQuestionnaire } =
  await import("@/lib/hospital/questionnaire");
const { adoptCanonicalId, historyForPatient, recordVisitNote, updateHistory, writeHistoryFromSession } =
  await import("@/lib/hospital/history");
const { buildReport, listReports, markReviewed, submitReport } = await import("@/lib/hospital/reports");
const { createFollowUp, listFollowUps, scheduleCallback, setFollowUpStatus } = await import("@/lib/hospital/followups");
const { answerInquiry, listUnanswered, resolveInquiry, saveFaq } = await import("@/lib/hospital/inquiries");
const { requestCancellation, confirm: confirmCancellation, listCancellationRequests } =
  await import("@/lib/hospital/cancellations");
const { integrationStatus, hospitalServer } = await import("@/lib/hospital/his");
const { MAX_QUESTIONNAIRE_QUESTIONS, QUESTIONNAIRE, defaultIntegrationConfig } = await import("@/lib/hospital/records");
const { defaultSchedule } = await import("@/lib/hospital/types");
const fs = await import("node:fs");

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
const OTHER = "ws_other";
const now = new Date().toISOString();

for (const [id, name] of [[HOSPITAL, "Wellness Hospital"], [OTHER, "Another Clinic"]]) {
  db.saveTenant({ id, name, createdAt: now });
  db.saveAgentConfig(id, { companyName: name, productName: "Appointments", industry: "Healthcare" });
}
saveWorkspaceProvider(
  HOSPITAL,
  {
    outbound: {
      appId: "Amrita---We-4517816a-a47a",
      appVersion: 2,
      connectionId: "conn-w",
      phoneNumber: "+918064269111",
      agentName: "Amrita",
      agentVariables: [],
    },
  },
  "setup"
);

const profile = hospitalProfile(HOSPITAL, "Wellness Hospital");
const TZ = profile.timezone;

/** A date a few days out, so "today" never makes a test flaky. */
const dayAhead = (days: number) => localDate(new Date(Date.now() + days * 86400_000), TZ);

/**
 * A doctor in the DEMONSTRATION HOSPITAL SERVER's directory.
 *
 * Written through the doctors collection because that is the stand-in's own
 * store. Nothing in the panel can do this — there is no doctor CRUD — and the
 * rest of the tests read these back through the integration adapter.
 */
const giveHospitalADoctor = (id: string, overrides: Record<string, unknown> = {}) =>
  db.saveDoctor({
    id,
    tenantId: HOSPITAL,
    name: "Dr. Test Doctor",
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
    ...overrides,
  } as never);

// ------------------------------------------------------------
section("Tringlo has no doctor directory of its own");

const doctor = giveHospitalADoctor("doc_1");
await refreshProviderDirectory(HOSPITAL);

check("Doctors are read through the hospital server", providers(HOSPITAL).some((entry) => entry.id === doctor.id));
check("The doctor CRUD route is gone", !fs.existsSync("C:/Dialo AI/src/app/api/hospital/doctors/route.ts"));
check("The Doctors page is gone", !fs.existsSync("C:/Dialo AI/src/app/hospital/doctors/page.tsx"));
check(
  "…and there is no Doctors navigation item",
  !fs.readFileSync("C:/Dialo AI/src/components/hospital/shell.tsx", "utf8").includes('label: "Doctors"')
);
// The panel is one application with the platform now, not a second one on
// its own port talking to it through a proxy.
check("The standalone panel app is gone", !fs.existsSync("C:/Dialo AI/hospital"));
check("…and its proxy with it", !fs.existsSync("C:/Dialo AI/hospital/app/api/tringlo"));
check("…while its pages live in the platform", fs.existsSync("C:/Dialo AI/src/app/hospital/page.tsx"));
check(
  "The hospital's own hours are what the directory reports",
  providerFor(HOSPITAL, doctor.id)?.hours?.start === "09:00",
  providerFor(HOSPITAL, doctor.id)?.hours
);
check("Demo mode says so rather than implying a connection", hospitalServer(HOSPITAL).mode === "demo");
check("…and the integration reports itself a demonstration", integrationStatus(HOSPITAL).mode === "demo");
check(
  "…and does not claim medical history writes",
  integrationStatus(HOSPITAL).capabilities.find((c) => c.capability === "history_write")?.available === false
);

// ------------------------------------------------------------
section("A doctor's hours decide the slots");

const date = dayAhead(3);
const slots = slotsFor(HOSPITAL, doctor.id, date);
check(
  "Slots run from the start to the end of the day",
  slots[0]?.time === "09:00" && slots.at(-1)?.time === "11:30",
  slots.map((s) => s.time)
);
check("A break is not offered", slots.find((slot) => slot.time === "10:00")?.available === false);
check("…and says why", slots.find((slot) => slot.time === "10:00")?.reason === "break");

giveHospitalADoctor("doc_1", { exceptions: [{ id: "ex1", date, kind: "leave", note: "away" }] });
await refreshProviderDirectory(HOSPITAL);
check("A day the hospital says they are away offers nothing", slotsFor(HOSPITAL, doctor.id, date).length === 0);

giveHospitalADoctor("doc_1", {
  exceptions: [{ id: "ex2", date, kind: "special_hours", hours: { start: "15:00", end: "16:00" } }],
});
await refreshProviderDirectory(HOSPITAL);
const special = slotsFor(HOSPITAL, doctor.id, date);
check("Special hours replace the usual ones", special.length === 2 && special[0].time === "15:00", special.map((s) => s.time));

giveHospitalADoctor("doc_1", { exceptions: [] });
giveHospitalADoctor("doc_archived", { name: "Dr. Archived", status: "archived" });
await refreshProviderDirectory(HOSPITAL);
check("A doctor the hospital is not listing offers nothing", slotsFor(HOSPITAL, "doc_archived", date).length === 0);
check(
  "…and is not offered by specialty",
  availabilityFor(HOSPITAL, date, { specialty: "Cardiology" }).every((entry) => entry.doctorId !== "doc_archived")
);

// ------------------------------------------------------------
section("Booking, and not booking twice");

const booked = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date, time: "09:00",
  patientName: "Ananya Rao", patientPhone: "+919845012210", actor: "staff_1",
});
check("An appointment is booked", booked.ok === true, booked.ok ? "" : booked.problem);
const appointment = booked.ok ? booked.appointment : null;
check("…at the time asked for", appointment ? localTime(appointment.scheduledAt, TZ) === "09:00" : false);
check(
  "…for a patient record in this hospital",
  Boolean(appointment && db.getLeads().find((lead) => lead.id === appointment.patientLeadId)?.tenantId === HOSPITAL)
);

const clash = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date, time: "09:00",
  patientName: "Someone Else", patientPhone: "+919800000002", actor: "staff_1",
});
check("The same slot cannot be booked twice", clash.ok === false, clash.ok ? "it was double-booked" : "");
check("…and says the slot has gone", clash.ok === false && /just been taken/.test(clash.problem));

const inBreak = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date, time: "10:00",
  patientName: "Break Test", patientPhone: "+919800000003", actor: "staff_1",
});
check("A break cannot be booked into", inBreak.ok === false, inBreak.ok ? "booked into a break" : "");

const archived = bookAppointment({
  tenantId: HOSPITAL, doctorId: "doc_archived", date, time: "09:30",
  patientName: "Archived Test", patientPhone: "+919800000004", actor: "staff_1",
});
check("A doctor not accepting appointments takes no bookings", archived.ok === false, archived.ok ? "booked anyway" : "");

// ------------------------------------------------------------
section("Confirmation calls, about a day before");

const confirmation = booked.ok ? booked.reminder : null;
check("Booking schedules a confirmation call", Boolean(confirmation));
check(
  "…for the configured hours beforehand",
  (() => {
    if (!confirmation || !appointment) return false;
    const gap = new Date(appointment.scheduledAt).getTime() - new Date(confirmation.dueAt).getTime();
    return Math.round(gap / 3600_000) === profile.reminderLeadHours;
  })(),
  confirmation?.dueAt
);
check("…marked as a confirmation call", confirmation?.kind === "confirmation");
check("…against this appointment time, so a reschedule is a new cycle", confirmation?.cycle === appointment?.scheduledAt);
check("…with nothing recorded as said yet", !confirmation?.outcome);
check(
  "One confirmation call per appointment, however often it is scheduled",
  db.getReminders(HOSPITAL).filter((row) => row.appointmentId === appointment!.id).length === 1
);

// An appointment booked inside the window still gets called, as soon as is
// reasonable, rather than being skipped.
const todaySlots = slotsFor(HOSPITAL, doctor.id, dayAhead(0)).filter((slot) => slot.available);
if (todaySlots.length) {
  const soon = bookAppointment({
    tenantId: HOSPITAL, doctorId: doctor.id, date: dayAhead(0), time: todaySlots[0].time,
    patientName: "Late Booking", patientPhone: "+919800000005", actor: "staff_1",
  });
  check("An appointment booked inside the window is still called", soon.ok && soon.reminder?.status === "scheduled", soon.ok ? soon.reminder : soon.problem);
  check(
    "…as soon as is reasonable, not instantly",
    (() => {
      if (!soon.ok || !soon.reminder) return false;
      const minutes = (new Date(soon.reminder.dueAt).getTime() - Date.now()) / 60_000;
      return minutes > 5 && minutes < 30;
    })(),
    soon.ok ? soon.reminder?.dueAt : ""
  );
} else {
  check("An appointment booked inside the window is still called", true, "no slot left today");
  check("…as soon as is reasonable, not instantly", true, "");
}

const inThePast = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date: dayAhead(-2), time: "09:00",
  patientName: "Past Booking", patientPhone: "+919800000006", actor: "staff_1",
});
check("An appointment in the past takes no booking at all", inThePast.ok === false, inThePast.ok ? "booked in the past" : "");

const moved = rescheduleAppointment(HOSPITAL, appointment!.id, { date, time: "11:00" }, "staff_1");
check("An appointment can be moved", moved.ok === true, moved.ok ? "" : moved.problem);
check(
  "…and its confirmation call is re-timed",
  (() => {
    if (!moved.ok || !moved.reminder) return false;
    const gap = new Date(moved.appointment.scheduledAt).getTime() - new Date(moved.reminder.dueAt).getTime();
    return Math.round(gap / 3600_000) === profile.reminderLeadHours;
  })(),
  moved.ok ? moved.reminder?.dueAt : ""
);
check("…under a new cycle", moved.ok && moved.reminder?.cycle === moved.appointment.scheduledAt);
check(
  "…with only one call still standing",
  db.getReminders(HOSPITAL).filter((r) => r.appointmentId === appointment!.id && r.status !== "cancelled").length === 1
);
check("The old slot is free again", slotsFor(HOSPITAL, doctor.id, date).find((slot) => slot.time === "09:00")?.available === true);

// ------------------------------------------------------------
section("What the patient said on the confirmation call");

const callRow = db.getReminderForAppointment(HOSPITAL, appointment!.id)!;

for (const response of ["no_answer", "unclear"] as const) {
  db.saveReminder({ ...db.getReminderForAppointment(HOSPITAL, appointment!.id)!, outcome: null });
  const before = db.getAppointment(HOSPITAL, appointment!.id)!.status;
  const result = recordConfirmationOutcome(HOSPITAL, callRow.id, { response }, "staff_1");
  check(
    `"${response}" does not confirm the appointment`,
    result.ok && !result.appointmentConfirmed && db.getAppointment(HOSPITAL, appointment!.id)!.status === before,
    result.ok ? db.getAppointment(HOSPITAL, appointment!.id)!.status : result.problem
  );
}

db.saveReminder({ ...db.getReminderForAppointment(HOSPITAL, appointment!.id)!, outcome: null });
const confirmed = recordConfirmationOutcome(
  HOSPITAL, callRow.id, { response: "confirmed", note: "yes I will be there" }, "staff_1"
);
check("Only an explicit confirmation confirms it", confirmed.ok && confirmed.appointmentConfirmed);
check("…and the appointment says so", db.getAppointment(HOSPITAL, appointment!.id)?.status === "confirmed");
check("…with the patient's words kept", db.getReminderForAppointment(HOSPITAL, appointment!.id)?.outcome?.note === "yes I will be there");

db.saveReminder({
  ...db.getReminderForAppointment(HOSPITAL, appointment!.id)!,
  status: "scheduled",
  dueAt: new Date(Date.now() - 60_000).toISOString(),
});
updateHospitalProfile(HOSPITAL, { remindersEnabled: true }, "staff_1");
await runReminderTick();
updateHospitalProfile(HOSPITAL, { remindersEnabled: false }, "staff_1");
const askedAlready = db.getReminderForAppointment(HOSPITAL, appointment!.id)!;
check(
  "A patient already asked is not rung again",
  askedAlready.status === "skipped" && /already answered/.test(askedAlready.skippedReason ?? ""),
  askedAlready.skippedReason
);

// ------------------------------------------------------------
section("What the confirmation worker refuses to dial");

const live = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date: dayAhead(4), time: "09:00",
  patientName: "Reminder Test", patientPhone: "+919800000010", actor: "staff_1",
});
const liveCall = live.ok ? live.reminder! : null;
db.saveReminder({ ...liveCall!, dueAt: new Date(Date.now() - 60_000).toISOString() });

const outcomes = await runReminderTick();
check("With calling off, nothing is dialled", outcomes.every((o) => o.result === "skipped"), outcomes);
check("…and the reason is recorded", /switched off/.test(db.getReminder(HOSPITAL, liveCall!.id)?.skippedReason ?? ""));

updateHospitalProfile(HOSPITAL, { remindersEnabled: true }, "staff_1");
db.saveReminder({
  ...db.getReminder(HOSPITAL, liveCall!.id)!,
  status: "scheduled",
  dueAt: new Date(Date.now() - 60_000).toISOString(),
  skippedReason: null,
});
const patientId = live.ok ? live.appointment.patientLeadId : "";
const patient = db.getLeads().find((lead) => lead.id === patientId)!;
check("The confirmation call's patient is on record", Boolean(patient), patientId);

db.saveLead({ ...patient, suppressed: true, suppressedReason: "asked not to be called" });
await runReminderTick();
check(
  "A patient who opted out is never dialled",
  /opted out/.test(db.getReminder(HOSPITAL, liveCall!.id)?.skippedReason ?? ""),
  db.getReminder(HOSPITAL, liveCall!.id)?.skippedReason
);
db.saveLead({ ...patient, suppressed: false, suppressedReason: null });

const demo = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date: dayAhead(5), time: "09:00",
  patientName: "Demo Patient", patientPhone: "+919800000011", actor: "seed", demo: true,
});
db.saveReminder({
  ...(demo.ok ? demo.reminder! : ({} as never)),
  dueAt: new Date(Date.now() - 60_000).toISOString(),
  status: "scheduled",
});
await runReminderTick();
const demoCall = demo.ok ? db.getReminder(HOSPITAL, demo.reminder!.id) : null;
check("A demonstration appointment is never dialled", demoCall?.status === "skipped", demoCall);
check("…and says it is a demonstration", /demonstration/.test(demoCall?.skippedReason ?? ""));
check("No call record was created by any of this", db.getCallRecords().length === 0, db.getCallRecords().length);
updateHospitalProfile(HOSPITAL, { remindersEnabled: false }, "staff_1");

// ------------------------------------------------------------
section("Cancellation — at any time, and never claimed early");

const toCancel = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date: dayAhead(6), time: "09:00",
  patientName: "Cancel Test", patientPhone: "+919800000020", actor: "staff_1",
});
const cancelTarget = toCancel.ok ? toCancel.appointment : null;

const unverifiedCancel = await requestCancellation({
  tenantId: HOSPITAL, appointmentId: cancelTarget!.id, requestedVia: "inbound_call",
  reason: "cannot make it", actor: "agent", identityVerified: false,
});
check("An unidentified caller cannot cancel anything", "error" in unverifiedCancel, unverifiedCancel);
check("…and the appointment still stands", db.getAppointment(HOSPITAL, cancelTarget!.id)?.status !== "cancelled");

const accepted = await requestCancellation({
  tenantId: HOSPITAL, appointmentId: cancelTarget!.id, requestedVia: "inbound_call",
  reason: "cannot make it", actor: "agent", identityVerified: true,
});
check("A verified caller may cancel at any hour", !("error" in accepted), accepted);
check("…and the demonstration hospital confirms it", !("error" in accepted) && accepted.cancelled === true, accepted);
check("…so the appointment comes off the book", db.getAppointment(HOSPITAL, cancelTarget!.id)?.status === "cancelled");
check(
  "…and its confirmation call is cancelled",
  db.getReminders(HOSPITAL).find((row) => row.appointmentId === cancelTarget!.id)?.status === "cancelled",
  db.getReminders(HOSPITAL).find((row) => row.appointmentId === cancelTarget!.id)?.status
);
check("…leaving no call still owed for it", db.getReminderForAppointment(HOSPITAL, cancelTarget!.id) === undefined);

const again = await requestCancellation({
  tenantId: HOSPITAL, appointmentId: cancelTarget!.id, requestedVia: "inbound_call",
  reason: "asking twice", actor: "agent", identityVerified: true,
});
check("Asking twice does not raise a second request", !("error" in again) && again.cancelled === true, again);
check(
  "…and there is one request on record",
  listCancellationRequests(HOSPITAL).filter((row) => row.appointmentId === cancelTarget!.id).length === 1
);

// With a hospital server selected but not configured, a cancellation must NOT
// be reported as successful.
const unconfigured = bookAppointment({
  tenantId: HOSPITAL, doctorId: doctor.id, date: dayAhead(7), time: "09:00",
  patientName: "Unconfigured Test", patientPhone: "+919800000021", actor: "staff_1",
});
const unconfiguredId = unconfigured.ok ? unconfigured.appointment.id : "";
updateHospitalProfile(HOSPITAL, { integration: { ...defaultIntegrationConfig(), mode: "live" } }, "staff_1");

const refused = await requestCancellation({
  tenantId: HOSPITAL, appointmentId: unconfiguredId, requestedVia: "staff",
  reason: "testing a failure", actor: "staff_1", identityVerified: true,
});
check("A failed hospital cancellation is not shown as successful", !("error" in refused) && refused.cancelled === false, refused);
check("…and the appointment still stands", db.getAppointment(HOSPITAL, unconfiguredId)?.status !== "cancelled");
check("…and it is handed to staff", !("error" in refused) && refused.needsStaff === true);
const refusedRow = listCancellationRequests(HOSPITAL).find((row) => row.appointmentId === unconfiguredId);
check("…with the reason kept", (refusedRow?.failureReason ?? "").length > 0, refusedRow?.failureReason);

const byStaff = await confirmCancellation(HOSPITAL, refusedRow!.id, "staff_1", "confirmed at the desk");
check("Staff can confirm it by hand instead", !("error" in byStaff) && byStaff.cancelled === true, byStaff);
check("…and then it is cancelled", db.getAppointment(HOSPITAL, unconfiguredId)?.status === "cancelled");

// ------------------------------------------------------------
section("Is this caller new, or do we know them?");

// Still on the unconfigured live adapter.
const cannotAsk = await identifyPatient(HOSPITAL, { phone: "+919845012210" });
check("An unreachable hospital server never produces a new patient", cannotAsk.status === "unverified", cannotAsk);
check("…and says why", /not configured|cannot be asked/i.test(cannotAsk.reason), cannotAsk.reason);
check("…and discloses nothing", cannotAsk.disclosureAllowed === false && cannotAsk.name === null);

updateHospitalProfile(HOSPITAL, { integration: defaultIntegrationConfig() }, "staff_1");

db.saveHisPatient({
  id: "hisp_1", tenantId: HOSPITAL, patientId: "WH-012210", name: "Ananya Rao",
  phone: "+919845012210", dateOfBirth: "1986-04-11", hasHistory: false, demo: true, createdAt: now,
});

const phoneOnly = await identifyPatient(HOSPITAL, { phone: "+919845012210" });
check("A phone number alone never identifies anybody", phoneOnly.status === "unverified", phoneOnly);
check("…even when exactly one record has it", phoneOnly.canonicalPatientId === null, phoneOnly);
check("…and it asks for what it needs", phoneOnly.needs.length > 0, phoneOnly.needs);

const wrongDob = await identifyPatient(HOSPITAL, { phone: "+919845012210", dateOfBirth: "1990-01-01" });
check("A phone number with the wrong date of birth is not that patient", wrongDob.canonicalPatientId === null, wrongDob);

const matched = await identifyPatient(HOSPITAL, { phone: "+919845012210", dateOfBirth: "1986-04-11" });
check("A corroborated number identifies them", matched.status === "returning", matched);
check("…with the hospital's own patient id", matched.canonicalPatientId === "WH-012210", matched);
check("…and disclosure is allowed", matched.disclosureAllowed === true);
check("…and no questionnaire is run", shouldCollectHistory(matched).collect === false, shouldCollectHistory(matched));

const brandNew = await identifyPatient(HOSPITAL, { phone: "+919877000001", dateOfBirth: "1999-02-02" });
check("A caller the hospital has no record of is new", brandNew.status === "new", brandNew);
check("…and a questionnaire is offered", shouldCollectHistory(brandNew).collect === true);

const byNumber = await identifyPatient(HOSPITAL, { patientId: "WH-012210" });
check(
  "The hospital patient number identifies them on its own",
  byNumber.status === "returning" && byNumber.canonicalPatientId === "WH-012210",
  byNumber
);

// ------------------------------------------------------------
section("The questionnaire is nine questions");

check("Nine questions are defined", QUESTIONNAIRE.length === 9, QUESTIONNAIRE.length);
check("…and the limit is nine", MAX_QUESTIONNAIRE_QUESTIONS === 9);

const newPatient = db.saveLead({
  id: "lead_new", tenantId: HOSPITAL, name: "Vikram Joshi", phone: "+919877000001",
  status: "queued", suppressed: false, source: "manual", createdAt: now,
  callingDate: "", callingTime: "", timezone: TZ,
} as never);

const refusedReturning = startQuestionnaire({ tenantId: HOSPITAL, patientLeadId: newPatient.id, identity: matched });
check("A returning patient gets no questionnaire", refusedReturning.ok === false, refusedReturning);
check("…for the right reason", refusedReturning.ok === false && refusedReturning.reason === "not_new");

const refusedUnverified = startQuestionnaire({ tenantId: HOSPITAL, patientLeadId: newPatient.id, identity: phoneOnly });
check(
  "An unidentified caller gets no questionnaire",
  refusedUnverified.ok === false && refusedUnverified.reason === "unidentified",
  refusedUnverified
);

const started = startQuestionnaire({ tenantId: HOSPITAL, patientLeadId: newPatient.id, identity: brandNew });
check("A new patient gets one", started.ok === true, started);
const session = started.ok ? started.session : null;

const resumed = startQuestionnaire({ tenantId: HOSPITAL, patientLeadId: newPatient.id, identity: brandNew });
check("A dropped call resumes rather than starting again", resumed.ok && resumed.resumed === true && resumed.session.id === session!.id, resumed);

const beforeConsent = nextQuestion(HOSPITAL, session!.id);
check("No question is asked before consent", beforeConsent.question === null, beforeConsent);
check("…and it says so", /consent/i.test(beforeConsent.done ?? ""), beforeConsent.done);

const blockedAnswer = recordAnswer(HOSPITAL, session!.id, "reason", { state: "answered", value: "a headache" });
check("No answer is stored before consent", blockedAnswer.ok === false, blockedAnswer);

recordConsent(HOSPITAL, session!.id, { granted: true, via: "staff", recordedBy: "staff_1" });
check("Consent is recorded with what the patient was told", (db.getQuestionnaireSession(HOSPITAL, session!.id)?.consent?.statement ?? "").length > 40);

// Nine, then nothing — the limit under the most direct attack there is.
const asked: string[] = [];
for (let attempt = 0; attempt < 15; attempt += 1) {
  const next = nextQuestion(HOSPITAL, session!.id);
  if (!next.question) break;
  asked.push(next.question.id);
  recordAnswer(HOSPITAL, session!.id, next.question.id, { state: "answered", value: `answer ${attempt + 1}` });
}
check("Asking fifteen times yields nine questions", asked.length === 9, asked.length);
check("…each one different", new Set(asked).size === 9, asked);
check("…in the order defined", asked.join(",") === QUESTIONNAIRE.map((q) => q.id).join(","), asked);

const tenth = nextQuestion(HOSPITAL, session!.id);
check("There is no tenth question", tenth.question === null, tenth);
check("…and it says the questionnaire is done", Boolean(tenth.done), tenth.done);
check("The session is complete", db.getQuestionnaireSession(HOSPITAL, session!.id)?.status === "complete");
check("…and never asked more than nine", db.getQuestionnaireSession(HOSPITAL, session!.id)!.asked.length <= 9);

const repeat = recordAnswer(HOSPITAL, session!.id, "allergies", { state: "answered", value: "again" });
check("A question already answered is not answered twice", repeat.ok === false, repeat);

const madeUp = recordAnswer(HOSPITAL, session!.id, "favourite_colour", { state: "answered", value: "blue" });
check("A question that is not one of the nine is refused", madeUp.ok === false, madeUp);

// Skipping, consent refusal and escalation, on further patients.
const skipper = db.saveLead({
  id: "lead_skip", tenantId: HOSPITAL, name: "Sneha Kulkarni", phone: "+919877000002",
  status: "queued", suppressed: false, source: "manual", createdAt: now,
  callingDate: "", callingTime: "", timezone: TZ,
} as never);
const skipNew = await identifyPatient(HOSPITAL, { phone: "+919877000002", dateOfBirth: "1997-06-08" });
const skipSession = startQuestionnaire({ tenantId: HOSPITAL, patientLeadId: skipper.id, identity: skipNew });
const skipId = skipSession.ok ? skipSession.session.id : "";
recordConsent(HOSPITAL, skipId, { granted: true, via: "voice", recordedBy: "call_1" });

const firstQuestion = nextQuestion(HOSPITAL, skipId);
const skipped = recordAnswer(HOSPITAL, skipId, firstQuestion.question!.id, { state: "skipped" });
check("A patient may skip a question", skipped.ok === true, skipped);
check("…and it is recorded as skipped", skipped.ok && skipped.session.answers[0].state === "skipped");
check("…with no answer invented", skipped.ok && skipped.session.answers[0].value === null);

const emptyAnswer = recordAnswer(HOSPITAL, skipId, "symptoms", { state: "answered", value: "   " });
check("An empty answer is not stored as an answer", emptyAnswer.ok === false, emptyAnswer);

const escalated = escalate(HOSPITAL, skipId, "caller described chest pain", "call_1");
check("A conversation can be escalated out of the questionnaire", escalated.ok === true, escalated);
check(
  "…and no protocol is invented when none is configured",
  escalated.ok && /No escalation protocol has been configured/.test(escalated.protocol),
  escalated.ok ? escalated.protocol : ""
);
check("…and no further question is asked", nextQuestion(HOSPITAL, skipId).question === null);

updateHospitalProfile(HOSPITAL, { escalationProtocol: "Transfer to the duty doctor on extension 200." }, "staff_1");
db.saveQuestionnaireSession({ ...db.getQuestionnaireSession(HOSPITAL, skipId)!, status: "in_progress", escalation: null });
const escalatedAgain = escalate(HOSPITAL, skipId, "same", "call_1");
check(
  "The hospital's own protocol is used when it has one",
  escalatedAgain.ok && /extension 200/.test(escalatedAgain.protocol),
  escalatedAgain.ok ? escalatedAgain.protocol : ""
);

const decliner = db.saveLead({
  id: "lead_decline", tenantId: HOSPITAL, name: "Private Caller", phone: "+919877000003",
  status: "queued", suppressed: false, source: "manual", createdAt: now,
  callingDate: "", callingTime: "", timezone: TZ,
} as never);
const declineNew = await identifyPatient(HOSPITAL, { phone: "+919877000003", dateOfBirth: "1970-01-01" });
const declineSession = startQuestionnaire({ tenantId: HOSPITAL, patientLeadId: decliner.id, identity: declineNew });
const declineId = declineSession.ok ? declineSession.session.id : "";
recordConsent(HOSPITAL, declineId, { granted: false, via: "voice", recordedBy: "call_2" });
check("A patient who declines is asked nothing", nextQuestion(HOSPITAL, declineId).question === null);
check("…and no history is written for them", (await writeHistoryFromSession(HOSPITAL, declineId, "staff_1")).ok === false);

const progress = sessionProgress(db.getQuestionnaireSession(HOSPITAL, session!.id)!);
check("Progress never reports more than the limit", progress.asked <= progress.limit && progress.remaining >= 0, progress);

// ------------------------------------------------------------
section("One medical history per patient");

const written = await writeHistoryFromSession(HOSPITAL, session!.id, "staff_1");
check("A finished questionnaire writes a history", written.ok === true, written.ok ? "" : written.problem);
const history = written.ok ? written.history : null;
check("…created, not revised", written.ok && written.created === true);
check("…marked patient-reported", history?.provenance === "patient_reported");
check("…keyed provisionally, since the hospital has no id for them", history?.provisional === true, history?.canonicalPatientId);
check("…and held in Tringlo, which it says", history?.storage === "tringlo_local" && history?.sync.state === "unsupported", history?.sync);

const secondWrite = await writeHistoryFromSession(HOSPITAL, session!.id, "staff_1");
check("Writing again does not create a second history", secondWrite.ok && secondWrite.created === false, secondWrite);
check(
  "…and there is exactly one for this patient",
  db.getMedicalHistories(HOSPITAL).filter((row) => row.patientLeadId === newPatient.id).length === 1
);

// The write barrier itself, attacked directly.
let barrier = "no error";
try {
  db.saveMedicalHistory({ ...history!, id: "mh_duplicate" });
} catch (failure) {
  barrier = failure instanceof Error ? failure.message : String(failure);
}
check("The database refuses a second history under the same key", /already exists/.test(barrier), barrier);
check(
  "…and only one survives",
  db.getMedicalHistories(HOSPITAL).filter((row) => row.canonicalPatientId === history!.canonicalPatientId).length === 1
);

const updated = await updateHistory(
  HOSPITAL, history!.id, { allergies: { state: "answered", value: "penicillin" } }, "staff_1", "patient rang to add this"
);
check("An update changes the one record", updated.ok && updated.created === false, updated);
check("…keeping what it said before", updated.ok && updated.revision?.previous.allergies === "answer 6", updated.ok ? updated.revision : "");
check("…and the new answer is there", updated.ok && updated.history.answers.allergies.value === "penicillin");
check("…with still one history", db.getMedicalHistories(HOSPITAL).filter((row) => row.patientLeadId === newPatient.id).length === 1);

const noChange = await updateHistory(HOSPITAL, history!.id, { allergies: { state: "answered", value: "penicillin" } }, "staff_1");
check("An update that changes nothing records no revision", noChange.ok && noChange.revision === null, noChange);

const adopted = await adoptCanonicalId(HOSPITAL, history!.id, "WH-900001", "staff_1");
check("A hospital patient id can be adopted later", adopted.ok === true, adopted);
check("…and the record is no longer provisional", adopted.ok && adopted.history.provisional === false);
check("…and is found under the hospital's id", Boolean(db.getMedicalHistoryByPatient(HOSPITAL, "WH-900001")));
check(
  "…and still only one exists",
  db.getMedicalHistories(HOSPITAL).filter((row) => !row.canonicalPatientId.startsWith("merged:")).length === 1,
  db.getMedicalHistories(HOSPITAL).length
);

const note = recordVisitNote({
  tenantId: HOSPITAL, patientLeadId: newPatient.id, note: "Says the pain is worse this week.", recordedBy: "staff_1",
});
check("A new complaint goes in a visit note", Boolean(note));
check(
  "…and does not create a second history",
  db.getMedicalHistories(HOSPITAL).filter((row) => !row.canonicalPatientId.startsWith("merged:")).length === 1
);
check(
  "…and is kept apart from the history",
  db.getVisitNotes(HOSPITAL).length === 1 && !JSON.stringify(db.getMedicalHistories(HOSPITAL)).includes("worse this week")
);
check("A returning patient's history is found by their hospital id", Boolean(historyForPatient(HOSPITAL, { canonicalPatientId: "WH-900001" })));

// ------------------------------------------------------------
section("The report");

const report = buildReport(HOSPITAL, session!.id, history!.id, "staff_1");
check("A report is built from the session", report.ok === true, report);
const built = report.ok ? report.report : null;
check("…with all nine questions on it", built?.answers.length === 9, built?.answers.length);
check(
  "…and nothing invented for the unanswered",
  Boolean(built?.answers.every((answer) => answer.state === "answered" || answer.value === null))
);
check("…consent recorded", built?.consent?.granted === true);
check("…ready for review, not submitted", built?.status === "ready", built?.status);

const rebuilt = buildReport(HOSPITAL, session!.id, history!.id, "staff_1");
check("Building twice does not stack up reports", rebuilt.ok && rebuilt.report.id === built!.id, rebuilt);
check("…and there is one report for this session", listReports(HOSPITAL).filter((row) => row.sessionId === session!.id).length === 1);

const toPanel = await submitReport(HOSPITAL, built!.id, "staff_1");
check("A panel-review report is not called submitted", toPanel.ok && toPanel.report.status === "ready", toPanel);

updateHospitalProfile(
  HOSPITAL,
  { integration: { ...defaultIntegrationConfig(), mode: "live", reportDestination: "hospital_server" } },
  "staff_1"
);
const forServer = buildReport(HOSPITAL, session!.id, history!.id, "staff_1");
const reportId = forServer.ok ? forServer.report.id : "";
const failedSubmit = await submitReport(HOSPITAL, reportId, "staff_1");
check("A report is not marked submitted when it did not go", failedSubmit.ok === false, failedSubmit);
check("…its status says the submission failed", failedSubmit.ok === false && failedSubmit.report.status === "failed");
check("…with a reason a person can act on", failedSubmit.ok === false && (failedSubmit.report.failureReason ?? "").length > 20);
check("…and submittedAt is still empty", failedSubmit.ok === false && failedSubmit.report.submittedAt === null);

updateHospitalProfile(
  HOSPITAL, { integration: { ...defaultIntegrationConfig(), reportDestination: "hospital_server" } }, "staff_1"
);
const demoSubmit = await submitReport(HOSPITAL, reportId, "staff_1");
check("A destination that accepts it marks it submitted", demoSubmit.ok && demoSubmit.report.status === "submitted", demoSubmit);
check("…with a reference from the destination", demoSubmit.ok && Boolean(demoSubmit.reference));
check("…and the time it was accepted", demoSubmit.ok && Boolean(demoSubmit.report.submittedAt));

const reviewed = markReviewed(HOSPITAL, reportId, "staff_1");
check("A person can mark it reviewed", reviewed?.status === "reviewed" && reviewed.reviewedBy === "staff_1", reviewed?.status);
updateHospitalProfile(HOSPITAL, { integration: defaultIntegrationConfig() }, "staff_1");

// ------------------------------------------------------------
section("Follow-up requests");

const followUp = createFollowUp({
  tenantId: HOSPITAL, patientLeadId: newPatient.id, reason: "Wants to discuss the test results",
  actor: "agent", sourceCallId: "call_9",
});
const followUpId = followUp.ok ? followUp.followUp.id : "";
check("A request is recorded", followUp.ok === true, followUp);
check("…as new", followUp.ok && followUp.followUp.status === "new");
check("…with no callback claimed", followUp.ok && followUp.followUp.callbackId === null);
check("…at normal priority, with no rule invented", followUp.ok && followUp.followUp.priority === "normal" && followUp.followUp.priorityRule === null);
check("…in the patient's own words", followUp.ok && followUp.followUp.reason === "Wants to discuss the test results");

const duplicate = createFollowUp({
  tenantId: HOSPITAL, patientLeadId: newPatient.id, reason: "wants to discuss the TEST results!",
  actor: "agent", sourceCallId: "call_10",
});
check("The same ask does not become a second request", duplicate.ok && duplicate.duplicate === true, duplicate);
check("…and one request stands", listFollowUps(HOSPITAL).length === 1, listFollowUps(HOSPITAL).length);

const cannotClaim = setFollowUpStatus(HOSPITAL, followUpId, "callback_scheduled", "staff_1");
check("A callback cannot be claimed by hand", cannotClaim.ok === false, cannotClaim);
check("…and the status is unchanged", db.getHospitalFollowUp(HOSPITAL, followUpId)?.status === "new");

const past = scheduleCallback(HOSPITAL, followUpId, new Date(Date.now() - 3600_000).toISOString(), "staff_1");
check("A callback in the past is not scheduled", past.ok === false, past);
check("…and the request is still unscheduled", db.getHospitalFollowUp(HOSPITAL, followUpId)?.status === "new");

const scheduled = scheduleCallback(HOSPITAL, followUpId, new Date(Date.now() + 7200_000).toISOString(), "staff_1");
check("A callback can be scheduled", scheduled.ok === true, scheduled);
check("…and only then does the status say so", db.getHospitalFollowUp(HOSPITAL, followUpId)?.status === "callback_scheduled");
check(
  "…with a real callback in the platform scheduler",
  db.getFollowUps().some((row) => row.id === (scheduled.ok ? scheduled.callbackId : ""))
);

const twice = scheduleCallback(HOSPITAL, followUpId, new Date(Date.now() + 9000_000).toISOString(), "staff_1");
check("A second callback is refused", twice.ok === false, twice);

const demoFollowUp = createFollowUp({
  tenantId: HOSPITAL, patientLeadId: newPatient.id, reason: "A demonstration request", actor: "seed", demo: true,
});
const demoSchedule = scheduleCallback(
  HOSPITAL, demoFollowUp.ok ? demoFollowUp.followUp.id : "", new Date(Date.now() + 7200_000).toISOString(), "staff_1"
);
check("A demonstration request never schedules a real callback", demoSchedule.ok === false, demoSchedule);
check("…and says nothing was dialled", demoSchedule.ok === false && /othing was dialled/.test(demoSchedule.problem), demoSchedule.ok ? "" : demoSchedule.problem);

db.saveLead({ ...db.getLeads().find((lead) => lead.id === newPatient.id)!, suppressed: true });
const optedOut = createFollowUp({ tenantId: HOSPITAL, patientLeadId: newPatient.id, reason: "Another thing entirely", actor: "agent" });
const optedOutSchedule = scheduleCallback(
  HOSPITAL, optedOut.ok ? optedOut.followUp.id : "", new Date(Date.now() + 7200_000).toISOString(), "staff_1"
);
check("A patient who opted out gets no callback", optedOutSchedule.ok === false, optedOutSchedule);
db.saveLead({ ...db.getLeads().find((lead) => lead.id === newPatient.id)!, suppressed: false });

const completed = setFollowUpStatus(HOSPITAL, followUpId, "completed", "staff_1", { outcome: "Rang them; results explained." });
check("Staff can record an outcome", completed.ok && completed.followUp.outcome === "Rang them; results explained.", completed);
check("…and the change is on the record", (db.getHospitalFollowUp(HOSPITAL, followUpId)?.events.length ?? 0) >= 3);

// ------------------------------------------------------------
section("Inquiries and approved answers");

saveFaq(
  HOSPITAL,
  { question: "What are your visiting hours?", answer: "Visiting is between four and six in the evening.", topic: "Operating hours" },
  "staff_1"
);

const answered = answerInquiry({ tenantId: HOSPITAL, question: "Can you tell me the visiting hours please?" });
check("An approved answer is used when one matches", answered.answered === true, answered);
check("…word for word", answered.answer === "Visiting is between four and six in the evening.");
check("…and its use is counted", (db.getHospitalFaqs(HOSPITAL).find((faq) => faq.id === answered.faqId)?.usedCount ?? 0) === 1);

const faqBefore = db.getHospitalFaqs(HOSPITAL).find((faq) => faq.id === answered.faqId)!;
answerInquiry({ tenantId: HOSPITAL, question: "visiting hours for a patient?" });
check(
  "Using a FAQ does not change when its answer was last edited",
  db.getHospitalFaqs(HOSPITAL).find((faq) => faq.id === answered.faqId)?.updatedAt === faqBefore.updatedAt
);

const noAnswer = answerInquiry({ tenantId: HOSPITAL, question: "Do you take Bupa insurance and how much is a scan?" });
check("A question with no approved answer gets none", noAnswer.answered === false && noAnswer.answer === null, noAnswer);
check("…and is told not to answer from general knowledge", /general knowledge|be confirmed/i.test(noAnswer.fallback ?? ""), noAnswer.fallback);
check("…and leaves a row for staff", Boolean(noAnswer.inquiryId) && listUnanswered(HOSPITAL, { status: "open" }).length === 1);

const resolved = resolveInquiry(
  HOSPITAL, noAnswer.inquiryId!,
  { answer: "Please ask the insurance desk; they hold the current list.", topic: "Administrative" }, "staff_1"
);
check("Answering it writes the FAQ", resolved.ok === true && Boolean(resolved.faq), resolved);
check("…and closes the row", listUnanswered(HOSPITAL, { status: "open" }).length === 0);
const askedAgain = answerInquiry({ tenantId: HOSPITAL, question: "Do you take Bupa insurance, and how much does a scan cost?" });
check("…and the agent can use it next time", askedAgain.answered === true, askedAgain);
check("…giving the approved answer, not inventing one", askedAgain.answer === "Please ask the insurance desk; they hold the current list.");

// ------------------------------------------------------------
section("What the agent is told");

const context = hospitalContext(HOSPITAL);
check("The hospital names itself", context.hospitalName === "Wellness Hospital", context.hospitalName);
check("Consulting doctors come from the hospital's directory", context.doctors.some((entry) => entry.name === "Dr. Test Doctor"), context.doctors);
check("A doctor it is not listing is not there", context.doctors.every((entry) => entry.name !== "Dr. Archived"));
check("Unconfigured facts are not invented", context.helpline === null && context.address === null, { helpline: context.helpline, address: context.address });

giveHospitalADoctor("doc_1", { name: "Dr. Renamed", schedule: { ...doctor.schedule, start: "14:00" } });
await refreshProviderDirectory(HOSPITAL);
const after = hospitalContext(HOSPITAL);
check("A rename in the hospital's system reaches the next call", after.doctors.some((entry) => entry.name === "Dr. Renamed"), after.doctors);
check("…and so do new hours", (after.doctors.find((entry) => entry.name === "Dr. Renamed")?.hours ?? "").startsWith("14:00"), after.doctors);

const rules = intakeGuidance(HOSPITAL);
check("The agent is told the question limit", rules.includes("9"), rules.slice(0, 80));
check("…not to diagnose", /diagnosis/i.test(rules));
check("…not to confirm a cancellation early", /until the hospital/i.test(rules));
check("…and the hospital's own escalation procedure", /extension 200/.test(rules));

check("Nothing is sent to an agent that declares nothing", Object.keys(hospitalContextVariables(HOSPITAL, new Set())).length === 0);
const declared = hospitalContextVariables(HOSPITAL, new Set(["hospital_name", "hospital_doctors", "not_offered"]));
check("Only the declared names are filled", Object.keys(declared).sort().join(",") === "hospital_doctors,hospital_name", Object.keys(declared));

const unverifiedVars = callerVariables(
  HOSPITAL,
  new Set(["patient_status", "patient_verification_needed", "patient_reference"]),
  { status: "unverified", canonicalPatientId: null, hasHistory: false, needs: ["a date of birth"] },
  null
);
check("An unidentified caller is said to be unverified", unverifiedVars.patient_status === "unverified", unverifiedVars);
check("…and nothing about any patient is sent", !("patient_reference" in unverifiedVars), unverifiedVars);

const returningVars = callerVariables(
  HOSPITAL,
  new Set(["patient_status", "patient_history_on_file", "patient_next_step"]),
  { status: "returning", canonicalPatientId: "WH-900001", hasHistory: true, needs: [] },
  newPatient.id
);
check("A returning patient is not re-questioned", /o not run the questionnaire/.test(returningVars.patient_next_step ?? ""), returningVars);
check("…and no clinical detail is sent", !JSON.stringify(returningVars).includes("penicillin"), returningVars);

const caller = db.getLeads().find((lead) => lead.tenantId === HOSPITAL && lead.phone.includes("9800000010"));
check("A caller sees their own appointments", callerAppointments(HOSPITAL, caller?.id ?? null).length > 0);
check("…and an unknown caller sees none", callerAppointments(HOSPITAL, null).length === 0);

// ------------------------------------------------------------
section("Workspace isolation");

db.saveDoctor({ ...doctor, id: "doc_other", tenantId: OTHER, name: "Dr. Elsewhere" });
await refreshProviderDirectory(OTHER);
check("Another workspace's doctor is not in this directory", providers(HOSPITAL).every((entry) => entry.name !== "Dr. Elsewhere"));
check("…nor in this hospital's agent context", hospitalContext(HOSPITAL).doctors.every((entry) => entry.name !== "Dr. Elsewhere"));
check("An appointment cannot be read across workspaces", db.getAppointment(OTHER, appointment!.id) === undefined);
check("…nor removed across them", removeAppointment(OTHER, appointment!.id, "attacker") === false);
check("…and it is still here", Boolean(db.getAppointment(HOSPITAL, appointment!.id)));
check("A medical history cannot be read across workspaces", db.getMedicalHistoryByPatient(OTHER, "WH-900001") === undefined);
check("…and neither can a follow-up", db.getHospitalFollowUp(OTHER, followUpId) === undefined);
check("…or a cancellation request", listCancellationRequests(OTHER).length === 0);
check("…or an unanswered inquiry", listUnanswered(OTHER).length === 0);
check("…or a questionnaire", db.getQuestionnaireSession(OTHER, session!.id) === undefined);
check("…or a report", listReports(OTHER).length === 0);

db.saveHisPatient({
  id: "hisp_other", tenantId: OTHER, patientId: "OTHER-1", name: "Ananya Rao",
  phone: "+919845012210", dateOfBirth: "1986-04-11", hasHistory: false, demo: true, createdAt: now,
});
const elsewhere = await identifyPatient(OTHER, { phone: "+919845012210", dateOfBirth: "1986-04-11" });
check("The same person is a different patient in another hospital", elsewhere.canonicalPatientId === "OTHER-1", elsewhere);

const samePhone = bookAppointment({
  tenantId: OTHER, doctorId: "doc_other", date: dayAhead(3), time: "09:00",
  patientName: "Ananya Rao", patientPhone: "+919845012210", actor: "staff_2",
});
check(
  "…and their appointments are not joined up",
  samePhone.ok && samePhone.appointment.patientLeadId !== appointment!.patientLeadId,
  samePhone.ok ? "" : samePhone.problem
);

// ------------------------------------------------------------
section("Demonstration data");

const SEEDED = "ws_seed";
db.saveTenant({ id: SEEDED, name: "Seed Hospital", createdAt: now });
db.saveAgentConfig(SEEDED, { companyName: "Seed Hospital", productName: "Appointments", industry: "Healthcare" });

const first = seedHospital(SEEDED);
check("Twenty doctors are given to the demonstration hospital server", first.doctors === 20, first);
check("…with a patient directory to verify identity against", first.hisPatients > 0, first);
check("…and appointments and FAQs", first.appointments > 0 && first.faqs === 5, first);
check("Every seeded doctor is marked as a demonstration record", db.getDoctors(SEEDED).every((entry) => entry.demo === true));
check("…and carries a local avatar, not a remote one", db.getDoctors(SEEDED).every((entry) => (entry.avatar ?? "").startsWith("/hospital/doctors/")));
check("…with no invented qualifications", db.getDoctors(SEEDED).every((entry) => entry.qualifications === null));
check("Seeded appointments are marked demonstration", db.getAppointments(SEEDED).every((entry) => entry.demo === true));
check("…and so are their confirmation calls", db.getReminders(SEEDED).every((entry) => entry.demo === true));

const second = seedHospital(SEEDED);
check(
  "Seeding twice adds nothing",
  second.doctors === 0 && second.appointments === 0 && second.faqs === 0 && second.hisPatients === 0,
  second
);
check("…and the directory is unchanged", db.getDoctors(SEEDED).length === 20, db.getDoctors(SEEDED).length);
check("Seeding one hospital leaves another alone", db.getDoctors(HOSPITAL).every((entry) => entry.demo === false));

const edited = db.getDoctors(SEEDED)[0];
db.saveDoctor({ ...edited, name: "Dr. Edited By Staff" });
seedHospital(SEEDED);
check("A seeded record somebody edited is not reset", db.getDoctor(SEEDED, edited.id)?.name === "Dr. Edited By Staff", db.getDoctor(SEEDED, edited.id)?.name);

const seededReturning = await identifyPatient(SEEDED, { phone: "+919845012210", dateOfBirth: "1986-04-11" });
check("A seeded patient in the hospital's directory is returning", seededReturning.status === "returning", seededReturning);
const seededNew = await identifyPatient(SEEDED, { phone: "+919855566677", dateOfBirth: "1983-12-19" });
check("A seeded patient left out of it is new", seededNew.status === "new", seededNew);

check("No call was placed anywhere in this run", db.getCallRecords().length === 0, db.getCallRecords().length);

section("Which workspace is a hospital");

const { requireHospitalAuth, workspaceView } = await import("@/lib/hospital/guard");
const { isHospitalWorkspace } = await import("@/lib/hospital/context");
const { enableHospital, disableHospital } = await import("@/lib/hospital/service");
const { hashSessionToken, SESSION_COOKIE } = await import("@/lib/auth/sessions");
const { DEFAULT_AGENT_NAME } = await import("@/lib/hospital/agent");

/** A signed-in request, so the guard's decision is what is under test. */
const SESSION_TOKEN = "test-session-token";
db.saveUser({
  id: "user_desk", tenantId: HOSPITAL, email: "desk@wellness.test", name: "Front Desk",
  passwordHash: "x", role: "owner", createdAt: now, lastLoginAt: null, lockedUntil: null, failedAttempts: 0,
} as never);
db.grantMembership({ userId: "user_desk", tenantId: HOSPITAL, role: "owner", createdBy: "user_desk" });
db.saveSession({
  id: "sess_1", userId: "user_desk", tokenHash: hashSessionToken(SESSION_TOKEN), tenantId: HOSPITAL,
  createdAt: now, lastSeenAt: now, expiresAt: new Date(Date.now() + 86400_000).toISOString(),
} as never);

const asRequest = () =>
  new Request("http://localhost:3000/api/hospital", { headers: { cookie: `${SESSION_COOKIE}=${SESSION_TOKEN}` } });

// The bug this replaced: reading a profile used to create one, so any
// workspace the panel was pointed at became a hospital just by being opened.
const SALES = "ws_sales";
db.saveTenant({ id: SALES, name: "A Sales Workspace", createdAt: now });
hospitalProfile(SALES, "A Sales Workspace");
hospitalProfile(SALES);
check("Reading a hospital profile does not create one", db.getHospitalProfile(SALES) === undefined);
check("…so a workspace does not become a hospital by being looked at", isHospitalWorkspace(SALES) === false);

check("A workspace is a hospital only once somebody enables it", isHospitalWorkspace(HOSPITAL) === false, db.getHospitalProfile(HOSPITAL)?.enabled);
enableHospital(HOSPITAL, "Wellness Hospital", "staff_1");
check("…and then it is", isHospitalWorkspace(HOSPITAL) === true);
check("…which is recorded", db.getHospitalAudit(HOSPITAL).some((row) => row.action === "hospital.enabled"));

const allowed = await requireHospitalAuth(asRequest());
check("A hospital workspace reaches the panel's data", allowed.ok && allowed.tenantId === HOSPITAL, allowed.ok ? allowed.tenantId : allowed.reason);
check("…and the panel can name it on screen", workspaceView(HOSPITAL).name === "Wellness Hospital", workspaceView(HOSPITAL));

db.setSessionTenant("sess_1", SALES);
db.grantMembership({ userId: "user_desk", tenantId: SALES, role: "owner", createdBy: "user_desk" });
const refusedWorkspace = await requireHospitalAuth(asRequest());
check("A workspace that is not a hospital is refused", refusedWorkspace.ok === false, refusedWorkspace.ok ? refusedWorkspace.tenantId : "");
check("…with 409, not 403 — nothing is forbidden, it is just not set up", refusedWorkspace.ok === false && refusedWorkspace.response.status === 409, refusedWorkspace.ok ? "" : refusedWorkspace.response.status);
check(
  "…and a code the panel turns into an invitation",
  refusedWorkspace.ok === false && (await refusedWorkspace.response.clone().json()).error.code === "not_a_hospital"
);

db.setSessionTenant("sess_1", HOSPITAL);
const anonymous = await requireHospitalAuth(new Request("http://localhost:3000/api/hospital"));
check("Without a session there is nothing at all", anonymous.ok === false && anonymous.response.status === 401, anonymous.ok ? "" : anonymous.response.status);

// Turning it off keeps the records.
const appointmentsBefore = db.getAppointments(HOSPITAL).length;
disableHospital(HOSPITAL, "staff_1");
check("Turning the panel off stops it answering", isHospitalWorkspace(HOSPITAL) === false);
check("…and deletes nothing", db.getAppointments(HOSPITAL).length === appointmentsBefore, db.getAppointments(HOSPITAL).length);
enableHospital(HOSPITAL, "Wellness Hospital", "staff_1");
check("…and turning it back on finds them again", isHospitalWorkspace(HOSPITAL) && db.getAppointments(HOSPITAL).length === appointmentsBefore);

// ------------------------------------------------------------
section("The agent's name");

check("The hospital agent is called Maya by default", DEFAULT_AGENT_NAME === "Maya", DEFAULT_AGENT_NAME);

const providerConfig = (await import("@/lib/providers/config")).providerConfigFor(HOSPITAL);
check(
  "The Sarvam application id is left exactly as the provider created it",
  providerConfig?.outbound?.appId === "Amrita---We-4517816a-a47a",
  providerConfig?.outbound?.appId
);
check("…because it identifies a provider resource, not a person", !DEFAULT_AGENT_NAME.includes("---"));

saveWorkspaceProvider(
  HOSPITAL,
  { outbound: { ...providerConfig!.outbound!, agentName: "Maya" } },
  "staff_1"
);
check(
  "A workspace's configured name is what the agent is called",
  (await import("@/lib/providers/config")).providerConfigFor(HOSPITAL)?.outbound?.agentName === "Maya"
);
check(
  "…and renaming her does not touch the provider id",
  (await import("@/lib/providers/config")).providerConfigFor(HOSPITAL)?.outbound?.appId === "Amrita---We-4517816a-a47a"
);

console.log(`
${pass}/${pass + fail} checks passed`);
if (fail) process.exit(1);
