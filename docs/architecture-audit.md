# Tringlo AI — multi-tenant architecture audit

Audit only. Nothing in this document has been implemented.

Scope: what the codebase assumes today about there being one company, and what
the smallest safe path is to one shared backend serving many workspaces, each
with its own Sarvam configuration, knowledge and customer memory.

Date: 8 October 2026. Read against the working tree at that date.

---

## Summary

The tenancy foundations are in better shape than the provider layer.

**Already multi-tenant and safe.** Tenants, users and sessions exist; signup
creates a workspace; `requireAuth` yields a `tenantId`; leads, calls,
follow-ups, campaigns, inbound settings, customer profiles and memory items all
carry `tenantId` and are filtered on read. Inbound and campaign webhooks map to
a workspace by trusted provider identifiers (`deployment_id`, `campaign_id`) and
refuse to record anything they cannot map. Customer memory is keyed
`tenantId + normalised phone` exactly as the brief asks.

**Not multi-tenant.** Three things are process-global or database-global, and
all three are on the path of every call:

1. **Sarvam credentials and IDs** — read from `process.env` at the point of use,
   in nine separate copies of a `readEnv` helper across nineteen files.
2. **The company profile** (`agentConfig`) — one object for the whole database.
   It carries company name, product description, FAQs, pricing, objectives and
   the system prompt, and it feeds both the agent variables and the RAG index.
   A second workspace would overwrite the first.
3. **The RAG scope key** — the company *name* string, with an in-memory index
   built from that same global profile, and a mid-call endpoint that takes the
   company identity from the request body.

Nothing about TenWeb is hardcoded in source. TenWeb's identity lives in
`.env.local` and in the single `agentConfig` row — which is the hidden global
fallback the brief warns about.

**The one-line verdict:** the data layer is close to ready; the provider layer
and the company profile are the work. The minimum safe refactor is to introduce
a per-workspace provider configuration record, resolve it once per operation,
and pass it into the Sarvam clients instead of letting them read the
environment. Everything else follows from that.

---

## 1. Current hardcoded Sarvam configuration

No Sarvam credential or identifier is hardcoded in source. Every one is read
from the environment, which is a process-wide global shared by all workspaces.

Variables read, and where:

| Variable | Read by |
|---|---|
| `SARVAM_API_KEY` | client, campaigns, deployments, attempts, recordings, inbound service, campaign service/sync, tts, status, rag |
| `SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID` | the same set |
| `SARVAM_APP_ID` (alias `SARVAM_AGENT_ID`) | attempts, recordings, campaign service/sync, inbound service, voice-agents |
| `SARVAM_APP_VERSION`, `SARVAM_APP_TYPE` | campaign service, voice-agents, inbound service |
| `SARVAM_CONNECTION_ID` | campaign service, voice-agents, inbound service |
| `SARVAM_AGENT_PHONE_NUMBER` | campaign service, voice-agents |
| `SARVAM_AGENT_NAME` | voice-agents, calls/service (transcript labelling) |
| `SARVAM_AGENT_VARIABLES` | providers/sarvam/variables |
| `SARVAM_OMIT_INITIAL_BOT_MESSAGE` | voice-agents |
| `SARVAM_CAMPAIGN_PHONE_NUMBERS`, `SARVAM_COHORT_MODE` | campaigns service |
| `SARVAM_INBOUND_APP_ID`, `SARVAM_INBOUND_APP_VERSION`, `SARVAM_INBOUND_CONNECTION_ID`, `SARVAM_INBOUND_AGENT_VARIABLES` | inbound service |

Non-Sarvam server globals: `DIALO_WEBHOOK_TOKEN`, `DIALO_INTERNAL_SECRET`,
`WEBHOOK_BASE_URL`/`APP_URL`, `DIALO_BLOCK_OUTBOUND_CALLS`,
`DIALO_DISABLE_SCHEDULER`, `DIALO_TEST_HOOKS`, SMTP settings.

There are **nine copies** of the same `readEnv` helper
(`providers/sarvam/{client,campaigns,deployments,attempts}.ts`,
`recordings.ts`, `campaigns/{service,sync}.ts`, `inbound/service.ts`, plus
direct `process.env` reads in `voice-agents.ts`). Each is a separate place that
must stop reading the environment.

## 2. Current global / single-tenant assumptions

