# Why the agent said "Manan"

Diagnosis and fix for the wrong customer name on outbound calls.

Investigated from the existing record of the latest completed outbound call —
`call_1791567118614_w02new`, 9 October 2026 23:02 IST, in the newer workspace
("Avinyeaconnect1", agent `2nd-workspa-4613bf8b-a9ba`). No call was placed.

---

## 1. Root cause

**"Manan" came from the Sarvam agent's own variable default, not from Tringlo.**

The agent declares a variable `user_name` whose dashboard default is `Manan`.
Tringlo does not send `user_name` — it is not in Tringlo's declared list — so the
default survived the call, and the agent's prompt addressed the customer from
it: *"Thank you for your time, Manan."*

Tringlo sent the right name. From the call's own stored `inputVariables`:

| Variable | Value Tringlo sent | Where it came from |
| --- | --- | --- |
| `customer_name` | **Pratik** | the lead on this call, this workspace |
| `userName` | **Maya** | the *agent's* name — a Tringlo defect, see below |
| `user_name` | **not sent** | never in Tringlo's declared list |

And what came back in `outputVariables`: `customer_name: "Pratik"`,
`userName: "Maya"`, `user_name: "Manan"`.

Every Tringlo-side source of the name was correct and said Pratik:

- lead record: `Pratik`
- customer profile: `names: ["Pratik"]`
- customer memory: **no occurrence of "Manan" in any workspace**
- `previous_interaction` / `priorTouchpointSummary`: not sent on this call
- `lead_notes`: company and product text only, no person's name
- Tringlo's missing-name fallback: an empty string, never a sample name

"Manan" appears nowhere in Tringlo's source, environment or database except in
this one call's transcript and its echoed-back `user_name`.

### A second, real defect in Tringlo

`userName` carried **the agent's name**, not the customer's. In
`context.ts` the agent name fell back to `userName` whenever the app did not
declare `agent_name`, which no app in this account does. So on this call
`userName = "Maya"` while `customer_name = "Pratik"` — two customer-name
aliases disagreeing, exactly the conflict to look for. It did not cause
"Manan", but on any agent whose prompt reads `userName` as the customer it
would have made the agent address the customer by its own name.

### The contrast that proves it

The same code called the older workspace's agent
(`Conversatio-834500dd-d3c1`) correctly, twice:

| | New agent (`2nd-workspa-…`) | Older agent (`Conversatio-834500dd-d3c1`) |
| --- | --- | --- |
| declares `user_name` | yes, default `Manan` | no |
| `userName` default | — | `Ravi Nair` (unused by its prompt) |
| prompt addresses customer from | `user_name` | `customer_name` |
| what it said | "Thank you for your time, **Manan**" | "Am I speaking with **Pratik**?" ✓ |

Both agents carry a demo person's name as a variable default. The older one's
prompt ignores it; the newer one's prompt uses it.

### About the speech recognition

**In this call the person never said "Pratik".** The transcript has no
introduction at all. The nearest turn is `[5] user: "The name."` — almost
certainly a mis-recognised fragment, and the agent answered *"Were you asking
for my name, or did you want to share yours?"*, which went unanswered.

So the failure is not "a stated name was ignored". It is worse and simpler: the
agent used a demo name from its own configuration while Tringlo had supplied the
correct one. The stated-name path is now handled too (section 3), but it was not
what happened here.

---

## 2. The name contract, as now implemented

**One authoritative name.** The lead on this call, in this workspace. It is
written to `customer_name` and to every customer-name alias the app
declares — `userName`, and `user_name` / `customerName` where declared — all
from the same value, so two aliases can no longer disagree.

**Unknown stays unknown.** An empty, "Customer" or "Unknown caller" name is sent
as an **explicit empty value** rather than omitted. This matters: an omitted
variable leaves the agent's default in place, which is how a demo name reaches a
customer. Nothing is ever inferred from the phone number, and no sample name is
ever substituted.

**The agent's name goes only where it means the agent.** It is sent as
`agent_name` when declared, and otherwise not sent at all. An agent already
knows what it is called from its own prompt — the newer one introduced itself as
Maya without Tringlo's help.

**Inbound and outbound stay distinct.** Inbound identity still comes from
`caller_name` and the known-caller list; outbound identity from the lead. Nothing
treats one as the other.

---

## 3. The current conversation now wins

Every outbound call now carries explicit name rules (`NAME_RULES`), because the
agent's prompt lives in Sarvam's dashboard and can read a variable Tringlo does
not set. They say, in substance: the person you are speaking to is
`customer_name`; if it is empty you do not know their name, so do not guess,
read another variable, or infer one from the number; never use a name that came
from an example or a variable's default; if the person tells you their name
during this call, use exactly that from then on and record it in
`stated_customer_name`; if they correct you, apologise in one clause and switch
immediately; never use your own name for the customer; and do not ask twice for
a name already given.

The inbound rules gained the matching line for a caller.

**A stated name is now recorded, with provenance.** When an outbound call comes
back with `stated_customer_name` that differs from what was on file, Tringlo
renames the lead with source `customer` and puts the stated name first on the
workspace's customer profile, keeping the earlier name as history. It is read
from `stated_customer_name` only — never from `customer_name` or `user_name`,
because an agent echoes those back and that is precisely how a default would be
learned as a customer's name. A name equal to the agent's own is refused, as are
placeholders, "NA" and extraction prompts returned in place of a value.

---

## 4. Sarvam agent variables

