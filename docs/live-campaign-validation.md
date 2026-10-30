# Validating the live test campaign and the CSV-to-cohort path

Read-only validation performed before creating a second workspace. Nothing was
created, changed, dialled, started, resumed or cancelled.

---

## A. What the provider actually confirms about `Test-2456ea7e-b4c0`

All findings are from `GET` requests to Sarvam with the shared platform key.

### The campaign

| | Sarvam says |
| --- | --- |
| status | **`ended`** |
| ran | `2026-09-30T14:59:00Z` → `2026-10-01T14:49:00Z` |
| agent | `Conversatio-834500dd-d3c1`, version **4**, type `agent` |
| connection / number | `8800e72c-9c-8f9c2a3f-4876` / `+918064269194` |
| attempts per second | 1 |
| retries | `max_retries: 3`, intervals `[30, 30, 30]`, on busy ✓, no answer ✓, short duration ✓ (25s), failed ✗ |
| allowed schedule | 10:00–19:00 Asia/Kolkata, Mon–Fri |
| `stats.total_users` | **3** |

Every one of those matches what Tringlo recorded for the run.

### The cohort

`batch-1-a8a0768b-d210` — status **`completed`**, result **3 total, 3 valid, 0
rejected**. One cohort on the campaign, created 14:50:34, finished 14:50:35.

Sarvam labels its `source_type` as `file_upload` even though Tringlo streamed it;
that enum only has `pre_signed_url` and `file_upload`, so it says nothing about
which endpoint was used.

### Were calls actually placed? Yes — 7 attempts across 3 contacts

Acceptance did not mean success, so this was checked against the analytics
attempts endpoint rather than inferred:

| contact | status | duration | retry | ended by | next action |
| --- | --- | --- | --- | --- | --- |
| +917676311132 | failed | 0s | 1 | — | unknown |
| +917259849576 | connected | 22.8s | 1 | agent | short_duration_retry |
| +919480443234 | connected | 8.8s | 1 | user | short_duration_retry |
| +919480443234 | connected | 15.2s | 2 | user | short_duration_retry |
| +917259849576 | connected | 46.9s | 2 | agent | unknown |
| +919480443234 | busy | 0s | 3 | — | retry |
| +919480443234 | failed | 0s | 4 | — | unknown |

**Totals: 4 connected, 2 failed, 1 busy, 0 unanswered.** All three submitted
contacts were attempted. `failure_reason` was `NO_FAILURE_REASON` on all seven.

### Pending calls and remaining retries

**None pending, none scheduled, no retries outstanding.** The campaign is
`ended` and its end timestamp passed on 1 October. `+919480443234` reached
`retry_attempt` 4 — the initial call plus all three permitted retries, so its
budget is spent. `+917259849576` finished on a 46.9-second connected call.
Neither remaining attempt carries a pending next action.

### One discrepancy, investigated and explained

Sarvam reports **3** users; Tringlo's campaign record currently lists **2**
members. This is not data loss from a defect.

The pre-delete backup `before-sahana-delete-20261003-000742/database.json` shows
the campaign originally held three members, the third being
`lead_1790779316192_x791ht`, "Sahana", `+917676311132`. On 3 October that lead
was deliberately deleted, and `purgeLeadData` removes a deleted lead from every
campaign's member list along with its call records — by design, since deleting a
lead is meant to erase its data. That also accounts for Tringlo holding 6 call
records for this campaign against Sarvam's 7 attempts: the seventh belonged to
the deleted lead.

The "Sahana" lead in the database today is a different record, created 7 October
from a later inbound call, and is not attached to this campaign.

### One thing worth noting

The ended campaign's webhook URL at Sarvam still carries the **retired global
webhook token** and an expired tunnel hostname. Harmless — the campaign is
ended, so Sarvam will not deliver to it again, and the token no longer
authenticates anything. New campaigns are created with the per-workspace token.

---

## B. Is CSV-to-Stream-Cohort fully implemented?

**Yes for campaigns up to 1,000 leads — which is every campaign run so far.
Above 1,000 leads the submission is correct but Tringlo's record of it is
incomplete.** Point by point:

| # | Requirement | State |
| --- | --- | --- |
| 1 | Validate the CSV | **Yes.** `validateCampaignCsv` finds the phone column, classifies every column against the agent's declared variables, and reports invalid rows, duplicates and empty rows. A sheet with no phone column is refused before any request. |
| 2 | Associate records with the right workspace | **Yes.** `launchCampaign(tenantId, …)`; `upsertLead` matches existing leads only within that workspace via `ownedByTenant`, and new leads are written with `tenantId`. |
| 3 | Create or select the Sarvam campaign | **Yes.** `POST …/campaigns`, and the returned `campaign_id` is stored as `providerCampaignId`. Tringlo's own ID is generated at runtime; it is not in workspace settings. |
| 4 | Map each row to Stream Cohort JSON | **Yes.** `{ user_phone_number, user_identifier, app_variables }` only — the documented fields. Variables are strings; undeclared columns such as `customer_id` are not sent. |
| 5 | Batches of at most 1,000 | **Yes.** Verified with 2,500 leads: three requests of 1,000 / 1,000 / 500, each with its own cohort name. |
| 6 | Track asynchronous processing | **Yes, for one cohort.** `syncCampaign` re-fetches the cohort while its status is neither `completed` nor `failed`. It polls only `providerCohortId`, which holds the last batch. |
| 7 | Persist accepted and rejected counts | **Partly.** Correct up to 1,000. With 2,500 leads the stored result was `{total: 500, valid: 500, rejected: 0}` — the last batch only. |
| 8 | Associate each contact with its lead | **Yes.** Every user carries `user_identifier` = the Tringlo lead ID, every member points at a stored lead, and each lead records the campaign. Confirmed live: attempts came back tagged with both `dialo_campaign_id` and the lead. |
| 9 | Handle errors without losing or duplicating leads | **Yes for calls, partly for records.** A refused campaign is marked failed with Sarvam's words. If a cohort request is refused the launch fails *and the campaign is cancelled*, so a campaign never sits waiting to dial a partial list. Nothing is submitted twice. But when the failure lands on batch 2 of 3, batch 1 is already at Sarvam and the stored result does not reflect that. |
| 10 | Track real call outcomes separately from acceptance | **Yes.** 6 call records for this campaign, each with Sarvam's own attempt ID and retry number; `campaignStats` is computed from real call records, never from cohort acceptance. |

