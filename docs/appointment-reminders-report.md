# Wellness Hospital — Maya appointment-reminder workflow (2026-10-30)

Scope: Wellness Hospital / Maya only. TenWeb, Priya and KhushiBot were not
touched. Much of this workflow already existed; this effort wired the genuine
gaps (appointment context into the call, and the call result back into the
appointment), added a manual trigger and a results view, and tested it with a
mocked provider. Reminder calling is **off by default** and a short list of
provider-side steps remains before real calls can be switched on (§10–11).

## 1. Existing appointment data source

Appointments live in the Tringlo database per workspace (`appointments`, with a
status audit trail in `appointmentEvents`), created through
`bookAppointment()`/`rescheduleAppointment()` in `src/lib/hospital/service.ts`.
Patients are the workspace's own leads (matched on normalised phone); doctors
and real availability come through the hospital-server adapter
(`src/lib/hospital/his`, currently the **demonstration stand-in** — availability
is computed from each doctor's schedule, never fabricated). No separate patient
store was created, and no external hospital API is connected.

## 2. Variables created and their mappings

New builder `reminderCallVariables(appointment)` in
`src/lib/hospital/reminder-variables.ts` produces the **input** variables from
one appointment (only non-empty values, each a string, nothing from the medical
record):

`patient_id, patient_name, patient_first_name, patient_phone,
preferred_language, communication_consent, appointment_id, appointment_date,
appointment_time, doctor_name, department_name, hospital_name, hospital_address,
appointment_status, appointment_type, reminder_type, timezone, callback_number`

These are declared on Maya's outbound config (`agentVariables`, applied by the
`data/workspace-setup.json` migration) so the provider layer actually sends
them. The provider sends only the names Maya's Sarvam app declares — an
undeclared field is simply not sent, never a hard failure.

**Output** variables are read back from the call's extracted variables and
interpreted by `interpretReminderCall()` in
`src/lib/hospital/reminder-outcomes.ts`:
`identity_verified, appointment_confirmation_status, attendance_status,
reschedule_requested, patient_response, preferred_reschedule_date/time,
new_appointment_date/time, selected_slot_id, call_disposition, call_summary,
do_not_call, human_handoff_required, next_action`. Setting a variable never
updates the database by itself — every value is validated first (§5–6).

## 3. Sarvam outbound configuration implemented

Maya's outbound was **already** configured and is verified correct against the
live Sarvam account: app `Amrita---We-4517816a-a47a` v1, connection
`8800e72c-9c-8f9c2a3f-4876` (the 4-segment value — the brief's
`8800e72c-9c8f9c2a3f-4876` is the earlier typo and was **not** used), caller
`+918064269489`. The live deployment list shows this app is `inbound_outbound`,
so outbound does not break inbound. Only `agentVariables` was added (the 18
above); app id, version, connection and phone were left untouched. Internal
tenant id (`tenant_1792938564756_qe17wn`) is kept distinct from the Sarvam
workspace id (`019f6b21-2f4f-...`).

## 4. How tomorrow's appointments become today's reminders

Unchanged and reused: `scheduleReminderFor()` creates one `confirmation`
reminder per open appointment, due `reminderLeadHours` (default 24h, in
Asia/Kolkata) before it; an appointment booked inside that window is due as soon
as is reasonable. The server-side worker `runReminderTick()`
(`src/lib/hospital/reminders.ts`), driven by the platform scheduler, places due
calls — no browser required. It now sends the appointment variables (§2). Every
safety gate already enforced there is kept: demo appointments, reminders
switched off, opted-out patients, cancelled/completed appointments, an
already-answered cycle, and missing provider/webhook config are all skipped with
a reason, and a row is locked before dialling so two passes cannot both place
it (idempotency / no duplicate calls — TEST 10).

## 5. How confirmation updates the database

On a finished call the outbound webhook (`applySarvamEvent`) saves the call
record, then — only for a hospital workspace with a reminder linked to that call
— runs `applyReminderCallResult()`. An appointment is marked **confirmed** only
on an explicit confirmation from a caller whose `identity_verified` is true. A
no-answer, an unverified caller, an unclear reply or an uninterpretable result
changes nothing. The patient's words and a confirmation timestamp are kept on
the reminder, and the call id is already linked. The agent's spoken claim is
never trusted — the validated extracted variables are.

## 6. Availability checking and rescheduling

Reuses `slotsFor()`/`availabilityFor()` (real availability from doctor
schedules via the HIS adapter) and `rescheduleAppointment()`, which **re-checks
the slot is free** before moving anything and records the old → new time as an
`appointmentEvent` (history preserved). When the patient chose a concrete slot
that is still free, the appointment is moved and a fresh reminder is scheduled
for the new time. If the slot is gone, or no concrete slot was chosen, nothing
is moved and a **human follow-up** is raised instead — the patient is never told
it moved unless the backend actually moved it. A patient saying "I can't make
it" is **never** auto-cancelled; cancellation requires explicit intent and goes
through the verified `requestCancellation()` workflow, which only cancels once a
destination (the hospital system or staff) confirms.

