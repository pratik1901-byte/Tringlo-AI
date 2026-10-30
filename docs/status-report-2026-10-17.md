# Tringlo AI — project report, 17 October 2026

Covers the UI refinements to workspace creation, the answer on the "Manan" name,
and a check over the whole project.

---

## 1. Why the agent said "Manan" — and why it is still unfixed

**The name comes from the Sarvam agent's own configuration, and that agent has
not been changed since 9 October.** The required dashboard edit has not been
made, so the cause is still live.

Recap of the cause, from the stored call: agent `2nd-workspa-4613bf8b-a9ba`
declares a variable **`user_name` whose default value is `Manan`**, and its
prompt addresses the customer from that variable. Tringlo does not send
`user_name`, so the default survived and the agent said "Thank you for your
time, Manan" — while Tringlo had correctly sent `customer_name: "Pratik"`.

**Tringlo's side is fixed and the fix is now proven on a real call.** The outbound
call on 16 October 08:56 sent:

```
customer_name : "Pratiksha"
userName      : "Pratiksha"     ← was the agent's name ("Maya") before the fix
```

Before the fix `userName` carried the agent's name; it now carries the
customer's, from the same authoritative value. That call shows no wrong name.

**But that call was from the older workspace.** There has been **no outbound
call from the "Maya" workspace since 9 October**, so the fix has never been
exercised against the agent that actually has the `Manan` default. Its
configuration is unchanged: still agent `2nd-workspa-4613bf8b-a9ba`, still
version 2.

### Two ways to finish it

**Either** make the change in the Sarvam dashboard (the robust fix, ~2 minutes):

1. Open agent `2nd-workspa-4613bf8b-a9ba` → **Variables**.
2. Clear the default `Manan` from **`user_name`**.
3. Better still, change the prompt to use `customer_name` (which Tringlo always
   sends) and delete `user_name` altogether.
4. Publish, then set the new version in Settings → Voice Provider.

**Or** have me make Tringlo send `user_name` too. Tringlo currently decides which
variables an agent accepts from one global list, which is why it cannot send
`user_name` to one agent without risking a rejected call on another. Making that
list per-workspace is a contained change I can do on request — then Tringlo
overwrites the `Manan` default on every call and no dashboard edit is needed.

**Until one of those is done, treat the second workspace as still affected.**

### One thing to know

The new **"Dummy"** workspace you created on 16 October points at the **same
agent** `2nd-workspa-4613bf8b-a9ba` with the same agent name "Maya" — so a call
from it would hit the same `Manan` default.

---

## 2. UI refinements to workspace creation

Three changes, all in the shared editor, so they apply to both the creation
wizard and Settings → Edit Voice Provider Configuration.

**Fields in a row now line up.** Where one field had a hint under its label
("Caller number — What the customer sees.") and its neighbour did not
("Telephony connection ID"), the two inputs sat at different heights and the
row looked broken. Every field is now a full-height column with its input at the
bottom, so inputs in a row always align. Verified in the browser: all four
two-column rows measure **0px** of vertical spread, where three of them were
previously out of line.

**A validation error now takes you to the field.** Step 3 is a long page, and
"Single outbound: enter the agent ID from Sarvam." appeared at the foot of it
while the empty field was off-screen at the top. Each section is now tagged, and
a failed Continue or Create scrolls to the section the message names and focuses
its first field. Verified: after a failed submit, focus lands on **Outbound agent
ID**, scrolled into view.

**Timezone is now pickable.** It was free text, where a typo is accepted
silently and then quietly shifts every calling window. It now offers the common
zones (Asia/Kolkata, Asia/Dubai, Europe/London, America/New_York, UTC and
others) while remaining typeable.

Checked at phone width as well: single column, no horizontal overflow, every
input labelled.

---

## 3. The rest of the project

**Running.** http://localhost:3000, up 182 hours, sign-in page renders with no
page errors.

**Health: `warn`, for one known reason.**

| Check | State |
| --- | --- |
| database, sarvam, workspaces, telephony | OK |
| webhook_auth | OK — per-workspace tokens, 3 configured |
| webhook_delivery | OK — 53 received, last success 16 Oct |
| scheduler | OK — ticking every 30s |
| webhook_url | **WARN** — temporary quick tunnel |

The tunnel warning is about fragility, not a current fault: the registered
inbound webhook matches the live tunnel hostname and re-synced today at 16:09.
It will break whenever the tunnel rotates, so a named tunnel or a deployed URL
is the real answer.

**Data.** 3 workspaces, 12 leads, 25 calls (22 connected, 2 busy, 1 failed), 22
transcripts, 30 cached recordings, 34 memory items, 1 campaign, 16 follow-ups
(14 cancelled, 1 completed, 1 awaiting scheduling, none overdue).

Recordings are fetched from Sarvam on demand and cached on disk rather than
stored in the database, so the empty `recordingUrl` fields are correct, not
missing data.

**Tests — all green, against isolated databases with no real calls:**

| Suite | Result |
| --- | --- |
| customer-name | 64/64 |
| provider-editing | 103/103 |
| snippet-import | 59/59 |
| batch-campaign | 71/71 |
| multitenant | 69/69 |
| hook | 20/20 |
| workspace | 17/17 |

`tsc` clean, `eslint` clean (two pre-existing warnings), `next build` compiles.
The live database was untouched by every run.

### Things worth your attention

1. **The Sarvam dashboard fix for `Manan`** — section 1. The only item that
   affects what a customer hears.
2. **The first workspace introduces itself as "TenWeb".** Workspace
   "AvinyeaConnect" has company name `TenWeb` and product `KhushiBot` in its
   agent profile, so that is what the agent says on calls. If the business is
   now AvinyeaConnect, this wants updating on the AI Agent page.
3. **No workspace has ever passed a provider check.** `verifiedAt` is unset on
   all three, so Settings shows "Saved" rather than "Provider verified". One
   press of **Test connection** per workspace would confirm the agents and
   numbers really exist — it reads only and places no call.
4. **The "Dummy" workspace** has no leads and no calls. If it was a test, it can
   be deleted from Settings; note it shares the second workspace's agent.
5. **Known-caller sync failed this morning** with "Could not reach Sarvam: fetch
   failed" at 08:10 — a network blip, not stale data (the list is not marked
   stale and the deployment synced fine at 16:09). Worth a glance if inbound
   callers stop being greeted by name.
6. **Campaigns over 1,000 leads still under-report.** Submission and calling are
   correct; only the stored accepted/rejected counts and cohort ID cover the
   last batch. Fine for anything smaller, which is everything so far.
7. **Direct CSV cohort upload to Sarvam remains unavailable** — its
   transformation format is unpublished. Tringlo uses the documented Stream cohort
   API, which is the supported route.
8. **The dev server log has reached 176 MB** after 7.6 days in the scratchpad.
   Harmless, but worth truncating.

No real phone call was placed, no Sarvam agent or deployment was modified, and
the live database was not written to during this work.
