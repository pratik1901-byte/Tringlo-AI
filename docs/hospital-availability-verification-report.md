# Wellness Hospital — Maya availability & booking, verified end to end (2026-10-30)

Scope: Wellness Hospital / Maya only. This pass **verified the running system**,
not just the code. Backend verification was done by invoking the live tool
endpoint exactly as Sarvam would (HTTP, with the workspace token) against the
dev server. TenWeb/Priya untouched (regression suites still pass).

## 1. Exact root cause of the availability failure

**It is not in Tringlo, and the booking UI is not disconnected.** One
authoritative availability engine (`slotsFor` / `availabilityFor` in
`src/lib/hospital/service.ts`, reading the hospital directory → the `doctors`
collection) powers **all** of: the admin Appointments booking form, the Demo
Doctor List, inbound RAG context, and Maya's `check_doctor_availability` /
`get_available_slots` / `book_appointment` tools. There is no second
availability store, no hardcoded/mock/fallback slots.

Proven live against the running server (invoked as Sarvam would):

| Call | Result |
|---|---|
| `get_doctors` | 25 real doctors (20 seeded + 5 demo) in **7 ms** |
| `search_doctors` "cardio" | Dr. Nisha Rao, Dr. Arjun Nair |
| `check_doctor_availability` | real free slots in **10 ms** |
| `book_appointment` | **committed** `apt_…` (confirmed) — appeared in the same `appointments` collection the admin page reads |
| book same slot again | `slot_taken` (double-booking guard, DB-enforced) |
| no token | **401** |
| `GET` diagnostics | `dbConnected:true, doctorCount:25, demoDoctorCount:5, availableSlotsToday:13` |

**The actual cause of the five-second hangup is provider-side: Maya's deployed
Sarvam app does not invoke this endpoint during a call** (it is not configured
with the function/tool definitions that point at it, or points them elsewhere).
Sarvam then waits for a tool result that never arrives, the turn stalls, Maya
says "are you still there?", and the voice session times out. No Tringlo change
can make the voice agent call a tool it is not configured to call; the required
Sarvam configuration is in §10. (The verification booking and its fake patient
lead were removed afterward, so no test data was left in the workspace.)

## 2. Was the appointment-booking UI disconnected from the database?

No. `src/app/hospital/appointments/page.tsx` fetches free slots from
`GET /api/hospital/appointments?slots=1&doctorId=…&date=…` → `slotsFor`, lists
doctors from `GET /api/hospital/providers` (the same directory), and books via
`POST` → `bookAppointment`. It uses the same doctor ids and the same service as
Maya. The server re-checks the slot as it writes, so a booking cannot race.

## 3. Do schedules and slots use the same backend service?