| Assumption | Where | Consequence for workspace B |
|---|---|---|
| One company profile | `agentConfig` singleton in the database; `getAgentConfig()` takes no tenant | B overwrites A's company name, product, FAQs, prompt; every call uses whoever saved last |
| One calling window | `callingWindow` singleton | B's business hours replace A's; the scheduler obeys one window for everyone |
| One set of Sarvam credentials | `process.env` | B's calls are placed from A's Sarvam workspace, billed to A, from A's number |
| RAG scope key is the company name | `buildAgentKnowledgeContext(companyName, …)` in `place-call.ts` | two workspaces with the same company name share a knowledge scope |
| RAG index built from the global profile | `rag/retrieval.ts` | B's agent can answer with A's product knowledge |
| One webhook token | `DIALO_WEBHOOK_TOKEN` | every workspace's Sarvam deployment holds the token that authenticates *all* workspaces' webhooks |
| One public webhook base URL | `webhookBaseUrl` singleton | legitimate: one deployment, one address. Keep global |
| Webhook delivery health is global | `webhookDelivery` singleton | health reporting mixes workspaces; cosmetic |
| Append-only logs carry no workspace | `rawEvents`, `webhookReceipts` | no per-workspace audit trail or retention |
| Rate limits keyed by IP only | `security/rate-limit.ts` `clientKey` | one noisy workspace can exhaust a shared bucket |
| A user belongs to exactly one workspace | `User.tenantId`, no membership table | no workspace switching, no agency/reseller access |
| Rows without `tenantId` belong to the legacy tenant | `scopeToTenant`, `ownedByTenant` | a silent fallback that must be retired before a second real workspace |

## 3. Current workspace / auth architecture

- `Tenant { id, name, createdAt }`, `User { id, tenantId, email, role: owner|member, … }`,
  `Session { id, tokenHash, userId, tenantId, expiresAt, … }`.
- `POST /api/auth/bootstrap` creates a tenant *and* its owner. It is gated to
  local requests or `DIALO_INTERNAL_SECRET`, so it is not public signup. It
  already supports creating more than one workspace; only the **first** account
  adopts pre-tenancy data (`legacyTenantId`).
- `requireAuth(request)` → `{ user, session, tenantId }`, with sliding expiry.
- `scopeToTenant(rows, tenantId, legacyTenantId)` and
  `ownedByTenant(row, …)` are used consistently in the API layer; another
  workspace's record answers 404, not 403.
- Missing for B2B: a membership table (user ↔ workspace, many-to-many), a
  workspace switcher, roles beyond owner/member, and an invite flow.

## 4. Current database structure

`data/database.json`, read through a `globalThis` cache; every mutation
rewrites the whole file (`tmp` file + atomic rename).

**Carry `tenantId` today:** `leads`, `callRecords`, `followUps`, `users`,
`sessions`, `customerProfiles`, `memoryItems`, `campaignRuns`,
`inboundSettings`, `notificationSettings`.

**Do not carry `tenantId`:** `rawEvents`, `webhookReceipts` (append-only
webhook logs), `passwordResets`, `emailChanges` (user-scoped, acceptable).

**Singletons that should become per-workspace:** `agentConfig`,
`callingWindow`.

**Singletons that should stay global:** `webhookBaseUrl`, `webhookDelivery`,
`legacyTenantId`.

**No provider-configuration collection exists.** Two partial precedents do:

- `InboundSettings` is already per workspace and already stores provider state
  (`deploymentId`, `phoneNumber`, `handoffNumber`, hours, known-caller cohort).
- `CampaignRun` **snapshots** `appId`, `appVersion`, `connectionId`,
  `phoneNumbers` at launch. This is the right instinct and worth keeping: a
  campaign records the configuration it ran with, so later edits cannot rewrite
  history.

## 5. Current RAG structure

- `src/lib/rag/knowledge.ts` — an in-memory `KnowledgeRegistry`,
  `Map<companyId, { chunks }>`. Not persisted; rebuilt per process.
- `src/lib/rag/retrieval.ts` — builds documents from `agentConfig` fields
  (company information, products, pricing, FAQs, guidelines), keyword-scores
  them against the query, returns a compact context plus the sources used.
  Rebuilds when a fingerprint of the config changes.
