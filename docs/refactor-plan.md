# Multi-workspace refactor — plan (A–F)

Decided architecture: **one Sarvam organisation, one Sarvam workspace, one API
key, many Sarvam agents, many isolated Tringlo workspaces.** The credential is
the platform's and stays server-side; which agent, connection, number and
deployment to use is per Tringlo workspace and editable in Settings.

---

## A. Exact current hardcoded / global configuration points

| # | Global today | Where | Becomes |
|---|---|---|---|
| 1 | API key, org id, Sarvam workspace id | `process.env`, read in 9 copies of `readEnv` | **stays global** — platform credentials, server-side only |
| 2 | Outbound app id / version / connection id / caller number / agent name / declared variables | `process.env` | **per Tringlo workspace**, in Settings |
| 3 | Inbound app id / version / connection id / declared variables | `process.env` (`SARVAM_INBOUND_*`) | **per Tringlo workspace**, in Settings |
| 4 | Company profile (name, product, FAQs, pricing, prompt, objectives) | `agentConfig` singleton row | **per Tringlo workspace** |
| 5 | Calling window (business hours for outbound) | `callingWindow` singleton row | **per Tringlo workspace** |
| 6 | RAG scope key | the company *name* string | **workspace id** |
| 7 | Mid-call RAG identity | `company_id` / `company_name` in the request body | **workspace token**, resolved server-side |
| 8 | Webhook token | one `DIALO_WEBHOOK_TOKEN` | **per workspace**, global accepted during migration |
| 9 | Agent name used to label transcripts | `SARVAM_AGENT_NAME` | per workspace (falls back to "Agent") |
| 10 | Campaign caller numbers, cohort mode | `SARVAM_CAMPAIGN_PHONE_NUMBERS`, `SARVAM_COHORT_MODE` | per workspace (numbers), platform (cohort mode) |

Stays global and server-side: webhook base URL, SMTP, internal secret,
scheduler switches, `DIALO_BLOCK_OUTBOUND_CALLS`.

**No silent inheritance.** A workspace with no provider configuration fails with
*"Voice provider is not configured for this workspace."* The environment seeds
the legacy workspace **once**, during migration, and is not a runtime fallback.

## B. Exact files involved

**New**
- `src/lib/providers/types.ts` — platform credentials + workspace provider config
- `src/lib/providers/config.ts` — resolve/validate/save; one entry point
- `src/app/api/integrations/provider/route.ts` — GET (masked) / PUT
- `src/app/api/integrations/provider/test/route.ts` — Test Connection
- `src/components/settings/voice-provider-card.tsx` — Settings UI

**Provider clients — take credentials instead of reading the environment**
`providers/sarvam/client.ts`, `campaigns.ts`, `deployments.ts`, `attempts.ts`,
`voice-agents.ts`, `variables.ts`, `recordings.ts`

**Call paths — resolve the workspace's config once, pass it down**
`calls/place-call.ts`, `calls/service.ts`, `campaigns/service.ts`,
`campaigns/sync.ts`, `inbound/service.ts`, `scheduling/scheduler.ts`

**Workspace-scoped data**
`db/index.ts` (new collection, per-tenant profile and window, migration),
`api/agent-config/route.ts`, `rag/retrieval.ts`, `rag/knowledge.ts`,
`api/integrations/sarvam/rag/route.ts`, `security/webhook-auth.ts`,
`api/integrations/sarvam/status/route.ts`

## C. Proposed data / configuration model

```
Platform (environment, server-side only)
  SARVAM_API_KEY · SARVAM_ORG_ID · SARVAM_WORKSPACE_ID

providerConfigs[]            one row per Tringlo workspace
  tenantId
  outbound { appId, appVersion, connectionId, phoneNumber,
             agentName, agentVariables[] }
  inbound  { appId, appVersion, connectionId, agentVariables[] }
  webhookToken               generated, server-side only
  createdAt / updatedAt / updatedBy

inboundSettings[]            unchanged — the inbound LINE, per workspace
  enabled, phoneNumber, hours, days, timezone, handoffNumber,
  deploymentId (the routing key), deploymentStatus, known-caller state

workspaceProfiles[]          company information, per workspace
  tenantId + the fields `agentConfig` holds today
  callingWindow
```

Two collections for inbound is deliberate: `providerConfigs.inbound` is *which
agent answers*, `inboundSettings` is *how the line runs* (already built, already
the webhook routing key). The Settings page presents them together.

`CallRecord` gains `providerAppId` — the agent the call actually ran on,
snapshotted at creation, so a later configuration change cannot rewrite how an
old recording is fetched. This mirrors what `CampaignRun` already does.

## D. Migration strategy

1. Add the collections; `withAllCollections` backfills empty ones as it already does.
2. **One-time seed**, guarded so it cannot run twice: if the legacy workspace has
   no provider config and the environment has Sarvam values, write them into that
   workspace's row, and copy the `agentConfig` / `callingWindow` singletons into
   its profile. Logged, and recorded with `seededFromEnv: true`.
3. The singletons stay in the file, unread, until the next phase removes them —
   so a rollback is a code revert, not a data restore.
4. New workspaces get **nothing**: no provider config, no company profile.
5. `data/database.json` is backed up before the first run.

Nothing about TenWeb's live configuration changes: same agent, same version,
same connection, same deployment, same inbound line.

## E. Security changes

1. Mid-call RAG resolves the workspace from its **workspace webhook token**, never
   from the body. A body `company_id` is ignored.
2. Per-workspace webhook tokens. Provider-identifier mapping stays mandatory and
   primary; the token is a second layer. The global token keeps working until
   every deployment is re-registered.
3. The inbound context endpoint checks that the token's workspace matches the
   workspace the deployment maps to.
4. An unmappable inbound or campaign event is still refused, never reassigned.
5. The API key is never returned by any endpoint; Settings shows only whether it
   is present. Workspace users never see it.
6. `tenantId` on `rawEvents` and `webhookReceipts` where it is known.
7. Rate-limit keys include the workspace on authenticated routes.

## F. Test strategy

A new suite, `test-multitenant.mts`, with two workspaces on **one** Sarvam
credential and two agents, asserting:

- A outbound uses Agent A and A's company context; B uses Agent B and B's.
- A's and B's inbound deployments route to their own workspace only.
- An unknown `deployment_id` or `campaign_id` creates nothing.
- A forged webhook with B's token but A's deployment does not cross over.
- RAG for A never returns B's product, and the reverse.
- Memory, calls, campaigns, follow-ups, analytics and contacts are invisible
  across workspaces through the real API routes.
- A workspace with no provider config fails with the stated message rather than
  borrowing another's.
- No provider secret appears in any API response.

Plus the existing suites (87 inbound, 28 campaign), `tsc`, `eslint`,
`next build`, and the browser sweep.
