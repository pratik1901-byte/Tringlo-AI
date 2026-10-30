# Workspace creation — Voice Provider step, rebuilt

Report for whoever maintains Tringlo's onboarding. Written after the change; the
survey of what the step looked like beforehand is in [wizard-inspection.md](./wizard-inspection.md).

The step now has three sections, each matching one thing the product does, and
each able to read the matching example straight from Sarvam's documentation.

---

## 1. Files changed

| File | What it is |
| --- | --- |
| `src/lib/providers/sarvam/snippet-import.ts` (new, 400 lines) | Reads a pasted Sarvam example and returns fields, problems and warnings. The security boundary. |
| `src/components/auth/snippet-import.tsx` (new, 140 lines) | The collapsible paste area and the status wording shown beside each section. |
| `src/components/auth/create-workspace-form.tsx` (710 lines) | Step 3 rebuilt into sections A, B and C, with five paste areas and per-section status. |
| `src/lib/providers/types.ts` | New `BatchProviderConfig`; `WorkspaceProviderConfig` gained `batch`. |
| `src/lib/providers/config.ts` | New `batchProblems()` and `resolveBatch()`; batch is saved and reported in `publicProviderConfig`. |
| `src/lib/campaigns/service.ts` | `campaignConfig()` now reads the workspace's batch settings, falling back to its single-call ones. |
| `src/app/api/auth/bootstrap/route.ts` | Validates the batch settings too, before anything is written. |

## 2. Fields the step now collects

**A — Single outbound** (required): agent ID, agent version, telephony
connection ID, the number calls are placed from, optional agent name and
variables. Unchanged in meaning; it is now labelled as the one-call-at-a-time path.

**B — Batch outbound** (required): "use the same agent and number as single
calls", on by default. Turning it off exposes the campaign's own agent ID,
version, connection ID and a comma-separated pool of numbers. Always asked:
calls per second, maximum retries, retry interval, retry on busy, retry on no
answer, calling hours, timezone, and the days campaigns may call on.

**C — Inbound** (optional, off): a labelled switch, off when the step opens.
Switching it on asks for the inbound agent ID and version, connection ID, the
number people will call, the existing deployment ID if there is one, answering
hours, timezone and days. The line itself stays off until it is switched on in
Settings — creating a workspace never answers a call.

## 3. What a pasted example does, and does not do

Each section has a paste area holding the matching cURL example from Sarvam's
docs: Instant Outbound, Create Campaign, Upload Cohort, Pause/Resume, and —
only once inbound is switched on — Create Deployment.

Reading an example is pure text work:

- The snippet is **parsed, never executed**. No shell runs, no request is sent,
  and the snippet is not stored anywhere.
- Only `apps.sarvam.ai` is accepted, and only on the path belonging to that kind
  of example. A different host is refused by name; a campaign URL pasted into
  the outbound box is refused as the wrong endpoint.
- The body is read with `JSON.parse` alone.
- A pasted `X-API-Key` is dropped and the administrator is told it was ignored.
  Tringlo's key lives in the platform environment and is never per workspace.
- Documentation placeholders (`<your-app-id>`, `app_id`, `"string"`,
  `+91XXXXXXXXXX`) are rejected rather than saved as real identifiers.
- Per-call and per-campaign details in the example — the customer's number,
  agent variables, the campaign's name and dates, the example's campaign ID, its
  webhook URL — are deliberately **not** kept. Those belong to a call or a
  campaign, not to a workspace, and the warnings say so.
- Recognised values land in the visible form fields, with a count ("Filled in 4
  fields — check them above"), so they are reviewed before anything is saved.
- A refused paste leaves fields already filled in untouched.

Each section carries its state in words, not only colour: **Incomplete**,
**Configured**, **Needs attention**, **Off**, or **Using single-call settings**.

## 4. What is stored, and what reads it

Saved per workspace in `providerConfigs`: the single-outbound block as before,
and now a `batch` block (agent, version, type, connection, number pool, calls
per second, cohort mode, retry rules, schedule). The inbound block and
`inboundSettings` are written with `enabled: false`.

Never per workspace: the Sarvam API key, organisation and workspace IDs. Those
stay in the platform environment. The webhook token is generated server-side per
workspace and never sent to the browser.

- Single calls read `resolveOutbound(tenantId)`.
- Campaigns read `resolveBatch(tenantId)`. A workspace with no batch block falls
  back to its single-call settings and is reported as `inherited`, which is how
  the existing AvinyeaConnect workspace keeps working untouched.
- Inbound reads `resolveInbound(tenantId)` and stays off until switched on.

Nothing is created before the final button: the step says so, and
`bootstrap/route.ts` validates the account, company, outbound, batch and inbound
input before the first write, rolling the workspace back with `deleteTenant()`
if a later step fails.

## 5. Tests, and what they actually reported

Automated, all with a scratch database and a mocked `fetch` that throws if
anything reaches the network. No real call was placed and no live Sarvam
deployment was touched.

| Suite | Result |
| --- | --- |
| Snippet reading and batch configuration (new) | **49/49** |
| Inbound | **87/87** |
| Campaign sync | **28/28** |
| Multi-workspace isolation | **69/69** |
| On-start hook | **20/20** |
| Workspace deletion | **17/17** |
| Browser walk of step 3 (new) | **36/36**, no page errors |

The new suite covers: a valid example of each of the five kinds; invalid and
incomplete examples of each; a wrong Sarvam endpoint; a non-Sarvam host; an
empty paste; unreadable JSON; documentation placeholders; a pasted API key; a
shell-looking value proving nothing is executed; inbound off and on; batch
settings refused as incomplete; one workspace's campaigns never reaching
another's agent; the legacy workspace still resolving through the inherited
fallback; and no secret appearing in what the browser is given.

The browser walk drives the real page: it opens the wizard, confirms it says
nothing is created yet, checks all three sections and their status wording,
counts four paste areas with inbound off and five with it on, pastes a valid
example and reads the filled-in fields back, confirms the pasted key reached no
field, confirms a non-Sarvam URL is refused in words while good values survive,
confirms placeholders are never written in, and confirms neither the API key,
the Sarvam workspace ID nor a webhook token appears in the page. It stops before
"Create workspace", so the live database is untouched — still one workspace, 21
call records, 9 leads, verified after the run.

`eslint` is clean and `next build` compiles.

## 6. Limitations worth knowing

- **Cohort upload is refused on purpose.** The transformation format is
  confirmed for deployments but not for campaigns, so choosing upload is
  rejected with "not confirmed against Sarvam yet. Use streaming, which is the
  tested path." Streaming is the tested route.
- **There is no connection test in the wizard.** The values are checked for
  shape, not against Sarvam. Settings already has a test action
  (`/api/integrations/provider/test`); the wizard would need the same call added
  before the workspace exists.
- **Sarvam has no agent-configuration API.** The on-start hook that gives an
  inbound agent its greeting and memory is still set by hand in the Sarvam
  dashboard; `scripts/print-inbound-hook.mjs` prints the URL to paste. The
  wizard cannot do this step.
- **The paste areas only read the examples Sarvam publishes today.** A changed
  endpoint path or payload shape would be refused rather than
  mis-read — intentional, but it means the parser follows Sarvam's docs.
- **One-process assumption.** The JSON database is cached per process, so a
  second server writing the same file will clobber it. This bit during this
  task: suites run from the project root fought the dev server. They must run
  from their own directory.