## 7. How reminder results appear in the admin panel

The existing **Confirmation calls** page (`/hospital/reminders`) was extended to
serve as the results view: result-category filters (Confirmed, Reschedule
requested, No answer, Needs follow-up, plus the lifecycle states Placed/Failed/
Skipped/Cancelled), the patient's answer and the server's action per row, and a
manual **Send now** action for an eligible appointment (`action: "send"` on the
reminders API — it only *queues*; the worker stays the single dialer so every
safety gate still applies). A separate "Reminder Results" nav item was not added;
the one page now covers both the schedule and the outcomes.

## 8. How human follow-ups are handled

Reuses the hospital follow-up system (`src/lib/hospital/followups.ts`,
`createFollowUp` with 24h de-duplication by patient + reason). A follow-up is
raised when a reschedule can't be completed automatically, when no slot was
chosen, when the patient declines without rescheduling, when identity could not
be verified, when human handoff was requested, or when the result could not be
interpreted. Statuses: new, pending_review, assigned, callback_scheduled,
in_progress, completed, unable_to_reach, cancelled.

## 9. Tests executed and their results

New suite `tests/test-hospital-reminders.mts` (mocked Sarvam, throwaway DB, no
real calls) — **48/48 passing**, covering all twelve brief scenarios: confirm,
real availability, reschedule-with-history, unavailable-slot→follow-up,
decline-without-cancel, explicit-cancellation→verified workflow,
no-answer→requeue-then-fail, wrong-person→no-confirm+follow-up, do-not-call
respected, duplicate-reminder→one-call, duplicate-result→no-double-update,
uninterpretable→flagged — plus variable-building and non-hospital isolation.

Regression: `test-hospital` 246/246, `test-multitenant` 73/73,
`test-generic-agents` 66/66, `test-demo-prep` 34/34 — **467/467 total**.
`next build` succeeds (exit 0). Dev server restarted with `npm run dev`
(tunnel + webhook registration); `:3000` → 200.

## 10. Missing hospital API / credentials / Sarvam configuration

- **The workflow is not fully operational for real calls**, and this is not
  claimed. The hospital-server integration is the **demonstration stand-in**;
  there is no live hospital API connected, so availability/reschedule use the
  panel's own schedule data. A live HIS adapter exists (`his/live.ts`) but is
  pointed at nothing.
- **Maya's Sarvam app must declare the variables.** I cannot read or edit the
  app's variable schema or prompt through any Sarvam API (every app-authoring
  read path returns 404; only deployments are exposed). The 18 input variables
  (§2) reach Maya only if her app declares them; the output variables (§2) come
  back only if her prompt is authored to collect and return them. This must be
  confirmed in the Sarvam dashboard.

## 11. Exact manual steps before activating real outbound calls

1. In the **Sarvam dashboard**, open app `Amrita---We-4517816a-a47a` and confirm
   (or add) the input variables in §2 and the extracted/output variables in §2,
   and author Maya's prompt to run the confirmation/reschedule conversation and
   return those outputs. (If any input variable is not declared there, trim it
   from the outbound `agentVariables` on the hospital **AI Agent** page so calls
   are not rejected.)
2. Confirm the outbound connection `8800e72c-9c-8f9c2a3f-4876` and caller
   `+918064269489` are live for outbound on that app.
3. Place **one** real test call to a staff number and confirm the appointment
   variables are spoken correctly and the result posts back (watch for the
   `HOSPITAL_REMINDER_OUTCOME` log line).
4. Only then, in **Settings**, turn on `remindersEnabled` for Wellness Hospital.
   Until this is on, the schedule is maintained but nothing is dialled.
5. (Optional) connect a live hospital API by configuring the integration in
   Settings; until then availability and cancellation use the demo adapter.

## Files changed
- `src/lib/hospital/reminder-variables.ts` (new) — input variable builder.
- `src/lib/hospital/reminder-outcomes.ts` (new) — interpret + apply call result.
- `src/lib/hospital/reminders.ts` — send appointment variables on the call.
- `src/lib/calls/service.ts` — feed a finished call to the appointment (hospital-scoped, never fails the webhook).
- `src/lib/db/index.ts` — `getReminderByCallId()`.
- `src/lib/db/migrations.ts` + `data/workspace-setup.json` — declare Maya's appointment variables (reversible; delete the file to stop).
- `src/app/api/hospital/reminders/route.ts` — manual `send` action.
- `src/app/hospital/reminders/page.tsx` — result-category filters + Send now.
- `tests/test-hospital-reminders.mts` (new) — the 12 scenarios.
