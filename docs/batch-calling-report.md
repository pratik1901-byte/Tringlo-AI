# Batch calling — data check, investigation, and what is actually implemented

Report for whoever maintains Tringlo's campaign and provider integration.

---

## 1. Database integrity

**Finding: no unexpected discrepancy. No business record was lost or altered by
the test run.**

One caveat about the evidence first: the backup named
`database-before-wizard-tests-20261009-203957.json` was taken at 20:39:57, which
was *after* the concurrent writes began, so it is not a clean baseline. The last
genuinely pre-incident snapshot is
`database-before-verification-fixes-20261008-232013.json`. All three snapshots
were compared — pre-incident, post-incident and current — by record ID and by
content hash, not by count.

| Collection | Pre-incident | Post-incident | Current |
| --- | --- | --- | --- |
| tenants / users / workspaceProfiles / providerConfigs | 1 each | 1 each | 1 each |
| callRecords | 21 | 21 | 21 |
| leads | 9 | 9 | 9 |
| customerProfiles | 8 | 8 | 8 |
| memoryItems | 32 | 32 | 32 |
| campaignRuns | 1 | 1 | 1 |
| followUps | 14 | 14 | 14 |
| inboundSettings / notificationSettings | 1 each | 1 each | 1 each |
| rawEvents / webhookReceipts | 21 / 21 | 21 / 21 | 21 / 21 |

Every ID present before is present now. Call records, leads, customer profiles,
customer memory and follow-ups are **byte-identical** across all three.

The only differences, each explained:

- **rawEvents and webhookReceipts** — all 21 of each gained `tenantId`. This is
  the previously approved webhook-log backfill, and the counts match what that
  task reported (21 + 21 stamped, 0 unmapped).
- **campaignRuns** — only `updatedAt` / `lastResultsSyncAt`, and a
  `lastResultsSyncError` of "fetch failed". The running development server
  polling Sarvam through a dead tunnel.
- **inboundSettings** — `webhookUrl` changing between `trycloudflare.com`
  hostnames, plus sync timestamps. A new tunnel on each dev-server restart.
- **notificationSettings** — the daily-summary date rolling from Oct 8 to Oct 9.

A search for every test fixture string used by the suites (`ws_a`, `ws_b`,
`ws_brightpath`, `BrightPath`, `Agent-A`, `Agent-B`, `platform-key`,
`walk-test@example.com`, `Conversatio-walk`, `tenant_a`, `dep-1` and others)
found **none** in any of the three snapshots. Nothing was restored or
overwritten; the comparison was read-only.

### Making the mistake impossible

The cause was structural: the database layer resolves its file from
`process.cwd()`, so a suite run from the project root writes to the live file.
`tests/isolated-db.ts` now removes the choice. Every suite calls
`isolateDatabase()` before its first import; it moves the process into a fresh
`mkdtemp` directory, says so when it was launched from the project root, and
registers an exit check that shouts if the real file's timestamp moved anyway.

Verified by deliberately running a suite from the project root with the dev
server up: it redirected, passed 17/17, and the live file's mtime did not change.

---

## 2. What the batch-calling flow actually is

The seven questions, answered from the code and from a campaign that has really
run.

**1. What is the "streaming" path?** `POST .../campaigns/{campaign_id}/cohorts/stream` —
Sarvam's **Stream cohort** endpoint. Sarvam's own documentation presents it as
the API route for submitting contacts, "ideal for CRM integration and
automation", in contrast to the CSV upload used by their dashboard. It takes
`{ name, users[] }`, 1–1000 users per request.

**2. How does it receive multiple leads?** An authorised user uploads a CSV to
*Tringlo*. `validateCampaignCsv` finds the phone column, validates and
de-duplicates rows, and reports invalid ones. Each valid row becomes a Tringlo
lead, gains its memory-derived agent variables, and becomes one
`CohortUserRecord`. `launchCampaign` posts them in batches of 1000.

**3. Does it create a real Sarvam campaign?** Yes — `POST .../campaigns`, and
the returned `campaign_id` is stored as `providerCampaignId`.

**4. Does it associate the leads with that campaign?** Yes, two ways: the stream
request is addressed to that `campaign_id`, and every user carries
`user_identifier` = the Tringlo lead ID, so webhook results map back to the lead.