- Entry point: `buildAgentKnowledgeContext(companyId, agentConfig, keywords)`.
- Two callers:
  - `calls/place-call.ts` — passes **`companyName`** as the scope key.
  - `POST /api/integrations/sarvam/rag` — the mid-call tool endpoint.

The retrieval layer is already "one engine, scoped lookups", which matches the
target architecture. What is wrong is the **key** (a display name, not a
workspace id) and the **source** (one global profile). There is no document
upload, no chunk store and no embeddings — knowledge is derived from the
company profile only. That is worth stating plainly: "RAG" today is
keyword retrieval over the configured company profile.

## 6. Current customer-memory structure

This subsystem already matches the brief.

- `customerKey(tenantId, phone)` — identity is workspace + normalised phone.
- `CustomerProfile { id, tenantId, phoneNational, phoneE164, names[], identityAmbiguous, leadIds[], recentSummaries[] }`.
- `MemoryItem` carries `tenantId` and `customerId`; `getMemoryItems(tenantId, customerId)` filters on both.
- Inbound and outbound calls in the same workspace merge into one history, and
  summaries record their direction.
- The same number in two workspaces is two customers with no shared memory.

No change required beyond keeping the tenant argument mandatory.

## 7. Current inbound webhook routing

Safe today, by the rules the brief asks for.

- `POST /api/webhooks/sarvam/inbound` → `applySarvamEvent` → a payload with
  `deployment_id` and no `campaign_id` is treated as inbound.
- `recordForInboundCall` resolves the workspace with
  `findInboundSettingsByDeployment(deployment_id)`. If no workspace owns that
  deployment it returns `null` and **no record is created**. The call is never
  attributed to another workspace.
- The caller is matched within that workspace only; an unknown number creates a
  contact named "Unknown caller" in that workspace.
- The on-start context endpoint resolves by `deployment_id`, falling back to the
  dialled number, and requires the webhook token.
- Nothing uses caller name, spoken company name or model inference to pick a
  workspace.

Weakness: one global webhook token for every workspace (see §11).

## 8. Current outbound call routing

- `placeCall()` resolves the workspace for the **record** correctly: from the
  session when a person places the call, from the lead when the scheduler does,
  and it rejects a lead belonging to another workspace.
- But the **provider** side is global: credentials, org, Sarvam workspace,
  agent id/version, connection id and caller ID all come from `process.env`,
  and the company profile from the global `agentConfig`.
- Campaigns follow the same pattern in `campaigns/service.ts`, with their own
  `readEnv` copy, then snapshot what they used onto the `CampaignRun`.

So: the right workspace is recorded against the call, while the call itself is
placed with whatever the server's environment says.

## 9. Current provider configuration storage

- Credentials: environment only. Nothing in the database, nothing encrypted.
- Per-workspace provider state that already exists: `InboundSettings`
  (deployment, inbound number, handoff number, hours, cohort) and the
  `CampaignRun` snapshot.
- Crypto available today: `createHash` and `randomBytes` (sessions, passwords,
  OTPs, customer keys). No symmetric encryption helper exists yet; Node's
  `crypto` provides AES-256-GCM, so encryption at rest is a small addition, not
  a new dependency.
- `GET /api/integrations/sarvam/status` reports only booleans about which
  variables are set, never values. That pattern should carry over.

## 10. Exact files that need changing

Ordered by the phase they belong to (§"Proposed refactor").

**New files**

| File | Purpose |
|---|---|
| `src/lib/providers/types.ts` | `WorkspaceProviderConfig` — credentials, outbound block, inbound block, `inboundEnabled` |
| `src/lib/providers/config.ts` | `getProviderConfig(tenantId)`, validation, env fallback during migration, redaction helper |
| `src/lib/security/secrets.ts` | AES-256-GCM encrypt/decrypt for the API key, keyed by a server master key |
| `src/app/api/integrations/provider/route.ts` | GET (masked) / PUT the workspace's provider configuration |
| `src/app/api/integrations/provider/test/route.ts` | Test Connection |
| `src/components/settings/voice-provider-card.tsx` | the Settings UI |

**Provider clients — stop reading the environment, accept a config argument**

