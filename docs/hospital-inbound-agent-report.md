# Wellness Hospital — Maya inbound agent, booking & call history (2026-10-30)

Scope: Wellness Hospital / Maya only. TenWeb, Priya, KhushiBot untouched
(verified: `test-batch-campaign` 71/71, `test-multitenant` 73/73 still pass).
Real calling stays off until the Sarvam-side steps in §9 are done.

## 1. Root cause of the five-second call termination

**There was no way for Maya to act on the database during a call.** The only
inbound Sarvam hook Tringlo exposed was `/api/webhooks/sarvam/inbound/context`
— an *on-start* RAG hook that hands the agent doctor/business context before it
speaks. There was **no mid-call tool/function endpoint**. So when Maya's Sarvam
agent invokes an "availability"/"booking" tool, the tool call has nothing to
reach (or points at an endpoint that does not exist), Sarvam waits for a result
that never comes, the turn stalls, Maya fills the silence with "are you still
there?", and the voice session times out a few seconds later.

**Fix (Tringlo side):** a deterministic in-call tool API (§2) that answers
within the turn with a structured result. **Fix (Sarvam side, required):**
Maya's app must be configured with function/tool definitions that call that
endpoint — Tringlo cannot configure the provider's tools or its session
timeouts, and none were invented here. The exact tool contract is in §9.

## 2. Database-backed RAG and action architecture

- **RAG (retrieval)** is unchanged and already correct: the on-start context
  hook supplies hospital and doctor information; it is read-only.
- **Actions (deterministic)** are new: `src/lib/hospital/agent-tools.ts` plus
  the endpoint `POST /api/hospital/agent-tools`. The agent names a tool and its
  arguments; the server runs the matching backend service and returns
  `{ ok, data }` or `{ ok:false, error, code }`. **The LLM never touches the
  database and never generates SQL.** Maya is told success only when the
  database confirmed it. Tools (all over the real Wellness data):
  `get_doctors`, `search_doctors`, `check_doctor_availability`,
  `get_available_slots`, `book_appointment`, `get_patient_appointments`,
  `reschedule_appointment`, `cancel_appointment`, `get_appointment_details`.
  Each reuses the existing services (`slotsFor`, `availabilityFor`,
  `bookAppointment`, `rescheduleAppointment`, `requestCancellation`), so slot
  validation, the double-booking guard, history preservation and the "never
  cancel without confirmation" rule all come for free. Booking validates the
  slot immediately before writing. Every call logs tool + duration + outcome
  (`AGENT_TOOL …`) so a slow or failing tool is visible, never silent.

Authentication is the workspace's webhook token (as the context hook uses); a
call may act only on its own hospital.

## 3. Demo doctors seeded

`src/lib/hospital/demo-doctors.ts` seeds five clearly-marked demo doctors with
realistic names — Dr. Rhea Sharma (General Medicine), Dr. Arjun Nair
(Cardiology), Dr. Kavya Reddy (Dermatology), Dr. Vivaan Malhotra (Orthopedics),
Dr. Sara Thomas (Pediatrics) — each `demo: true` (shown with a DEMO tag),
Asia/Kolkata, working hours with a lunch
break, 20–30-minute slots, consulting every day so there is **future**
availability from now through Sunday. Availability is schedule-derived and
`slotsFor` never returns a past slot, so no past slot is ever created. Seeding
is **idempotent** (fixed demo ids; existing demo doctors and any admin edits are
preserved; real doctors and appointments are never touched).

## 4. Demo Doctor List — admin panel

New nav item **Demo Doctor List** (`/hospital/demo-doctors`) under Clinic, with
`GET/POST/PUT/DELETE /api/hospital/demo-doctors`. Staff can seed, add, edit
(specialty, consulting days, hours, slot length), block/unblock specific dates,
enable/disable, and delete — demo doctors only. Each row shows days, hours, slot
length, this-week free/booked/blocked tallies, and status. **Every write
refreshes the provider directory**, so a change here immediately changes the
availability the tools return to Maya (tested). The real "Doctors" section
remains intentionally absent — real providers come from the hospital's own
system via the integration adapter; this list is explicitly demonstration data.

## 5. Appointment operations tested

`tests/test-hospital-agent-tools.mts` — **26/26**: doctor search by specialty
and by name; real availability (and a break never offered); booking a free slot
writes a real confirmed appointment with a reference id; double-booking
prevented; a break time rejected; retrieval by phone; reschedule with history
preserved; cancellation refused without explicit confirmation and processed
with it; appointment details gated by matching phone (no disclosure on a
mismatch); unknown tool returns a structured failure; a blocked date instantly
removes availability; and strict isolation (one hospital never sees another's
doctors). The §5/§6 conversation flow is realised by these tools in that order.

## 6. Root cause of the missing inbound call