**5. Can it execute the whole batch workflow?** Yes, and it has. The live
workspace holds a campaign that ran entirely through this path:

```
providerCampaignId  "Test-2456ea7e-b4c0"     ← real, from Sarvam
providerCohortId    "batch-1-a8a0768b-d210"  ← real, from Sarvam
cohortStatus        "completed"
cohortResult        { total: 3, valid: 3, rejected: 0 }
status / provider   "completed" / "ended"
cohortMode          "stream"
```

**6. Does it require cohort upload?** No. It uses the documented alternative.

**7. What remains unavailable?** Only submitting leads to Sarvam **as a CSV
file**. That is a second transport for the same data, not an additional
capability: `user_phone_number`, `user_identifier`, `app_variables` and
`app_overrides` are exactly what streaming already sends. Nothing a user can do
in Tringlo is blocked by it.

### Why upload is still not implemented

`cohort_transformation_file` is required by that endpoint, and its schema is
**not published**. Sarvam's own API reference for Upload cohort describes the
field only as "JSON file defining how CSV columns map to agent variables" and
shows its example as `"<file: string>"`. The cohorts guide, the create-campaign
guide and the variables guide do not give it either. A web search surfaced a
plausible example, but it could not be confirmed on any Sarvam page, so it has
not been used.

**Exactly what is missing:** the JSON schema of `cohort_transformation_file` —
its top-level keys, whether each maps to `{ "column_name": "..." }`, whether
`user_identifier` is supported for campaigns and can be `required`, and whether
`app_overrides` is accepted. Either the published schema, or one worked example
from a Sarvam campaign CSV upload, would be enough to implement it.

---

## 3. Is the lead-submission workflow complete?

**Yes, through the streaming mechanism, and it is demonstrated by tests.** All
three operations the brief lists are implemented, wired to routes, and exercised:

| Operation | Endpoint | Route |
| --- | --- | --- |
| A. Create campaign | `POST .../campaigns` | `POST /api/campaigns` |
| B. Submit the lead set | `POST .../campaigns/{id}/cohorts/stream` | same launch call |
| C. Pause / resume / cancel | `PUT .../campaigns/{id}/status` | `PUT /api/campaigns/[id]/status` |

Campaign IDs are Tringlo's own (`cmp_<timestamp>_<random>`) with Sarvam's
`campaign_id` stored alongside at runtime. A test asserts the provider campaign
ID appears nowhere in workspace settings. Everything else comes from the
selected workspace: agent, version, connection, number pool, rate, retries and
schedule — with its own webhook token on the callback.

**CSV upload to Sarvam remains explicitly incomplete** and is reported as
`unavailable` rather than hidden.

---

## 4. Remaining limitations

- **No CSV upload to Sarvam**, for the reason above. The save path *refuses* to
  store `cohortMode: "upload"`, so an administrator cannot configure a workspace
  into a state that fails at launch. A row holding it (only reachable by editing
  the database by hand) reports `unavailable` and will not launch.
- **No agent-configuration API at Sarvam.** The inbound on-start hook is still
  pasted into the dashboard by hand; `scripts/print-inbound-hook.mjs` prints it.
- **Verification is one check, not a guarantee.** "Provider verified" means the
  Test connection call reached Sarvam and every check passed. It does not prove a
  call will connect, and it never places one.
- **One process per database.** Still a JSON file with a per-process cache. The
  test guard closes the path that bit us; two servers on the same file would
  still conflict.

---

## 5. Files changed

| File | Change |
| --- | --- |
| `tests/isolated-db.ts` (new) | Forces every suite into a temporary database. |
| `tests/test-batch-campaign.mts` (new) | The lead-to-campaign flow, 71 checks. |
| `tests/test-snippet-import.mts` (new) | Snippet parsing and config, 59 checks. |
| `tests/test-{multitenant,hook,workspace}.mts` | Call the isolation guard first. |
| `src/lib/providers/types.ts` | New `ConfigStatus` vocabulary; `verifiedAt` on the workspace config. |
| `src/lib/providers/config.ts` | Status now distinguishes saved / verified / unavailable / inherited; new `leadSubmissionStatus`, `verifiedNow`, `markProviderVerified`. |
| `src/app/api/integrations/provider/test/route.ts` | A check that really reached Sarvam records the verification. |
| `src/components/auth/snippet-import.tsx` | `StatusChip` speaks the full vocabulary. |
| `src/components/auth/create-workspace-form.tsx` | The wizard says "Ready to save", never "Saved"; the cohort hint now states that leads go by Stream cohort. |
| `src/components/settings/voice-provider-card.tsx` | Shows the four real states per workspace. |