| File | Change |
|---|---|
| `src/lib/providers/sarvam/client.ts` | `createInstantOutbound(payload, config)` |
| `src/lib/providers/sarvam/campaigns.ts` | all campaign calls take `config` |
| `src/lib/providers/sarvam/deployments.ts` | `scope()` takes `config` |
| `src/lib/providers/sarvam/attempts.ts` | analytics calls take `config` |
| `src/lib/providers/sarvam/voice-agents.ts` | payload building takes `config` |
| `src/lib/recordings.ts` | `fetchRecording(interactionId, config)` |
| `src/lib/providers/sarvam/variables.ts` | declared-variable list from config, not env |

**Call paths — resolve the config once, pass it down**

| File | Change |
|---|---|
| `src/lib/calls/place-call.ts` | resolve config + per-workspace company profile; RAG keyed by `tenantId` |
| `src/lib/calls/service.ts` | agent name from config; recording prefetch and transfer verification need the call's workspace config |
| `src/lib/campaigns/service.ts`, `sync.ts` | drop `readEnv`; take config from the campaign's workspace |
| `src/lib/inbound/service.ts` | `inboundServerConfig()` becomes per-workspace; deployment lifecycle uses the workspace's credentials |
| `src/lib/scheduling/scheduler.ts` | per-workspace config and per-workspace calling window inside the tick |
| `src/lib/notifications/index.ts` | already tenant-aware; verify the window source |

**Company profile and knowledge — per workspace**

| File | Change |
|---|---|
| `src/lib/db/index.ts` | `agentConfig` and `callingWindow` singleton → per-tenant collections, with a migration that assigns the current value to the legacy tenant; add `tenantId` to `rawEvents`/`webhookReceipts`; add the provider-config collection |
| `src/app/api/agent-config/route.ts` | read/write the caller's workspace profile |
| `src/lib/rag/retrieval.ts`, `knowledge.ts` | scope key becomes `tenantId`; profile passed in explicitly |
| `src/app/api/integrations/sarvam/rag/route.ts` | resolve the workspace from a per-workspace token or deployment, never from the body |

**Security**

| File | Change |
|---|---|
| `src/lib/security/webhook-auth.ts` | per-workspace webhook token alongside the global one |
| `src/lib/security/rate-limit.ts` | include workspace in the key for authenticated routes |
| `src/app/api/integrations/sarvam/status/route.ts` | report the workspace's configuration, not the server's |

Roughly 25 files. No rewrite; most changes are threading one argument.

## 11. Security risks

Ordered by severity **for the multi-tenant target**. None of these is currently
exploitable with one workspace and one operator.

1. **Mid-call RAG endpoint trusts the body for identity.** `company_id` /
   `company_name` come from the request, authenticated by one shared secret
   (`DIALO_INTERNAL_SECRET` or `SARVAM_API_KEY`). With several workspaces, any
   holder of that one secret could read another workspace's knowledge by
   naming it. Must become: identity from a per-workspace token or the
   deployment, never from the caller.
2. **One webhook token for every workspace.** The token is registered inside
   each customer's own Sarvam workspace, so every customer can read it. Knowing
   a deployment id or campaign id, a customer could post forged events that
   land in another workspace. Must become per-workspace tokens.
3. **Shared credentials mean shared blast radius.** One `SARVAM_API_KEY` for
   everything today; if the per-workspace keys are stored unencrypted, a single
   database leak exposes every customer's Sarvam account. Encrypt at rest, keep
   the master key in the environment, never return the key to the browser.
4. **The legacy-tenant fallback.** Any row with a null `tenantId` is readable by
   whichever workspace is `legacyTenantId`. A future bug that forgets to stamp
   `tenantId` silently donates data to that workspace instead of failing. Retire
   it before onboarding a second company, and make `tenantId` required.
5. **Global company profile.** Today a second workspace would both read and
   overwrite the first's product information, and its agent would speak with it.
6. **Config changes are unversioned.** Changing an agent version mid-campaign
   would alter running behaviour. The `CampaignRun` snapshot already protects
   campaigns; inbound has no equivalent.
7. **Rate limits are per IP.** All of Sarvam's webhooks arrive from the same
   source, so one workspace's traffic can exhaust the shared bucket.
8. **No audit trail of configuration changes.** Who changed a connection id or
   a handoff number, and when, is not recorded.

## 12. Migration concerns

- **One JSON file for all workspaces.** Every write serialises and rewrites the
  whole database. Fine for development; it will not survive several busy
  workspaces, and two server processes would lose writes (last writer wins on
  the whole file). The data layer should therefore be reached only through
  `src/lib/db/index.ts` so the storage can be swapped later — that is already
  true today and must stay true.
