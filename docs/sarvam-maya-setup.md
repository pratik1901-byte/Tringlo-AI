# Make Maya book on live calls — operator runbook

This is the short list of actions that require your Vercel/Render and Sarvam
dashboard accounts. The repository, security, and provider-config work is done;
these steps cannot be performed from the build environment because it has no
hosting CLI, no host token, no git remote, and no Sarvam dashboard access — only
the Sarvam API key, which cannot author an app's tools (the authoring API is not
exposed). Each step below is mechanical.

## A. Deploy to a stable public host (persistent, not serverless)

The app uses a JSON file database (`data/database.json`), an in-process
scheduler, and writes recordings/files to disk — so it needs a **single
always-on container with a persistent disk**, not Vercel serverless (which is
ephemeral and multi-instance and would reset the database). Artifacts are in the
repo: `Dockerfile`, `.dockerignore`, `render.yaml`.

Render (one click with the blueprint):
1. Push this repo to GitHub and connect it in Render → New → Blueprint; it reads
   `render.yaml` (web service, 1 instance, 1 GB disk at `/app/data`).
2. Set the env vars marked `sync: false` in the Render dashboard (copy from your
   `.env.local`), and set **`WEBHOOK_BASE_URL`** to the service's own https URL
   (e.g. `https://tringlo.onrender.com`). Never commit secrets.
3. Deploy. Health check is `GET /api/webhooks/sarvam/outbound` → `{ready:true}`.

(Railway/Fly/a VPS work identically with the `Dockerfile`; the only hard
requirement is a persistent disk at `/app/data` and a single instance.)

Any host with a stable https URL and a persistent disk is fine; the rest of this
runbook only needs that URL and the workspace token.

## B. Register Maya's tools in Sarvam

In the Sarvam dashboard, open app `Amrita---We-4517816a-a47a`, add the nine
tools from **`docs/sarvam-maya-tools.json`** to the agent versions used on calls
(outbound v3, inbound), each calling:

`POST {WEBHOOK_BASE_URL}/api/hospital/agent-tools`
with header `Authorization: Bearer {WELLNESS_WEBHOOK_TOKEN}` and body
`{ "tool": "<name>", "args": { … } }`. (If the tool editor cannot send a
header, use `?k={WELLNESS_WEBHOOK_TOKEN}` on the URL instead.)

The workspace token is the Wellness `webhookToken` — find it in the hospital AI
Agent page, or in `providerConfigs` for tenant `tenant_1792938564756_qe17wn`.
Keep it out of source control.

Then **publish/deploy** the app version that declares the tools (the account
currently shows v1 deployed; v3 is what Tringlo is configured for).

## C. Add these instructions to Maya's system prompt (Sarvam)

Append to Maya's existing inbound prompt (do not replace it):

> You can act on the hospital's real database only through tools. For anything
> about doctors, availability, or a patient's appointments you MUST call a tool
> and use its result — never guess, never read availability from memory.
> - To find a doctor or specialty, call `search_doctors` (or `get_doctors`).
> - To check availability, call `check_doctor_availability` (one date) or
>   `get_available_slots` (a range). Offer only slots the tool returns.
> - To book: collect the patient's name and phone, read the doctor, date and
>   time back, get an explicit "yes", then call `book_appointment`. Confirm the
>   booking and give the reference id ONLY after the tool returns `ok:true`.
> - To reschedule: find the appointment, check the new slot, confirm, then call
>   `reschedule_appointment`.
> - To cancel: find the appointment, get an explicit "yes to cancel", then call
>   `cancel_appointment` with `confirm:true`.
> Before a tool that may take a moment, say one short line like "Certainly, let
> me check that for you," then wait for the result — do not ask if the caller is
> still there while a tool is running. If a tool returns `ok:false`, read its
> `error` and offer an alternative. Never say an appointment is booked, moved or
> cancelled unless the tool confirmed it.

## D. Enable inbound for Wellness

In the Wellness panel → AI Agent / Settings, enable inbound. This registers and
links the Sarvam deployment so inbound calls are attributed to Wellness and
recorded (until linked, inbound calls are dropped — see
`docs/hospital-inbound-agent-report.md`). It uses `WEBHOOK_BASE_URL`, so do this
after deploy, not on the dev tunnel.

## E. Verify (the actual proof)

1. `GET {WEBHOOK_BASE_URL}/api/hospital/agent-tools` with the token →
   `{ ok:true, endpoint:"healthy", dbConnected:true, doctorCount, … }`.
2. Place ONE controlled inbound call from a test number. Ask for a cardiologist,
   then availability, pick a slot, confirm, and book.
3. Confirm in the server logs that `AGENT_TOOL_RECV` / `AGENT_TOOL_DONE` lines
   appear for `check_doctor_availability` and `book_appointment` — that is the
   proof Maya actually invoked the backend during the call.
4. Confirm the appointment appears on the admin Appointments page and the call
   in Call History.

Keep the outbound reminder switch (`remindersEnabled`) OFF until this is done.
