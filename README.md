# Tringlo AI

Outbound sales calling on Sarvam Voice Agents. A call is placed through Sarvam
Instant Outbound over Vobiz telephony; the agent runs the conversation; Sarvam
posts the result back to Tringlo, which stores it and renders it.

## The one rule

**Tringlo never invents call data.** Status, duration, transcript, summary,
interest, confidence and follow-ups exist only if Sarvam reported them. Anything
else renders as an em dash. There is no simulation mode, and no timer anywhere
advances a call's state.

This matters in a specific way: Sarvam's instant-outbound webhook reports the
*outcome* of an attempt. It does not publish ring or answer events. So the live
call UI shows "Placing call" and then "Waiting for provider", and only ever says
Connected / No answer / Busy / Failed once the webhook says so.

## The pipeline

```
Call Now
  → POST /api/calls/start          creates the call record, status "calling"
  → Sarvam Instant Outbound        returns attempt_id
  → Vobiz                          the real phone call
  → POST /api/webhooks/sarvam/outbound
  → lib/calls/service.ts           correlates by attempt_id, writes the result
  → data/database.json
  → the UI reads the database
```

`attempt_id` is the only correlation key. Tringlo also echoes its own `callId` and
`lead_id` through `webhook_config.metadata`, which Sarvam returns verbatim.

## Setup

Copy `.env.example` to `.env.local` and fill it in. Then:

```bash
npm install
npm run dev
```

### APP_URL is not optional

Sarvam delivers every call result to `APP_URL`. If it is unset, points at
localhost, or points at a tunnel that has since died, **the call is still placed
but the result never arrives** — you get a real phone call with no transcript,
no outcome and no follow-up. This has already cost this project twelve calls.

For local development, run a tunnel and set `APP_URL` to its public https URL:

```bash
cloudflared tunnel --url http://localhost:3000
# or: ngrok http 3000
```

**Tringlo now refuses to dial when the webhook URL is unreachable.** Before every
call it fetches its own health probe through `APP_URL`; if nothing answers, the
call is refused with HTTP 503 and an explanation, and no phone rings. Override
with `ALLOW_CALLS_WITHOUT_WEBHOOK=true` only if you mean it.

The Settings page reports whether the webhook URL is reachable, and the header
badge reads "Setup required" until it is. A call that was placed before this
guard existed and never got a result is shown as "No result received" after
fifteen minutes, rather than waiting forever.

### Agent variables

Sarvam rejects the entire request if it receives an agent variable the app has
not declared:

```
422 Invalid Parameter — Agent variables '{'approved_knowledge'}' not found in
agent variables of app '...'
```

`src/lib/providers/sarvam/variables.ts` therefore sends only names on a known-good
list and drops the rest with a warning. To pass a new variable, declare it in the
Sarvam app first, then add it to `SARVAM_AGENT_VARIABLES`.

Output variables (`call_summary`, `interest_level`, `do_not_call`, …) are never
sent outbound. Seeding one would make a pre-filled value indistinguishable from a
real result on the way back.

## Do not call

`do_not_call` from a call, or the action on the Leads page, suppresses the lead
through a single path in `lib/db`: it marks the lead, records the reason, and
cancels its pending callbacks. `/api/calls/start` refuses a suppressed lead with
HTTP 403 before contacting Sarvam. Do-not-call overrides a callback the agent
recorded on the same call.

## Follow-ups

A callback is created only when the agent asked for one. The time comes from
`follow_up_date` + `follow_up_time`, or from `next_step_date_time`. **If neither
parses, the follow-up is still created with no time and flagged "needs a time"** —
losing a real customer request would be worse, and inventing a time would be
dishonest.

## Where things live

| Path | Responsibility |
| --- | --- |
| `lib/providers/sarvam/webhooks.ts` | Parsing. Pure, and the only place a provider field becomes a Tringlo field. |
| `lib/calls/service.ts` | The reducer. Correlation, idempotency, suppression, follow-up creation. |
| `lib/db/` | Persistence and the webhook idempotency ledger. |
| `lib/metrics.ts` | Every number the dashboard and analytics show. |
| `lib/format.ts` | Display rules, including what "no data" looks like. |
| `lib/animation.ts` | GSAP primitives, all honouring `prefers-reduced-motion`. |

Leads, call records and follow-ups have **no** client-side store. They are read
through `lib/use-tringlo-data.ts` on every screen, so the browser cannot show a
result the database does not have.

## Storage

`data/database.json`, written through a temp file and rename. Fine for a single
instance; move to a real database before running more than one.