No change to campaign creation, cohort streaming, pause/resume, webhook
authentication, the caller-context hook, customer memory, RAG, follow-ups, DND or
analytics. Nothing was added for Postgres, MCP, billing, workspace switching,
invitations or Sarvam provisioning.

---

## 6. Tests and actual results

Every suite runs against a temporary database with `fetch` mocked, and the live
file's timestamp was checked as unchanged after each run.

| Suite | Result |
| --- | --- |
| `test-snippet-import` | **59/59** |
| `test-batch-campaign` | **71/71** |
| `test-multitenant` | **69/69** |
| `test-hook` | **20/20** |
| `test-workspace` | **17/17** |
| inbound (scratch) | **87/87** |
| campaign-sync (scratch) | **28/28** |
| Browser walk of the wizard | **39/39**, no page errors |

`tsc --noEmit` clean, `eslint src tests` clean (two pre-existing warnings),
`next build` compiles.

Against the brief's fourteen items:

1. **Single-outbound import and validation** — valid example parsed; wrong
   endpoint, non-Sarvam host, empty paste, unreadable JSON and placeholder IDs
   all refused.
2. **Create Campaign configuration** — agent, version, rate, connection, number
   pool, retry rules and schedule read; campaign name and dates deliberately not
   stored as workspace settings.
3. **Cohort configuration and transformation** — upload refused at save with its
   reason; a hand-edited upload row reports `unavailable` and cannot launch;
   streaming confirmed as the working path.
4. **Pause / Resume configuration** — valid example parsed, unsupported action
   refused, wrong endpoint refused.
5. **Multi-lead submission** — four leads from one CSV reached Sarvam in one
   stream request carrying only documented fields, string-valued variables, and
   a cohort name inside the 1–50 character rule.
6. **Campaign-to-lead association** — all four are campaign members, each points
   at a stored lead in that workspace, each lead records the campaign, and each
   submitted user carries its Tringlo lead ID.
7. **Workspace-specific selection** — A's request carried A's agent, connection,
   numbers and webhook token; B resolved to entirely different values.
8. **Cross-workspace authorization** — A's campaign is listed for A, invisible to
   B, and `getCampaignRun(B, id)` returns nothing; A's leads never appear for B.
9. **Invalid or incomplete configuration** — an unconfigured workspace cannot
   launch and nothing is sent; a sheet with no phone column is refused before any
   request.
10. **Inbound disabled by default** — off when the step opens, switching it on
    reveals its fields, and saving leaves `enabled: false`.
11. **Legacy configuration preserved** — a workspace with no campaign settings
    still launches on its single-call agent and number, reports `inherited`
    rather than configured, and never borrows another workspace's agent.
12. **Provider errors** — a refused campaign reports Sarvam's words and is
    recorded failed; when leads are rejected the launch fails *and the empty
    campaign is cancelled* so it cannot sit waiting to dial.
13. **A rejected paste changes nothing** — five bad pastes each return zero
    fields with a reason, and in the browser the values already filled in
    survived a refused paste.
14. **No secrets to the client** — the API key, Sarvam org/workspace IDs and the
    webhook token appear in neither the API payload nor the page; the key travels
    in a header, never a URL.

---

## 7. Live provider configuration

**Nothing live was changed.** No Sarvam deployment, campaign, agent or
connection was created, modified or cancelled. The only requests to
`apps.sarvam.ai` were documentation reads over HTTPS. The live
`data/database.json` holds the same single workspace, 21 call records, 9 leads
and 1 campaign as before, with only the dev server's own timestamps and tunnel
URL moving.

## 8. Calls

**No real phone call was placed.** Every Sarvam interaction in the tests is a
mocked `fetch`; two suites assert that a request to any unexpected host fails. The
browser walk stops before "Create workspace". The BrightPath workspace was not
created.
