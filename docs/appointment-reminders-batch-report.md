# Wellness Hospital — Maya bulk reminder integration (2026-10-30)

Builds on `docs/appointment-reminders-report.md`. Scope: Wellness Hospital /
Maya only; TenWeb, Priya and KhushiBot untouched (verified by
`test-batch-campaign` 71/71 and `test-multitenant` 73/73 still passing). Real
calling stays **off** (`remindersEnabled` false) until the provider-side steps
in §9 are done.

## 1. Instant outbound — request building & integration

Works and is exercised end to end with a mocked provider. Each eligible
appointment becomes one individual outbound through the existing
`sarvamVoiceService.startOutboundCall` (`POST …/api/outbounds/v1/orgs/{org}/
workspaces/{ws}/outbounds`), carrying that appointment's own `agent_variables`,
destination number, connection config and webhook config. The result is
correlated by the `attempt_id` Sarvam returns and fed back to the appointment.
Test: six appointments → six distinct outbound POSTs, each with its own
`appointment_id`/`appointment_date`.

## 2. Batch campaign creation & cohort upload

Implemented against the existing Sarvam campaign client
(`src/lib/providers/sarvam/campaigns.ts`), reused rather than rebuilt:

- **Create** `POST …/scheduling/v1/orgs/{org}/workspaces/{ws}/campaigns` with
  `app_config` (app id, version 3, `app_type: agent`, `attempts_per_second: 2`,
  connection config), `retry_config` (`max_retries: 3`,
  `retry_interval_minutes: 30`, retry on busy + no_answer + short_duration with
  `threshold_seconds: 25`), and `allowed_schedule` (Asia/Kolkata, 09:00–18:00,
  Mon–Fri). **Activation is the `start_timestamp` plus the cohort** — there is
  no separate "start" endpoint, confirmed against the platform's existing
  working campaign launch; nothing here invents one.
- **Cohort** streamed via `POST …/campaigns/{id}/cohorts/stream` (the proven
  path). The CSV + `cohort_transformation_file` upload path is **gated off**:
  the transformation schema is unconfirmed upstream (`transformationSchemaConfirmed()
  → false`), so the CSV is generated for inspection/reporting only and the JSON
  stream — which carries the same `user_phone_number` / `user_identifier` /
  `app_variables` — is used. (§8.)
- **Pause** `PUT …/campaigns/{id}/status` with `action: "pause"`.

New module: `src/lib/hospital/reminder-batch.ts`.

## 3. Every eligible patient, across every doctor

`collectEligibleReminders(tenantId, date)` gathers **all** appointments for the
day (tomorrow by default, Asia/Kolkata), across every doctor and department,
processed in pages (default 200, test-overridable) so a large day is never
truncated. It ensures one reminder per appointment, and excludes, with a
recorded reason: demo appointments, non-open statuses (cancelled/completed/
missed), invalid/missing phone numbers, opted-out patients, appointments with an
open cancellation request, and any already answered or already in flight for the
same cycle. `appointment_id` is the unit of work — one patient with two
appointments gets two calls; the same appointment is never dialled twice.
Tested with three doctors (3 + 2 + 1 patients) → all six collected, unique by
appointment id, with page size 2 to prove multi-page iteration.

## 4. Patient-specific variable mapping (CSV & stream)

`buildCohort()` produces **one cohort row per appointment** (never per doctor):
`user_phone_number` = patient phone, `user_identifier` = appointment id,
`app_variables` = that appointment's `reminderCallVariables()` filtered to the
names Maya's agent declares. `cohortCsv()` (reused from the platform) renders
one header row and one line per appointment. Input variables match Maya's
config exactly: `patient_id, patient_name, patient_first_name, patient_phone,
preferred_language, communication_consent, appointment_id, appointment_date,
appointment_time, appointment_status, doctor_name, department_name,
hospital_name, hospital_address, reminder_type, timezone`. Output variables are
read, never sent (`REMINDER_OUTPUT_VARIABLES`).

## 5. Tracking campaign & individual results

- **Instant**: the per-call `attempt_id` links the reminder to the call; the
  webhook updates the appointment (confirm/reschedule/follow-up) via the §5
  handler of the previous report.
