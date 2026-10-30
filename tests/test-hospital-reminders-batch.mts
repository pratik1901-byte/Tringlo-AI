// ============================================================
// Hospital — bulk daily reminders (instant + batch campaign)
// ============================================================
//
// Every eligible appointment for the next day, across every doctor, selected
// and dispatched exactly once — as individual instant calls or as one Sarvam
// campaign with a cohort of one row per appointment. Sarvam is mocked; no real
// call is placed; the database is a throwaway one.
// ============================================================

import { isolateDatabase } from "./isolated-db";

process.env.SARVAM_API_KEY = "test-key-not-a-real-credential";
process.env.SARVAM_ORG_ID = "org_test";
process.env.SARVAM_WORKSPACE_ID = "ws_test";

isolateDatabase("hospital-reminders-batch");

let lastCampaign: any = null;
let lastCohort: any = null;
let lastStatus: any = null;
let instantCount = 0;
let campaignSeq = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  let responseBody: unknown = { ok: true };
  if (/\/api\/outbounds\//.test(url)) {
    instantCount += 1;
    responseBody = { attempt_id: `att_${instantCount}` };
  } else if (/\/campaigns\/[^/]+\/cohorts\/stream$/.test(url)) {
    lastCohort = body;
    responseBody = { cohort_id: "cohort_1", status: "processing", result: { total_records: body?.users?.length ?? 0, valid_records: body?.users?.length ?? 0, rejected_records: 0 } };
  } else if (/\/campaigns\/[^/]+\/status$/.test(url) && method === "PUT") {
    lastStatus = body;
    responseBody = { campaign_id: "camp_1", status: "paused" };
  } else if (/\/campaigns$/.test(url) && method === "POST") {
    lastCampaign = body;
    campaignSeq += 1;
    responseBody = { campaign_id: `camp_${campaignSeq}`, status: "scheduled" };
  }
  return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const db = await import("@/lib/db");
const { saveWorkspaceProvider } = await import("@/lib/providers/config");
const { bookAppointment, enableHospital, hospitalProfile, localDate, updateHospitalProfile } = await import("@/lib/hospital/service");
const { refreshProviderDirectory } = await import("@/lib/hospital/directory");
const { runReminderTick } = await import("@/lib/hospital/reminders");
const {
  collectEligibleReminders,
  chooseStrategy,
  dispatchInstant,
  dispatchBatch,
  buildCohort,
  pauseReminderCampaign,
  runDailyReminders,
  nextDay,
} = await import("@/lib/hospital/reminder-batch");
const { REMINDER_INPUT_VARIABLES } = await import("@/lib/hospital/reminder-variables");
const { applySarvamEvent } = await import("@/lib/calls/service");
const { defaultSchedule } = await import("@/lib/hospital/types");

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); }
};
const section = (name: string) => console.log(`\n=== ${name} ===`);

const HOSPITAL = "ws_wellness";
const now = new Date().toISOString();

db.saveTenant({ id: HOSPITAL, name: "Wellness Hospital", createdAt: now });
db.saveAgentConfig(HOSPITAL, { companyName: "Wellness Hospital", productName: "Appointments", industry: "Healthcare" });
enableHospital(HOSPITAL, "Wellness Hospital", "staff_1");
db.saveWebhookBaseUrl("https://dialo.example.com");
saveWorkspaceProvider(
  HOSPITAL,
  {
    outbound: { appId: "Amrita---We-4517816a-a47a", appVersion: 3, connectionId: "8800e72c-9c-8f9c2a3f-4876", phoneNumber: "+918064269489", agentName: "Maya", agentVariables: REMINDER_INPUT_VARIABLES },
    batch: {
      appId: "Amrita---We-4517816a-a47a", appVersion: 3, appType: "agent", connectionId: "8800e72c-9c-8f9c2a3f-4876",
      phoneNumbers: ["+918064269489"], attemptsPerSecond: 2, cohortMode: "stream", agentVariables: REMINDER_INPUT_VARIABLES,
      retry: { maxRetries: 3, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: true, shortDurationSeconds: 25 },
      schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "18:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    },
  },
  "setup"
);

const TZ = hospitalProfile(HOSPITAL, "Wellness Hospital").timezone;
const tomorrow = nextDay(HOSPITAL);

// Three doctors, so "every doctor" is a real claim.
for (const [id, name] of [["doc_sharma", "Dr. Sharma"], ["doc_rao", "Dr. Rao"], ["doc_mehta", "Dr. Mehta"]]) {
  db.saveDoctor({
    id, tenantId: HOSPITAL, name, specialty: "General", department: "OPD",
    qualifications: null, about: null, avatar: null, phone: null, email: null,
    schedule: { ...defaultSchedule(), days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], start: "09:00", end: "13:00", slotMinutes: 30, breaks: [] },
    exceptions: [], status: "active", demo: false, createdAt: now, updatedAt: now,
  } as never);
}
await refreshProviderDirectory(HOSPITAL);