Diagnosed from the live database: **Wellness inbound is switched off and has no
linked Sarvam deployment** (`inboundSettings.enabled = false`,
`deploymentId = null`). An inbound completion is attributed to a workspace by
`recordForInboundCall` → `findInboundSettingsByDeployment(deployment_id)`; with
no deployment linked to Wellness, a call to Maya's number cannot be mapped, so
`applySarvamEvent` returns `unknown_attempt` and the call is never recorded —
exactly the missing call. A secondary dev-only factor: the cloudflared quick
tunnel's hostname rotates on every `npm run dev`, so a webhook URL registered
with a deployment goes stale after a restart.

**Fix:** enable inbound for Wellness (Settings → it registers/links the Sarvam
deployment), after which `findInboundSettingsByDeployment` resolves and every
subsequent inbound call is recorded in the Wellness workspace. This is an
operator action — inbound was never enabled for this workspace — so it is listed
in §9; no call record was fabricated. (Code: call history now also links a call
to an appointment by `appointment.callId`, so an inbound booking shows its
result — §7.)

## 7. The two old "Amrita" call records — deleted

Verified then deleted exactly two records, the only Wellness call records and
both carrying the old display name **Amrita**:
`call_1792945668768_q277ct` (2026-10-25T16:27:48Z) and
`call_1792945577104_nhmgjc` (2026-10-25T16:26:17Z), with their local raw events
and webhook receipts. Backup:
`data/backups/database.before-amrita-delete-20261030-152838.json`. Not touched:
the Sarvam application, Maya's agent configuration, any patient or appointment
record, TenWeb, and any newer call. Neither record had a stored recording URL,
so there was nothing remote to remove; had there been, remote Sarvam recordings
cannot be deleted through a supported API and would need removing in the Sarvam
dashboard. Maya is the display name throughout the panel.

## 8. Transcript & recording integration status

The Call History page already renders direction, status, duration, call id,
agent (Maya), summary, the full transcript and a per-call detail dialog, and an
authenticated recording endpoint exists (`/api/calls/[id]/recording`).
Transcripts and recordings appear **only when Sarvam returns them** — none are
fabricated. This effort connected a call to its **booking result**: the call
history now links an appointment both via a confirmation reminder and via
`appointment.callId`, so a call where Maya booked, rescheduled or cancelled shows
the appointment, doctor, date and reference id. For any inbound call to be
captured at all, inbound must first be enabled (§6/§9).

## 9. Remaining Sarvam dashboard configuration (before real calls)

1. **Configure Maya's app for function/tool calling** to
   `POST {public_url}/api/hospital/agent-tools` with the workspace webhook token,
   body `{ "tool": "<name>", "args": { … } }`, for the nine tools in §2 — e.g.
   `book_appointment` takes `patient_name, patient_phone, doctor_id,
   appointment_date (YYYY-MM-DD), appointment_time (HH:MM)`;
   `check_doctor_availability` takes `doctor_id, date`;
   `cancel_appointment` takes `appointment_id, confirm:true`. This is the actual
   resolution of the five-second hangup; until Maya's app calls these tools she
   cannot complete a booking.
2. **Publish/deploy app version 3** for Maya (the account currently shows v1).
3. **Enable inbound for Wellness Hospital** so its Sarvam deployment is
   registered/linked — otherwise inbound calls are not recorded (§6).
4. **Enable transcript and recording** on the app if they are to appear in the
   panel; confirm the recording URL is returned to the webhook.
5. Keep `remindersEnabled` off until a controlled test call verifies the above.

## Tests & build
- `test-hospital-agent-tools` 26/26 (new), `test-hospital-reminders-batch` 30/30,
  `test-hospital-reminders` 48/48, `test-hospital` 246/246,
  `test-batch-campaign` 71/71, `test-multitenant` 73/73,
  `test-generic-agents` 66/66, `test-demo-prep` 34/34 — **594 total, all green**.
- `next build` exit 0; `/api/hospital/agent-tools`, `/api/hospital/demo-doctors`
  and `/hospital/demo-doctors` registered. Dev server restarted; `:3000`→200.
- No real call placed; providers mocked; throwaway DB.

## Files changed
- `src/lib/hospital/agent-tools.ts` (new) — the nine deterministic tools.
- `src/app/api/hospital/agent-tools/route.ts` (new) — token-authed tool endpoint.
- `src/lib/hospital/demo-doctors.ts` (new) — idempotent seed + week view.
- `src/app/api/hospital/demo-doctors/route.ts` (new) — demo-doctor CRUD.
- `src/app/hospital/demo-doctors/page.tsx` (new) — Demo Doctor List admin.
- `src/components/hospital/shell.tsx` — Demo Doctor List nav item.
- `src/app/api/hospital/calls/route.ts` — link a call to its appointment by callId.
- Data: two Amrita call records removed (backed up).