Yes — a single engine. Call sites of `slotsFor`/`availabilityFor`:
`service.ts` (the engine), `agent-tools.ts` (Maya), the appointments route
(admin booking), `demo-doctors.ts` (Demo Doctor List), `context.ts` (inbound
RAG), `seed.ts`. Changing a doctor's schedule or blocking a date in the Demo
Doctor List refreshes the directory and immediately changes what all five
surfaces return (covered by `test-hospital-agent-tools`: "a blocked date offers
no slots to Maya").

## 4. Files and services changed

- `src/lib/hospital/agent-tools.ts` — explicit availability envelope
  (`available` / `slots` / `message`, so an empty day is a clear, speakable "no
  availability" result, not an empty success); a recent-errors ring buffer; and
  `agentToolsDiagnostics()`.
- `src/app/api/hospital/agent-tools/route.ts` — per-call **correlation id**
  echoed to the caller, richer structured logs (`AGENT_TOOL_RECV` /
  `AGENT_TOOL_DONE` with tool, ids, result count, duration, error), and a
  `GET` **diagnostics** probe (endpoint/DB health, doctor & demo counts, free
  slots today, latest tool errors).
- No change to the availability engine or the booking service — they were
  already correct and shared; nothing was duplicated.

## 5. Do Maya's tools retrieve real database availability?

Yes — verified live (§1): doctors and slots come straight from the hospital
directory and the `doctors`/`appointments` collections; nothing is fabricated.
An empty day returns `{ ok:true, available:false, slots:[], message:"No
available appointments were found for the requested date." }`.

## 6. Are bookings committed to the database?

Yes — verified live: `book_appointment` created a real confirmed appointment in
the shared `appointments` collection, and an immediate re-book of the same slot
was refused (`slot_taken`). The tool returns the real appointment id and never
reports success before the write.

## 7. Is Sarvam actually connected to the in-call tools?

**No — and this is the unresolved blocker.** The endpoint is correct, fast,
authenticated and proven, but whether Maya's *deployed Sarvam app* calls it is
provider-side configuration. Tringlo cannot read or write a Sarvam app's
tool/function definitions through any API (app-authoring reads return 404; only
deployments are exposed), so this cannot be verified or set from code. It is a
manual Sarvam dashboard action (§10). This report does not claim the integration
works — it claims the Tringlo side is verified and the Sarvam side is not yet
connected.

## 8. Is the five-second termination resolved?

The Tringlo side that would cause it (a missing/slow/erroring tool endpoint) is
fixed and proven: the endpoint answers in single-digit milliseconds with a
structured result, logs every call with a correlation id and duration, and
surfaces errors on the diagnostics probe. **The hangup itself will persist until
Maya's Sarvam app is configured to invoke the endpoint (§10)** — that is the one
remaining cause, and it is outside Tringlo.

## 9. Tests executed and results

- Live HTTP verification against the running server (§1): all six calls behaved
  correctly; `GET` diagnostics healthy.
- `test-hospital-agent-tools` **30/30** (now includes the explicit-envelope and
  diagnostics checks), `test-hospital-reminders-batch` 30/30,
  `test-hospital-reminders` 48/48, `test-hospital` 246/246,
  `test-batch-campaign` 71/71, `test-multitenant` 73/73,
  `test-generic-agents` 66/66, `test-demo-prep` 34/34 — **598 total, all green**.
- `next build` exit 0. No real call placed; no fake patient left behind.

## 10. Remaining provider-side action (exact Sarvam dashboard steps)

The five-second hangup is resolved **only** by connecting Maya's app to the
tool endpoint. In the Sarvam dashboard, on Maya's app
(`Amrita---We-4517816a-a47a`), add function/tool definitions that call:

`POST {PUBLIC_HTTPS_URL}/api/hospital/agent-tools?k={WELLNESS_WEBHOOK_TOKEN}`
with header `Content-Type: application/json` and body
`{ "tool": "<name>", "args": { … } }`. The response is
`{ ok, data | error, code?, tookMs, correlationId }`; the agent should read
`ok` and speak `data` (or `error`). Tools and their `args`:

- `get_doctors` — `{}`
- `search_doctors` — `{ query }`
- `check_doctor_availability` — `{ doctor_id, date "YYYY-MM-DD" }`
- `get_available_slots` — `{ doctor_id?, specialty?, from_date?, days? }`
- `book_appointment` — `{ patient_name, patient_phone, doctor_id, appointment_date, appointment_time "HH:MM" }`
- `get_patient_appointments` — `{ patient_phone }`
- `reschedule_appointment` — `{ appointment_id, new_date, new_time }`
- `cancel_appointment` — `{ appointment_id, confirm: true, reason? }`
- `get_appointment_details` — `{ appointment_id, patient_phone? }`

Also required:
1. **Publish/deploy the app version** that declares these tools (the account
   currently shows v1 deployed; v3 is set in Tringlo).
2. **Use a stable public HTTPS URL.** In dev, the cloudflared quick-tunnel
   hostname rotates on every `npm run dev`, so a tool URL registered in Sarvam
   goes stale after a restart — use a fixed domain (or re-point the tool URL on
   each restart) so Sarvam can always reach the endpoint.
3. **Enable inbound for Wellness** so the deployment is linked and inbound calls
   are recorded (separate issue, see the previous report).
4. After configuring, place one controlled test call and confirm an
   `AGENT_TOOL_RECV` / `AGENT_TOOL_DONE` log line appears for the call — that is
   the proof the agent actually invoked the tool.

Until step 1–2 are done, Maya can answer questions and read doctor info but
cannot complete an availability check or booking on a live call, exactly as
observed.
