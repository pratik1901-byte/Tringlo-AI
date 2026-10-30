# Wellness Hospital — production readiness & the Maya tool connection (2026-10-30)

Straight answer up front: I did every piece of application, security, and
provider-configuration work in my control, and verified it against the running
server. I could **not** deploy to a public host or register the tools in Sarvam
from this environment, because it has **no hosting CLI, no host token, no git
remote, and no Sarvam dashboard access** — only the Sarvam API key, which cannot
author an app's tools (that API is not exposed). Those two steps need your
accounts; everything else is done and the two remaining actions are mechanical,
with the exact artifacts to do them. I am not claiming the live connection is
closed — it requires those two logins.

## What is done and verified in this repo

- **Secure, header-authenticated tool endpoint.** `POST /api/hospital/agent-tools`
  now accepts `Authorization: Bearer <token>` (preferred — keeps the token out
  of URLs and logs) as well as `?k=<token>`. Verified live: a Bearer call
  returned 25 doctors with a correlation id; a wrong token → 401; the token is
  never logged. Strict workspace isolation, rate limiting, and per-argument
  validation are in place; a TenWeb token cannot reach hospital data.
- **The nine tools run real DB operations, fast.** Re-verified live against the
  running server: `get_doctors` (7 ms), `check_doctor_availability` (10 ms),
  `book_appointment` committed a real appointment that appeared in the admin
  Appointments collection, a same-slot re-book was refused, and empty days
  return an explicit `{ available:false, slots:[], message }`. (The verification
  booking and its fake patient were removed afterward.)
- **Diagnostics + logging (§6/§11).** `GET /api/hospital/agent-tools` returns
  endpoint/DB health, doctor & demo counts, free-slots-today, and the latest
  tool errors. Every call logs `AGENT_TOOL_RECV` / `AGENT_TOOL_DONE` with tool,
  correlation id, duration, result count and outcome — no patient data.
- **One shared availability engine (§7).** Admin booking, Demo Doctor List,
  inbound RAG and Maya's tools all use `slotsFor`/`availabilityFor` over the same
  `doctors`/`appointments` collections. An admin schedule change immediately
  changes Maya's availability (tested); a Maya booking shows in the admin panel
  (verified live).
- **Deployment artifacts for a persistent host.** `Dockerfile`, `.dockerignore`,
  `render.yaml` — a single always-on container with a persistent disk at
  `/app/data` and `numInstances: 1`. This is the correct target for a JSON-file
  DB + in-process scheduler; Vercel serverless is deliberately **not** used
  because it is ephemeral and multi-instance and would reset the database.
- **Exact Sarvam provider config.** `docs/sarvam-maya-tools.json` (the nine
  function definitions with JSON-Schema arguments, endpoint and auth) and
  `docs/sarvam-maya-setup.md` (the runbook: deploy, register tools, the prompt
  additions for Maya's behavior, enable inbound, and the verification that
  proves a live tool invocation).
- **604 automated checks pass** (agent-tools 36/36 including the new header-auth
  and diagnostics tests; hospital 246; reminders 48; reminders-batch 30;
  batch-campaign 71; multitenant 73; generic-agents 66; demo-prep 34).
  `next build` exit 0. No real call placed.

## Final report (your 11 points)

1. **Production URL** — not yet live; the repo is deploy-ready (`render.yaml`),
   and `WEBHOOK_BASE_URL` becomes the stable URL on deploy. Needs your host.
2. **Hosting architecture** — single always-on Docker container + persistent
   disk (Render blueprint provided); web + webhooks + in-process scheduler in
   one process; not serverless.
3. **Database & storage** — JSON file DB at `/app/data` on a persistent volume
   (durable, single-instance). Recordings fetched from Sarvam on demand.
4. **Maya's active Sarvam app version** — account shows v1 deployed; Tringlo is
   configured for v3. Publishing v3 with tools is a dashboard action.
5. **Are all nine tools registered?** — **No**, not yet in Sarvam (no dashboard
   access here). The exact definitions to register are in
   `docs/sarvam-maya-tools.json`.
6. **Live tool invocation succeeded?** — Over HTTP to the running backend,
   **yes** (Bearer + `?k=`, real data, real booking). From a Sarvam voice call,
   **not yet** — that needs step B below.
7. **Appointment booked during a controlled voice call?** — Not yet (needs a
   deployed URL + tools registered + a test call). The booking path itself is
   proven over HTTP.
8. **Appeared in the admin panel?** — For the HTTP-booked appointment, **yes**
   (same collection the panel reads). For a voice-booked one, after step B.
9. **Inbound/outbound status** — inbound still disabled/unlinked for Wellness
   (enable after deploy; it needs the stable URL); outbound reminders built and
   OFF by safety switch.
10. **Test results** — 604 checks green + live HTTP verification (above).
11. **Remaining provider-side action** — exactly two, below.

## Acceptance criteria (§12)

| | Criterion | Status |
|---|---|---|
| A | Deployed at a stable public HTTPS address | **Blocked** — no host account/CLI here; `render.yaml` ready |
| B | Maya's Sarvam app has the tool definitions | **Blocked** — no dashboard access; `sarvam-maya-tools.json` ready |
| C | Sarvam can invoke the production tool endpoint | Follows A+B; endpoint proven over HTTP |
| D | Maya checks genuine availability on a call | Follows A+B; availability proven over HTTP |
| E | Maya books on a call | Follows A+B; booking proven over HTTP |
| F | Appointment persists in the DB | **Met** (verified live) |
| G | Appointment appears in the admin panel | **Met** for HTTP booking; voice after B |
| H | Reschedule & cancel work | **Met** (tools verified; tested) |
| I | Call history + transcripts/recordings persist | Call history + recording endpoint present; inbound capture needs §D enable |
| J | TenWeb/Priya unaffected | **Met** (regression suites pass; isolation tested) |
| K | No secrets exposed | **Met** (token header-based, never logged/committed; `.dockerignore` excludes env/data) |

## The two remaining actions (need your accounts) — see `docs/sarvam-maya-setup.md`

1. **Deploy** the repo to a persistent host (Render blueprint is one click once
   the repo is on GitHub), set the env vars and `WEBHOOK_BASE_URL`.
2. **Register the nine tools** from `docs/sarvam-maya-tools.json` in Maya's
   Sarvam app, add the prompt lines from the runbook, publish the version, and
   enable inbound for Wellness.

Then one controlled test call, confirmed by an `AGENT_TOOL_RECV`/`AGENT_TOOL_DONE`
log line, closes the loop. I cannot perform steps 1–2 from here without your
host and Sarvam credentials, and I will not claim they are done when they are
not — but everything they depend on is finished and verified.

## Files changed
- `src/lib/security/webhook-auth.ts` — `Authorization: Bearer` / `X-Webhook-Token`
  header auth (additive; `?k=` still works).
- `src/lib/hospital/agent-tools.ts` — explicit availability envelope, diagnostics,
  recent-errors buffer.
- `src/app/api/hospital/agent-tools/route.ts` — correlation ids, structured logs,
  `GET` diagnostics.
- `Dockerfile`, `.dockerignore`, `render.yaml` — persistent-host deployment.
- `docs/sarvam-maya-tools.json`, `docs/sarvam-maya-setup.md` — provider config + runbook.
- `tests/test-hospital-agent-tools.mts` — header-auth + diagnostics tests.