### Exactly what is missing

In `launchCampaign`, the batching loop keeps only the final response:

```ts
for (let offset = 0; offset < users.length; offset += 1000) {
  cohort = await streamCohort(…);   // each pass overwrites the previous
}
```

So for more than 1,000 leads, `providerCohortId` and `cohortResult` describe the
last batch alone, and `syncCampaign` then polls only that cohort. **The leads
themselves are all submitted and all are campaign members, and calls are placed
normally — the gap is in Tringlo's bookkeeping, not in what Sarvam receives.**
Fixing it means collecting every batch's cohort ID and summing the results,
which is a contained change to that loop, the `Campaign` type and the sync.

No CSV transformation schema was invented, and the direct Sarvam CSV-upload
endpoint is not needed: Tringlo parses the CSV itself and submits through Stream
cohort, which Sarvam documents as the API route for exactly this.

---

## C. Workspace configuration

The saved configuration for `tenant_1790143786482_2lzjp2` (AvinyeaConnect):

| Setting | Stored | Matches live Sarvam campaign |
| --- | --- | --- |
| agent ID | `Conversatio-834500dd-d3c1` | ✓ |
| agent version (outbound) | 4 | ✓ |
| connection ID | `8800e72c-9c-8f9c2a3f-4876` | ✓ |
| caller number | `+918064269194` | ✓ |
| inbound agent | same agent, version 11 | — (separate deployment) |
| webhook token | per-workspace format, 51 chars | not printed anywhere |
| `verifiedAt` | never checked | — |

**`batch` is `null` for this workspace.** It predates per-workspace campaign
settings, so it uses the inherited fallback: campaigns run on its single-call
agent, version, connection and number, and the **retry configuration and
calling schedule are entered per launch rather than stored**. That is why the
live campaign's retries and hours match the launch form rather than a saved
profile. Status reports this as `inherited`, not `configured`.

A workspace created through the new wizard stores all six: agent ID, version,
connection, number pool, retry rules and calling schedule. So the intended
behaviour is in place for new workspaces, and the existing one keeps working
exactly as it did.

Still one Sarvam organisation, one Sarvam workspace, one shared platform API
key. No second workspace or key was introduced.

---

## D. Tests and results

Read-only live probes (GET only): campaign, cohort, cohort list, analytics
attempts, interactions.

Automated, all with a temporary database and mocked `fetch`:

| Suite | Result |
| --- | --- |
| Batch-size probe (new, scratch) | **15/17** — the two failures are the >1,000-lead recording defect above, deliberately asserted |
| `test-batch-campaign` | 71/71 |
| `test-snippet-import` | 59/59 |
| `test-multitenant` | 69/69 |
| `test-hook` | 20/20 |
| `test-workspace` | 17/17 |

No source file was changed in this round.

**A caveat on the isolation guard:** it warned that `data/database.json` changed
while the batch-size probe ran. The warning is literally true but the cause was
the development server's own minute-by-minute sync, not the suite — confirmed by
comparing against the snapshots: only `updatedAt`, `lastResultsSyncAt` and the
tunnel hostname moved, with no business record altered and no test fixture
present. The guard cannot tell the difference, so it errs loudly; that is the
right way round, but it will cry wolf whenever the dev server is running.

---

## E. Remaining limitations

1. **Above 1,000 leads, accepted/rejected counts and cohort IDs under-report.**
   Submission and calling are correct; the record is not. Worth fixing before
   anyone runs a campaign that large.
2. **CSV upload to Sarvam is still unavailable** — `cohort_transformation_file`
   has no published schema. Not needed for the product requirement.
3. **No agent-configuration API at Sarvam**, so the inbound on-start hook stays
   a manual dashboard step.
4. **`verifiedAt` is unset on the live workspace** — Test connection has not
   been run since the field was added, so status reads `saved`, not `verified`.
5. **The existing workspace has no stored batch profile** (point C), so its
   retries and hours are chosen per launch.
6. **One process per database file.** Unchanged.

---

## F. Is it safe to create BrightPath Logistics?

**Yes.** Nothing found here blocks it:

- Workspace isolation is verified in both directions: separate agents,
  connections, numbers and webhook tokens, with one workspace unable to list or
  fetch the other's campaigns or leads.
- The existing workspace keeps working through the inherited fallback, and
  creating another cannot alter it — a new workspace writes its own rows only.
- The live campaign is `ended` with no outstanding retries, so no new workspace
  can disturb anything in flight.
- The one real defect found is confined to campaigns over 1,000 leads and
  affects bookkeeping, not call placement or isolation.

Two suggestions, neither a blocker: run **Test connection** on the existing
workspace once so its status reflects a real provider check, and fix the
multi-batch recording before any campaign over 1,000 leads is launched.
