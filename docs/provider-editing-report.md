# Editing a workspace's voice provider configuration after creation

Report for whoever maintains Tringlo's onboarding and Settings.

The importer from workspace creation is now the importer in Settings. There is
one of it. A workspace never has to be deleted or recreated because a Sarvam
agent, version, connection, number or deployment changed.

---

## 1. Files changed

| File | What happened |
| --- | --- |
| `src/lib/providers/draft.ts` (new, 261 lines) | The draft, extracted: its shape, `emptyDraft`, `draftFromSaved`, `draftProblems`, `draftToPayload`, `draftStatus`, `DAYS`, the shared input class. No JSX, so both screens and the tests share exactly these rules. |
| `src/components/providers/voice-provider-editor.tsx` (new, 585 lines) | The three sections, the six import areas and the import summary. Rendered by both screens. |
| `src/components/settings/voice-provider-editor-panel.tsx` (new, 297 lines) | The Settings wrapper: loads the saved configuration, then Save changes / Validate configuration / Test connection / Cancel. |
| `src/components/auth/create-workspace-form.tsx` | Step 3's 327 lines of markup replaced by `<VoiceProviderSections …/>`; its validation and payload now come from `draftProblems` and `draftToPayload`. The file shrank from 710 to 281 lines. |
| `src/components/settings/voice-provider-card.tsx` | Gained the prominent **Edit Voice Provider Configuration** button; the editor replaces the card while open, so there is never a lesser form beside it. |
| `src/components/auth/snippet-import.tsx` | New `onResult` callback, giving the form the whole parse — including a refusal, which carries no fields. |
| `src/lib/providers/sarvam/snippet-import.ts` | New `deployment_response` kind; endpoint checking made optional for responses; a defect fixed (below); the cohort warning made accurate. |
| `src/app/api/integrations/provider/route.ts` | `PUT` now accepts the `batch` block. Only sections actually sent are touched. |
| `tests/test-provider-editing.mts` (new, 416 lines) | 103 checks over the whole of this. |

## 2. What creation and Settings share

Everything except the surrounding buttons:

- the **parser** — `parseSarvamSnippet`, one function, six kinds, no second implementation;
- the **draft and its rules** — `draft.ts`, so "what counts as complete" cannot drift between the two screens;
- the **form** — `VoiceProviderSections`, the same markup, labels, import areas and status chips;
- the **status vocabulary** — `StatusChip`, with the wizard saying *Ready to save* and Settings saying *Saved*, because that is the honest difference.

The only difference is the starting point: creation starts from `emptyDraft()`,
Settings from `draftFromSaved(…)`.

## 3. Import areas available after creation

All six, in Settings, under **Edit Voice Provider Configuration** — confirmed in
the browser against the real page:

1. Import Sarvam Instant Outbound API Example
2. Import Sarvam Create Campaign API Example
3. Import Sarvam Upload Cohort API Example
4. Import Sarvam Pause / Resume API Example
5. Import Sarvam Inbound Deployment API Example *(appears when inbound is on)*
6. Import Sarvam Deployment Response *(appears when inbound is on)*

## 4. What each format yields

**From a request example**

| Example | Fields read |
| --- | --- |
| Instant Outbound | agent ID, agent version, connection ID, caller number, app type |
| Create Campaign | batch agent ID and version, app type, calls per second, connection ID, the whole number pool, max retries, retry interval, retry-on busy / no answer / failed / short duration with its threshold, allowed hours, allowed days, timezone |
| Upload Cohort | the endpoint and mode only — nothing persisted |
| Pause / Resume | the endpoint and action only — nothing persisted |
| Inbound Deployment | inbound agent ID and version, connection ID, inbound number, answering hours, allowed days, timezone |

**Only from a response**

`deployment_id`. It is minted by Sarvam, so it is in the response and in no
request — which is exactly why area 6 exists. The response also yields the
agent, version, connection, number and hours when it states them, so one paste
can carry the whole picture.

**Deliberately never stored:** the pasted API key, the customer's phone number,
per-call agent variables, the example's webhook URL and token, the example's
campaign ID, and a campaign's name or dates. Each is per call or per campaign,
not a property of the workspace, and the import says so.

**Still manual:** a Sarvam agent's *declared variable names*. Sarvam publishes no
API to read them, so if you change agent or version, check in the Sarvam
dashboard that the agent still declares the variables Tringlo sends
(`customer_name` and the company fields). The editor cannot verify that, and
does not pretend to.

## 5. Partial and invalid pastes

**Partial merges, field by field.** An example containing only the agent ID
fills in the agent and leaves the stored connection ID and caller number alone.
Tested directly: after importing an agent-only example over a saved
configuration, the connection stayed `conn-new` and the number `+918000000099`.