let phoneSeq = 2000;
function book(doctorId: string, time: string, status: "requested" | "confirmed" = "requested", date = tomorrow) {
  const r = bookAppointment({ tenantId: HOSPITAL, doctorId, date, time, patientName: `Patient ${phoneSeq}`, patientPhone: `+9199000${phoneSeq++}`, actor: "staff_1", status });
  if (!r.ok) throw new Error(`book failed: ${r.problem}`);
  return r.appointment;
}

// ------------------------------------------------------------
section("Every eligible appointment, across every doctor");

// Dr. Sharma: 3 patients, Dr. Rao: 2, Dr. Mehta: 1 — six appointments tomorrow.
const sharma = ["09:00", "09:30", "10:00"].map((t) => book("doc_sharma", t));
const rao = ["09:00", "09:30"].map((t) => book("doc_rao", t));
const mehta = [book("doc_mehta", "09:00")];
const allAppts = [...sharma, ...rao, ...mehta];

const set = collectEligibleReminders(HOSPITAL, tomorrow);
check("All six appointments are collected", set.eligible.length === 6, set.eligible.length);
check("…one reminder per appointment (unique appointment ids)", new Set(set.eligible.map((r) => r.appointmentId)).size === 6);
check("…covering all three doctors' patients", allAppts.every((a) => set.eligible.some((r) => r.appointmentId === a.id)));

// ------------------------------------------------------------
section("Pagination does not truncate a large day");

const paged = collectEligibleReminders(HOSPITAL, tomorrow, 2);
check("With a page size of 2, all six are still collected", paged.eligible.length === 6, paged.eligible.length);

// ------------------------------------------------------------
section("Duplicate prevention: one appointment, one reminder");

const twice = collectEligibleReminders(HOSPITAL, tomorrow);
check("Collecting again yields the same six, not duplicates", twice.eligible.length === 6 && new Set(twice.eligible.map((r) => r.appointmentId)).size === 6);

// ------------------------------------------------------------
section("Consent and status exclusions");

const optedOut = book("doc_sharma", "10:30");
const lead = db.getLeads().find((l) => l.id === optedOut.patientLeadId)!;
db.saveLead({ ...lead, suppressed: true, suppressedReason: "opted out" });
const cancelled = book("doc_rao", "10:00");
const { setAppointmentStatus } = await import("@/lib/hospital/service");
setAppointmentStatus(HOSPITAL, cancelled.id, "cancelled", "staff_1", "patient cancelled");
const afterExclusions = collectEligibleReminders(HOSPITAL, tomorrow);
check("An opted-out patient is excluded with a reason", afterExclusions.skipped.some((s) => s.appointmentId === optedOut.id && /opted out/.test(s.reason)));
check("A cancelled appointment is excluded", afterExclusions.skipped.some((s) => s.appointmentId === cancelled.id));
check("…and the six eligible are unchanged", afterExclusions.eligible.length === 6, afterExclusions.eligible.length);

// ------------------------------------------------------------
section("AUTO strategy picks by volume");

check("Below the threshold → instant", chooseStrategy("auto", 6, 10) === "instant");
check("At/above the threshold → batch", chooseStrategy("auto", 12, 10) === "batch");
check("A lower threshold flips the same day to batch", chooseStrategy("auto", 6, 5) === "batch");
check("Explicit instant/batch are honoured", chooseStrategy("instant", 100) === "instant" && chooseStrategy("batch", 1) === "batch");

// ------------------------------------------------------------
section("Instant dispatch: one outbound per appointment");

updateHospitalProfile(HOSPITAL, { remindersEnabled: true }, "staff_1");
instantCount = 0;
dispatchInstant(HOSPITAL, afterExclusions.eligible);
await runReminderTick();
check("One instant call is placed per eligible appointment", instantCount === 6, instantCount);
check("…and every eligible reminder is now marked sent", afterExclusions.eligible.every((r) => db.getReminder(HOSPITAL, r.id)?.status === "sent"));

// Reset those reminders so the batch test has eligible rows again.
for (const r of afterExclusions.eligible) db.saveReminder({ ...db.getReminder(HOSPITAL, r.id)!, status: "scheduled", callId: null, attemptId: null });

// ------------------------------------------------------------
section("Batch dispatch: one campaign, a cohort of one row per appointment");

