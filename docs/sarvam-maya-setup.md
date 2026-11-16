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

In the Sarvam dashboard, open app `Amrita---We-4517816a-a47a`, add the eleven
tools from **`docs/sarvam-maya-tools.json`** to the agent version used on calls
(version 5, for outbound, campaigns and inbound alike), each calling:

`POST {WEBHOOK_BASE_URL}/api/hospital/agent-tools`
with header `Authorization: Bearer {WELLNESS_WEBHOOK_TOKEN}` and body
`{ "tool": "<name>", "args": { … } }`. (If the tool editor cannot send a
header, use `?k={WELLNESS_WEBHOOK_TOKEN}` on the URL instead.)

The workspace token is the Wellness `webhookToken` — find it in the hospital AI
Agent page, or in `providerConfigs` for tenant `tenant_1792938564756_qe17wn`.
Keep it out of source control.

Then **publish** version 5 of the app with the tools on it. Tringlo's Wellness
workspace must point every agent (outbound, campaign, inbound) at version 5,
and declare the same 36 agent variables the version-5 app declares. Tringlo sends
only the 15 it has values for; the rest are Maya's own output variables.

## C. Maya's system prompt and variables (Sarvam)

Use **[`docs/sarvam-maya-prompt.md`](sarvam-maya-prompt.md)**: the variables to declare
(input and output, with exact names and enum values), the full prompt, and the
validation table. It replaces the shorter instruction block that used to be
here, which predated patient verification.

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