**Invalid changes nothing.** A refused paste returns zero fields, so there is
nothing to write — the form keeps what it had and shows the reason. Checked with
an empty box, a non-Sarvam host, the wrong Sarvam endpoint, malformed JSON and
documentation placeholders; the saved row was byte-for-byte identical
afterwards.

**Each import reports itself**, rather than silently moving fields: *Filled in*,
*Kept as it was*, *Still to set by hand*, plus any problems and warnings.

**A defect this work found and fixed.** The placeholder guard did not catch a
masked phone number, so an example containing a valid agent but
`"agent_phone_number": "+91XXXXXXXXXX"` could have written that mask into the
form as a caller number. It is now rejected. The first fix was too broad — it
also rejected real numbers containing runs of zeros, which the suite caught
immediately — so the rule is narrow: a run of four or more `X` or `*`, or the
textbook `1234567890`.

## 6. Saving and verification

Saving goes to two authenticated endpoints, both scoped to the signed-in
workspace:

- `PUT /api/integrations/provider` — the agent, version, connection, number, and
  the batch block. Only the sections sent are touched.
- `PUT /api/inbound/settings` — the inbound number, deployment ID, handoff
  number, hours, days and timezone.

Nothing in the request body chooses the workspace. A session for workspace B
that names A in its body edits B, which is tested.

**Saving never touches a live deployment.** It writes settings. Making a line
follow them is a separate press on the inbound card, and pointing at a new
deployment marks it unchecked rather than activating it. No agent prompt is
changed and no version published.

**Verification lapses on change.** `verifiedAt` only counts while it is newer
than `updatedAt`, so editing anything relevant drops the status from *Provider
verified* back to *Saved*. Only the Test connection call, which really reaches
Sarvam and reads, can set it — and it places no call. An import parsing
successfully never marks anything verified.

**Isolation preserved.** An inbound number or deployment already claimed by
another workspace is refused by name, by the existing validator — reused, not
reimplemented. Per-workspace webhook tokens are untouched.

**History is preserved.** Campaign rows keep the agent and version they ran on,
their Sarvam campaign and cohort IDs and their membership; leads, calls,
recordings, transcripts, memory, follow-ups and webhook history are not
rewritten. Changing workspace defaults affects future calls and future
campaigns, which is tested against a stored campaign.

## 7. Tests and results

Isolated temporary databases, mocked provider requests.

| Suite | Result |
| --- | --- |
| `test-provider-editing` (new) | **103/103** |
| `test-snippet-import` | 59/59 |
| `test-batch-campaign` | 71/71 |
| `test-multitenant` | 69/69 |
| `test-hook` | 20/20 |
| `test-workspace` | 17/17 |
| inbound (scratch) | 87/87 |
| campaign-sync (scratch) | 28/28 |
| Wizard in the browser | 39/39 |
| Settings editor in the browser | **29/29** |

`tsc --noEmit` clean, `eslint src tests` clean (two pre-existing warnings),
`next build` compiles.

All nineteen listed items are covered. Against the numbering: (1, 2) the editor
opens on the saved values and writes nothing by opening; (3, 4, 5, 7) each
example populates its fields; (6) CSV upload stays unavailable and is still
refused at save; (8) a deployment request populates agent, connection, number
and hours; (9) a response yields the real deployment ID; (10) a request without
one invents none, and a response listing several refuses to guess; (11) partial
imports preserve stored values; (12) invalid imports overwrite nothing; (13, 14)
changes save to the right workspace and B naming A in its body still edits B;
(15) no key or token in either payload; (16) verification lapses after a change;
(17) creation still works, from an empty draft; (18) the long-standing
workspace's configuration behaves exactly as before; (19) no live call or
deployment change.

The Settings walk ran against **a copy** of the live database on a separate
port, with a throwaway session, and pressed Cancel rather than Save — the live
row's `updatedAt` was unchanged afterwards.

## 8. No live calls, no deployment changes

No real phone call was placed. No Sarvam deployment, campaign, agent or
connection was created, replaced, activated or stopped. In the editing suite
every request to Sarvam was a `GET`, and that single read is the inbound card
refreshing a deployment's status when the settings are loaded.

**One thing to know about the live database.** A second workspace,
"Avinyeaconnect1", appeared in it at 16:52 today, with your second email address
and the real agent `2nd-workspa-4613bf8b-a9ba`. That was not created by this
work or by any test — my browser walks use "Walkthrough Pvt Ltd" with
`walk-test@example.com` and never press Create workspace. It looks like you
created it through the wizard yourself while this was in progress; it is
incidental confirmation that the rebuilt step 3 saves a batch block correctly. No
test fixture of any kind is present in the live data, and the throwaway QA
session exists only in the copy.