const eligibleForBatch = collectEligibleReminders(HOSPITAL, tomorrow).eligible;
const cohort = buildCohort(HOSPITAL, eligibleForBatch, REMINDER_INPUT_VARIABLES);
check("The cohort has one row per appointment, not per doctor", cohort.length === 6, cohort.length);
check("…each row is keyed by its appointment id", cohort.every((u) => eligibleForBatch.some((r) => r.appointmentId === u.user_identifier)));
check("…and carries that appointment's own variables", cohort.every((u) => u.app_variables?.appointment_id === u.user_identifier && Boolean(u.app_variables?.appointment_date)));

const batch = await dispatchBatch(HOSPITAL, eligibleForBatch);
check("The batch dispatch succeeds", batch.ok === true, batch.problem);
check("A campaign was created at Sarvam", Boolean(lastCampaign) && lastCampaign.app_config.app_id === "Amrita---We-4517816a-a47a" && lastCampaign.app_config.app_version === 3);
check("…with the supplied retry rules", lastCampaign.app_config.retry_config.max_retries === 3 && lastCampaign.app_config.retry_config.retry_interval_minutes === 30 && lastCampaign.app_config.retry_config.retry_on.short_duration.threshold_seconds === 25);
check("…attempts_per_second and the allowed window", lastCampaign.app_config.attempts_per_second === 2 && lastCampaign.allowed_schedule.allowed_start_time === "09:00" && lastCampaign.allowed_schedule.allowed_end_time === "18:00" && lastCampaign.allowed_schedule.timezone === "Asia/Kolkata");
check("The cohort was streamed with one user per appointment", Boolean(lastCohort) && lastCohort.users.length === 6);
check("CSV was generated: one header + one line per appointment", Boolean(batch.csv) && batch.csv!.trim().split("\n").length === 7);
check("…reminders are now marked batch with the campaign id", eligibleForBatch.every((r) => { const n = db.getReminder(HOSPITAL, r.id)!; return n.dispatchMethod === "batch" && n.providerCampaignId === batch.campaignId; }));

// ------------------------------------------------------------
section("Batch result maps back to the correct appointment");

const target = eligibleForBatch[0];
const targetAppt = db.getAppointment(HOSPITAL, target.appointmentId)!;
applySarvamEvent({
  attempt_id: "att_batch_1",
  campaign_id: batch.campaignId!,
  cohort_id: batch.cohortId!,
  user_identifier: target.appointmentId,
  user_phone_number: targetAppt.patientPhone,
  // Campaign attempts report the call in connectivity_status, not status.
  connectivity_status: "connected",
  completion_status: "completed",
  final_agent_variables: { identity_verified: "true", appointment_confirmation_status: "confirmed", attendance_status: "attending" },
} as never);
// The hospital hook runs synchronously for a confirmation.
check("The right appointment is confirmed from its campaign result", db.getAppointment(HOSPITAL, target.appointmentId)?.status === "confirmed", db.getAppointment(HOSPITAL, target.appointmentId)?.status);
check("…and no other appointment was touched", eligibleForBatch.slice(1).every((r) => db.getAppointment(HOSPITAL, r.appointmentId)?.status !== "confirmed"));

// ------------------------------------------------------------
section("Campaign pause");

const paused = await pauseReminderCampaign(HOSPITAL, batch.campaignId!);
check("A campaign can be paused", paused.ok === true, paused.problem);
check("…with Sarvam's own action", lastStatus?.action === "pause");

// ------------------------------------------------------------
section("Batch is not sent while reminders are switched off");

updateHospitalProfile(HOSPITAL, { remindersEnabled: false }, "staff_1");
const offResult = await dispatchBatch(HOSPITAL, collectEligibleReminders(HOSPITAL, tomorrow).eligible);
check("With calling off, no campaign is created", offResult.ok === false && /switched off/.test(offResult.problem ?? ""));

// ------------------------------------------------------------
section("runDailyReminders: AUTO end to end");

updateHospitalProfile(HOSPITAL, { remindersEnabled: true }, "staff_1");
// Reset reminders to eligible.
for (const r of db.getReminders(HOSPITAL)) db.saveReminder({ ...r, status: "scheduled", outcome: null, callId: null, providerCampaignId: null, dispatchMethod: undefined });
const summaryBatch = await runDailyReminders(HOSPITAL, { strategy: "auto", threshold: 3 });
check("AUTO with a low threshold runs a batch for the day", summaryBatch.method === "batch" && summaryBatch.queued === summaryBatch.eligibleCount && summaryBatch.eligibleCount > 0, summaryBatch);
updateHospitalProfile(HOSPITAL, { remindersEnabled: false }, "staff_1");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
