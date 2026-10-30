# Dispatch AI cleanup & two-workspace lockdown — 2026-10-29

## 1. Exact root cause (traced end-to-end, provider-side)

Priya's full outbound runtime path was traced: selected workspace → DB records →
agent config → context assembly → the final Sarvam request → the provider-side agent.

**The "Dispatch AI" wording is inside the Sarvam app's own authored prompt. Tringlo
never sends any prompt text.** Proof, at three layers:

1. **The outbound payload carries no prompt.** `SarvamVoiceAgentsClient.startOutboundCall`
   (`src/lib/providers/sarvam/voice-agents.ts`) builds an `app_config` with only:
   `app_id`, `app_version`, `connection_config`, optional `agent_variables`,
   optional `app_overrides`, the user phone, and the webhook URL. There is **no**
   system prompt, business description, or instruction text anywhere in the request.
   Tringlo references the agent by **id + version**; the script lives in Sarvam.
2. **TenWeb's stored config is clean.** `agentConfig = { productName: "KhushiBot",
   companyName: "TenWeb", … }`; a full-text scan finds **zero** "dispatch" and zero
   "wellness/hospital". TenWeb declares only the variable `customer_name`, so
   `businessContextReach()` reports **no business context reaches the agent** — it
   speaks entirely from its Sarvam-side prompt.
3. **Confirmed live against the Sarvam API** (read-only; no call placed, nothing
   created). The deployments endpoint authenticated (HTTP 200) and lists exactly two
   active agents in our Sarvam account:
   - `Conversatio-834500dd-d3c1` (Priya's app), deployed as **"Dialo AI"**
   - `Amrita---We-4517816a-a47a` v1, deployed as **"Wellness Hospital"** (Maya)
   Every app-authoring *apps/prompt* read path returned 404 while deployments
   returned 200 — i.e. **Sarvam exposes no API to read or write an app's prompt**;
   it is editable only in the Sarvam dashboard's app-authoring UI.

### The runtime path cannot inherit another workspace's context
Verified at runtime against the live DB:
`isHospitalWorkspace("TenWeb") = false`, `isHospitalWorkspace("Wellness") = true`;
`resolveOutbound`/`resolveBatch` never fall back to another workspace (73/73
multitenant checks); TenWeb's product never leaks across tenants (66/66
generic-agent checks).

### REQUIRED PROVIDER-SIDE ACTION (cannot be fixed in code — not claimed fixed)
In the **Sarvam dashboard**, open app **`Conversatio-834500dd-d3c1`** (the versions
Priya uses: outbound **v4** and inbound **v11**) and replace the warehouse
"Dispatch AI" system prompt with the KhushiBot / TenWeb script. Until that prompt is
edited in Sarvam, Priya will keep introducing herself as Dispatch AI regardless of
what Tringlo sends. No Tringlo change can override a provider-side prompt, and none is
claimed to.

### New diagnostic
Each outbound call logs one `CALL_CONTEXT` line (workspace, exact agent id + version,
whether business context actually reaches the agent, and variable count). For TenWeb
it prints `businessContext=NOT SENT — agent uses its Sarvam-side prompt` — the
smoking gun pointing at the provider prompt. Names/booleans only; no secrets, no PII.

## 2. Workspaces / agents removed

Exactly **two** workspaces and **two** agents now remain:

| Workspace | Tenant id | Agent | Outbound/Batch | Inbound | Hospital |
|---|---|---|---|---|---|
| TenWeb | `tenant_1790143786482_2lzjp2` | **Priya / KhushiBot** | `Conversatio-834500dd-d3c1` v4 | v11 | false |
| Wellness Hospital | `tenant_1792938564756_qe17wn` | **Maya** (inbound only) | — | `Amrita---We-4517816a-a47a` v1 | true |

Removed this effort:
- **BrightPath / Dispatch** (`tenant_1791564774076_d50f5i`, owner `Avinyeaconnect1`)
  — deleted via `deleteTenant()` with all its leads/calls/customers/user.
  Backup: `data/backups/database.before-brightpath-delete-20261029-204047.json`.
- **Tringlo public demo** (`tenant_public_demo`) — the backing store for the public
  marketing "call me" demo. Deleted via `deleteTenant()`
  (`leads=1 calls=1 customers=1 users=0`), and the feature itself disabled (see §6).
  Backup: `data/backups/database.before-publicdemo-delete-20261029-212527.json`.
- **Inert orphan hospital profile on TenWeb** — a stray `hospitalProfiles` row
  (`enabled: null`, mislabeled "Wellness Hospital", created 2026-10-26 during early
  hospital-panel wiring). TenWeb had no hospital data anywhere else; removal is
  behavior-neutral. Now only Wellness has a hospital profile (`enabled: true`).
  Backup: `data/backups/database.before-orphan-cleanup-*.json`.

Post-cleanup DB scan: **0** occurrences of `tenant_public_demo` anywhere; exactly two
tenants. Connection id across all live configs: `8800e72c-9c-8f9c2a3f-4876`.
No Sarvam org/workspace id was confused with an internal tenant id.

## 3. Files deleted / changed

**Deleted (public-demo feature, now removed):**
- `src/components/site/demo-call.tsx` — the public demo UI.
- `src/app/api/public/demo-call/route.ts` — the public endpoint (+ empty `api/public`).
- `src/lib/demo/context.ts` — demo-context resolver (imported only by that route;
  removing the route is what stops the workspace auto-recreating) (+ empty `lib/demo`).
- `tests/test-demo-call.mts` — tested only the removed public demo (no hospital refs).

**Edited (removed dead `#demo` CTAs/links so nothing points at the deleted section):**
- `src/app/(site)/page.tsx` — dropped `<DemoCall/>` + import + comment.
- `src/components/site/side-rail.tsx` — removed the "Live demo" nav item.
- `src/components/site/hero.tsx` — removed the "Hear it call you" button; promoted
  "Create a workspace" to the primary filled style; dropped the now-unused
  `ArrowDown` import.