- **Postgres readiness.** Shape the new collections as tables would be:
  `provider_configs(workspace_id PK)`, `workspace_profiles(workspace_id PK)`,
  and `tenantId` on every row including `rawEvents`/`webhookReceipts`. Avoid
  anything that depends on whole-file semantics.
- **Backfill.** Existing rows without `tenantId` must be stamped with the
  legacy tenant before the fallback is removed; the current `agentConfig` and
  `callingWindow` must become that workspace's rows; `.env.local`'s Sarvam
  values must become that workspace's provider record. Back up
  `data/database.json` first; the file is the system of record.
- **Live inbound deployment.** `Dialo-AI-fd26d0df-ceb7` is active and answering
  on `+918064269194`. Its webhook must keep resolving to the same workspace
  throughout the migration, or inbound calls will be dropped (they are
  deliberately not recorded when unmapped).
- **The running scheduler.** It holds the code it started with; any change to
  tick-driven behaviour needs a server restart to take effect.
- **Env fallback must be temporary.** Keeping `process.env` as a fallback makes
  the refactor safe, but it is exactly the hidden global the brief rejects. It
  should be removed in the final phase, once the legacy workspace has a real
  provider record.

---

## Proposed minimum safe refactor

Five phases. Each is independently shippable and leaves the app working. No
phase requires a database engine change.

### Phase 1 — Provider configuration as data (no behaviour change)

- Add `WorkspaceProviderConfig` and a `providerConfigs` collection keyed by
  `tenantId`.
- Add `getProviderConfig(tenantId)`, which returns the stored record, **falling
  back to the environment** when a workspace has none.
- Change the Sarvam clients to take a config argument instead of calling
  `readEnv`. Callers resolve the config once from the workspace they already
  know.
- Encrypt the API key at rest (AES-256-GCM, master key in the environment).
- Migrate the current `.env.local` values into the legacy workspace's record.

Behaviour is unchanged throughout: the one existing workspace resolves to the
same values it uses today. This is the largest mechanical change and the one
everything else depends on.

### Phase 2 — Company profile and calling window per workspace

- `agentConfig` → `workspaceProfiles[]`, `callingWindow` → per workspace, both
  keyed by `tenantId`; the existing singletons become the legacy workspace's rows.
- `getAgentConfig(tenantId)` / `saveAgentConfig(tenantId, …)`.
- Update `place-call`, campaigns, inbound variables, notifications and the
  scheduler to pass the workspace.

### Phase 3 — Knowledge scoped by workspace

- RAG scope key becomes `tenantId`, never the company name.
- The mid-call endpoint resolves the workspace from a per-workspace token or
  the deployment, never from the request body.
- Keep one retrieval engine; only the scope changes.

### Phase 4 — Settings UI

- A "Voice Provider" card: credentials, outbound block, inbound block with its
  enable switch, Test Connection, Save.
- The API key is write-only: shown masked (`sk_••••9t06`) after saving, never
  returned in full.
- Inbound fields are not required while inbound is off.
- Test Connection calls Sarvam with the workspace's own credentials and reports
  what it found, without revealing secrets.

### Phase 5 — Close the gaps

- Per-workspace webhook tokens; keep accepting the global one until every
  deployment is re-registered.
- `tenantId` on `rawEvents` and `webhookReceipts`.
- Workspace in the rate-limit key for authenticated routes.
- Remove the environment fallback and the legacy-tenant fallback; make
  `tenantId` required.
- A configuration change log (who changed what, when).

### Explicitly out of scope for now

Postgres, memberships/workspace switching, invites, billing, per-workspace
knowledge-document upload, and embeddings-based retrieval. None is needed to
onboard a second company; each can be added on top of this shape.

### What must keep working at every phase

Outbound calling · campaigns (cohort upload, pause/resume, retries) · outbound
webhooks · inbound calling · human transfer · customer memory · the follow-up
scheduler · DND · dashboard · results · analytics · webhook authentication and
rate limiting · health checks · server-side-only secrets.

The regression suites to run after each phase: the inbound suite (87 checks),
the campaign-sync suite (28 checks), `tsc --noEmit`, `eslint src`,
`next build`, and the ten-page browser sweep.