- **Batch**: each reminder stores `providerCampaignId` + `providerCohortId`.
  When a campaign attempt webhook arrives, `recordForHospitalReminderAttempt()`
  matches it by **campaign id + `user_identifier` (appointment id)**, creates
  the call record linked to that reminder, and the same outcome handler applies
  it. Platform campaigns are untouched (the hospital recorder returns null for
  anything that is not one of Maya's cohorts). Tested: a campaign result for one
  appointment confirms exactly that appointment and no other.

The admin reminders page shows the counts (eligible, queued, confirmed,
rescheduled, no-answer, failed, skipped, batch vs instant) and lists the
campaigns with a **Pause** control; a campaign being *created* is never shown as
success — status is distinguished (scheduled/submitted/sent/outcome).

## 6. Duplicate prevention

`appointment_id` + cycle is the uniqueness key. Selection excludes appointments
already answered or in flight for the current cycle; the instant worker locks a
reminder before dialling; a batch-dispatched reminder moves to `sent` and is not
re-selected. Running the daily job twice does not re-dispatch the same
appointment. (Tested: collect twice → same six, no duplicates; instant worker
second pass places nothing more.)

## 7. Tests & results

- `test-hospital-reminders-batch` (new) **30/30**: all-doctors selection,
  pagination, duplicate prevention, consent/status exclusions, AUTO threshold,
  instant one-per-appointment, batch campaign payload (app v3, retry rules,
  window, attempts/sec), cohort one-row-per-appointment, CSV generation,
  reminders marked batch, campaign-webhook→correct-appointment correlation,
  pause, and off-switch safety.
- `test-hospital-reminders` **48/48**, `test-hospital` **246/246**,
  `test-batch-campaign` **71/71** (platform campaigns unaffected),
  `test-multitenant` **73/73**, `test-generic-agents` **66/66**,
  `test-demo-prep` **34/34** — **568 total**, all passing.
- `next build` succeeds (exit 0). Dev server restarted with `npm run dev`;
  migration applied outbound v3 + batch v3 (16 vars, +918064269489); `:3000`→200.
- No real call placed anywhere; `globalThis.fetch` mocked, throwaway DB.

## 8. Unsupported Sarvam functionality / missing configuration

- **`cohort_transformation_file` schema is unconfirmed.** Sarvam does not
  publish it, so CSV upload is refused before anything is sent and cohorts go
  via the JSON stream (same data). The CSV is built and available for
  inspection. CSV upload can be enabled only once the transformation format is
  confirmed.
- **App version 3 must be published/deployed in Sarvam** for the outbound and
  batch agents. The live account currently shows `Amrita---We-4517816a-a47a` v1
  deployed; v3 is set in Tringlo per the brief but must exist in Sarvam or calls
  will be rejected. (I cannot publish or read app versions via API — only
  deployments are exposed.)
- **Maya's app must declare the input variables and author the output
  extraction + the confirmation/reschedule conversation.** Unverifiable via API.
- **Hospital-server integration is the demonstration stand-in** — availability
  and cancellation use the panel's own schedule data; no live hospital API is
  connected.
- Batch result correlation depends on Sarvam echoing the cohort's
  `user_identifier` (appointment id) and a `connectivity_status` on campaign
  webhooks, as the existing campaign pipeline already assumes.

## 9. Exact manual steps before enabling real calls

1. In the **Sarvam dashboard**, publish/deploy app `Amrita---We-4517816a-a47a`
   **version 3** for outbound and batch; declare the 16 input variables (§4) and
   the output variables (`REMINDER_OUTPUT_VARIABLES`); author Maya's prompt for
   the confirmation/reschedule conversation and to return those outputs.
2. Confirm connection `8800e72c-9c-8f9c2a3f-4876` (the verified 4-segment value;
   the brief's `8800e72c-9c8f9c2a3f-4876` is the earlier typo and was not used)
   and caller `+918064269489` are live for outbound/campaign on v3.
3. Place **one** instant test call and run **one** small batch to a staff
   number; confirm the variables are spoken correctly and the result posts back
   (`HOSPITAL_REMINDER_OUTCOME` / `HOSPITAL_REMINDER_ATTEMPT_RECORDED` logs) and
   maps to the right appointment.
4. If CSV upload is required, obtain and confirm the `cohort_transformation_file`
   format, then switch the batch `cohortMode` to `upload`.
5. Only then turn on `remindersEnabled` for Wellness Hospital in Settings. Until
   then the schedule is maintained and campaigns/cohorts are prepared but nothing
   is dialled.

## Files changed
- `src/lib/hospital/reminder-batch.ts` (new) — selection, AUTO strategy,
  instant + batch dispatch, pause, campaign-webhook correlation.
- `src/lib/hospital/reminder-variables.ts` — input names aligned to Maya's
  config; `REMINDER_OUTPUT_VARIABLES` added.
- `src/lib/hospital/reminder-outcomes.ts` — reads `opt_out_requested` /
  `human_handoff_requested`; terminal-status guard for campaign webhooks.
- `src/lib/hospital/types.ts` — reminder `dispatchMethod` / `providerCampaignId`
  / `providerCohortId`.
- `src/lib/calls/service.ts` — route unmatched campaign attempts to the hospital
  recorder (additive; platform campaigns unaffected).
- `src/lib/db/index.ts` — `findReminderByProviderCampaign()`.
- `src/app/api/hospital/reminders/route.ts` — `send_all` + `pause_campaign`
  actions, campaign counts.
- `src/app/hospital/reminders/page.tsx` — "Send all eligible" + campaign pause.
- `data/workspace-setup.json` + `src/lib/db/migrations.ts` — Maya outbound &
  batch at v3 with the input variables (reversible migration).
- `tests/test-hospital-reminders-batch.mts` (new).