- `src/components/site/faq.tsx` — removed the "Hear it call you" button + unused import.
- `src/components/site/header.tsx` — removed the desktop + mobile "Live demo" links.
- `src/components/site/footer.tsx` — removed the "Live demo" footer link.

**Preserved deliberately:** the **hospital** demo-call (`src/app/api/hospital/demo-call/route.ts`
and the hospital agent page's own `DemoCall`) is a separate, requested feature and was
left untouched. No migrations, env files, credentials, assets, shared modules, or
production dependencies were removed.

## 4. Tests & build

- `test-multitenant` 73/73 · `test-generic-agents` 66/66 · `test-hospital` 246/246 ·
  `test-demo-prep` 34/34 — **419/419**.
- Runtime isolation (live DB, no calls): TenWeb → Priya/KhushiBot, outbound
  `Conversatio-834500dd-d3c1` v4, `isHospitalWorkspace=false`, no "dispatch"/"wellness"
  in its config; Wellness → Maya, inbound `Amrita---We-4517816a-a47a` v1,
  `isHospitalWorkspace=true`.
- `next build`: **success (exit 0)**, full route table emitted. (One pre-existing,
  unrelated warning about `src/lib/mail/mailer.ts` filesystem tracing — not introduced
  here.)
- Dev server restarted with `npm run dev` (supervised cloudflared tunnel +
  webhook-URL registration); `:3000` → 200; tunnel ready.

## 5. Remaining provider-side action
**Edit the Sarvam app `Conversatio-834500dd-d3c1` prompt (v4 and v11)** in the Sarvam
dashboard to remove the Dispatch/warehouse script and use the KhushiBot/TenWeb script.
This is the single remaining source of "Dispatch AI" and the only thing that cannot be
done from Tringlo — Sarvam exposes no prompt read/write API (verified: all app-read
paths 404 while the authenticated deployments path returns 200).

## 6. Public demo feature — disabled, by request
The public marketing "call me" demo was removed at the user's explicit direction (it
was the only remaining extra workspace, and since it cloned Priya it also inherited the
same Sarvam-side Dispatch prompt). Removing the `/api/public/demo-call` route is what
prevents the demo workspace from auto-recreating; its UI and nav entry points were
removed with it. The in-app **hospital** demo-call used for showing agents in the admin
panel is unaffected.