Of the eleven variables the outbound integration sends, two are customer-name
aliases: `customer_name` and `userName`. They **were** in conflict (`Pratik`
versus `Maya`); they now always hold the same value.

Checked for inappropriate defaults, from what the agents echoed back:

| Agent | Variable | Default observed | State |
| --- | --- | --- | --- |
| `2nd-workspa-4613bf8b-a9ba` | `user_name` | **`Manan`** | **must be corrected in Sarvam** |
| `Conversatio-834500dd-d3c1` | `userName` | `Ravi Nair` | now overwritten by Tringlo on every call |

Sarvam publishes no API for reading or writing an agent's configuration — seven
endpoints were probed in earlier work and all returned 404 — so these defaults
cannot be read or fixed programmatically. The values above are inferred from
what the agent returned, which is the only evidence available.

### Manual change required in Sarvam — not yet done

On agent **`2nd-workspa-4613bf8b-a9ba`** only (do not touch
`Conversatio-834500dd-d3c1`):

1. Open the agent in the Sarvam dashboard → **Variables** tab.
2. Find the input variable **`user_name`**. Clear its default value of
   **`Manan`** so it is empty.
3. Better still, in the agent's prompt replace every use of `user_name` with
   **`customer_name`**, which Tringlo always sends. Then delete `user_name`.
4. Publish a new agent version, and set that version number for the workspace in
   Settings → Voice Provider.

Alternatively, keep `user_name` and let Tringlo fill it: declare it on the agent
and add it to `SARVAM_AGENT_VARIABLES`. One caveat — that environment variable
is a single global list while each workspace has its own agent declaring
different variables, so adding a name there that another agent does not declare
would make Sarvam reject that agent's calls with a 422. The dashboard fix is the
safer route.

**Until step 2 or 3 is done, this issue is not fully fixed.** Tringlo now sends the
correct name on `customer_name` and `userName` and instructs the agent to use
`customer_name` and to ignore names from defaults, which should be enough in
practice — but the `Manan` default still exists in that agent, and only removing
it makes the outcome certain.

---

## 5. Code changes

| File | Change |
| --- | --- |
| `src/lib/providers/sarvam/context.ts` | The agent's name no longer falls back to `userName`; it is sent only as `agent_name`, when declared. |
| `src/lib/providers/sarvam/variables.ts` | New `CUSTOMER_NAME_ALIASES`; one authoritative customer name written to `customer_name` and every declared alias; an unknown name is sent as an explicit empty value instead of being omitted; `stated_customer_name` registered as a conversation output so it can never travel outbound. |
| `src/lib/providers/sarvam/call-rules.ts` | New `NAME_RULES`, appended to every outbound call; the matching line added to the inbound rules. |
| `src/lib/customers/rename.ts` | New `statedCustomerName()` reader; `renameLead` accepts the provenance `customer`. |
| `src/lib/calls/service.ts` | An outbound call that returns `stated_customer_name` differing from the record renames the lead, guarded against the agent's own name. |
| `tests/test-customer-name.mts` (new) | 64 checks. |

Not touched: the RAG system, campaign behaviour, the shared API key, the
workspace architecture, the live inbound deployment, and the older workspace's
agent, version or connection. No call history was rewritten — `renameLead`
updates a contact's name across its records as it already did, and no previous
call's identity is substituted into another.

---

## 6. Tests and results

Isolated temporary databases, mocked provider requests, no real calls.

| Suite | Result |
| --- | --- |
| `test-customer-name` (new) | **64/64** |
| `test-provider-editing` | 103/103 |
| `test-snippet-import` | 59/59 |
| `test-batch-campaign` | 71/71 |
| `test-multitenant` | 69/69 |
| `test-hook` | 20/20 |
| `test-workspace` | 17/17 |
| inbound (scratch) | 87/87 |
| campaign-sync (scratch) | 28/28 |

`tsc --noEmit` clean, `eslint src tests` clean (two pre-existing warnings),
`next build` compiles.

The new suite tests the data mapping and behaviour, not prompt wording, except
where the prompt *is* the deliverable: (1) a lead named Pratik resolves to
Pratik on `customer_name` and `userName` and on every declared alias; (2) blank,
"Customer" and "Unknown caller" names stay empty and never become a sample name;
(3, 4, 6) a stated name is read only from `stated_customer_name`, overrides a
stored "Manan" on both the lead and the profile, and keeps the old name as
history while stale memory no longer names the customer; (5) no name field ever
contains digits from the number; (7) the same number in two workspaces yields
two different names and a rename in one leaves the other untouched; (8) each
workspace's variables carry its own company, product and agent; (9) the
long-standing workspace keeps its agent, version, connection, company and
product; (10) no API key, Sarvam org or workspace ID, or webhook token appears
in what the browser is sent or in the variables sent to Sarvam.

---

## 7. One residual risk, stated plainly

After this change the older agent receives `userName` holding the customer's
name, where it previously received nothing and kept its `Ravi Nair` default.
The evidence says this is safe: that agent introduced itself as "Priya" and
asked for "Pratik" from `customer_name` while `userName` held `Ravi Nair`, so
its prompt uses `userName` for neither role. But agent prompts cannot be read
through the API, so this is inference from behaviour, not certainty. If that
agent ever starts using the customer's name for itself, that single line in
`context.ts` is the thing to revisit.

## 8. No calls placed

No real phone call was placed, no Sarvam deployment or agent was created or
modified, and the live database was not written to — its timestamp was checked
as unchanged after every suite run. The investigation used only the stored call
record, its transcript, its input and output variables, and the existing
database.
