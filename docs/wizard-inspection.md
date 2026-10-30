# Workspace wizard — inspection before changes

What exists today, what is stored, what is missing, and what will change. Read
against the working tree on 9 October 2026.

## 1. Existing wizard files

| File | Role |
|---|---|
| `src/components/auth/create-workspace-form.tsx` (423 lines) | the three-step form: Account → Company → Voice provider |
| `src/app/login/page.tsx` (797) | hosts it; `createWorkspace()` posts the whole payload once |
| `src/app/api/auth/bootstrap/route.ts` (258) | validates everything, then creates tenant → user → profile → provider config → inbound settings, and deletes the tenant again if any part fails |
| `src/components/settings/voice-provider-card.tsx` (300) | the same configuration, after onboarding |

## 2. Provider configuration schema as stored

```
providerConfigs[]            one row per workspace
  tenantId
  outbound { appId, appVersion, connectionId, phoneNumber, agentName, agentVariables[] }
  inbound  { appId, appVersion, connectionId, agentVariables[] } | null
  webhookToken               server-side only
  seededFromEnv, createdAt, updatedAt, updatedBy
```

Platform-level, in the environment and never per workspace: `SARVAM_API_KEY`,
`SARVAM_ORG_ID`, `SARVAM_WORKSPACE_ID`.

Inbound *line* settings live separately in `inboundSettings[]` (enabled, phone,
deployment id, hours, days, timezone, handoff number, deployment status).

## 3. Single outbound — implementation that exists

`placeCall()` → `sarvamVoiceService.startOutboundCall()` →
`client.createInstantOutbound(payload, credentials)`
→ `POST /api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds`

Tringlo builds the payload: `app_config.app_id`, `app_version`, `app_type`,
`connection_config.{connection_id, agent_phone_number}`, `agent_variables`,
optional `app_overrides`, `user_config.user_phone_number`, and
`webhook_config.{url, metadata}`. The URL and token are Tringlo's.

**Working and in daily use.**

## 4. Batch outbound — implementation that exists

`launchCampaign(tenantId, userId, input)` in `lib/campaigns/service.ts`:

1. **Create campaign** — `createCampaign(credentials, payload)` →
   `POST …/scheduling/v1/orgs/{org}/workspaces/{ws}/campaigns`. Tringlo builds
   `app_config` (app_id, app_version, app_type `"agent"`, attempts_per_second,
   connection_configs[], retry_config.retry_on{busy,no_answer,failed,short_duration},
   webhook_config), `start_timestamp`, `end_timestamp`, `allowed_schedule`.
   **Working** — one real campaign has run.
2. **Cohort** — two paths. `streamCohort()` (JSON, ≤1000 users per request) is
   the default and **works**. `uploadCohort()` (multipart CSV) exists, but
   `buildTransformation()` **throws**: the transformation format was never
   confirmed for campaigns, so upload mode is effectively disabled.
3. **Pause / resume / cancel** — `controlCampaign()` → `updateCampaignStatus()`
   → `PUT …/campaigns/{id}/status {action}`, with a state check
   (`pause: active|scheduled`, `resume: paused`) and status written back.
   **Working.**

Campaign results are pulled back by `lib/campaigns/sync.ts` from the analytics
API using the agent the campaign ran on.

## 5. Inbound — implementation that exists

`lib/inbound/service.ts` with `providers/sarvam/deployments.ts`: create, get,
list, update (paused only), pause/resume, cohort stream **and upload** (the
transformation format **is** confirmed here — it was worked out against Sarvam's
validator and accepted), webhook delivery list and retry. Routing is by
`deployment_id` → workspace, and the workspace's own webhook token.

## 6. Values already stored per workspace

Outbound agent id, version, connection id, caller number, agent name, declared
variables · inbound agent id, version, connection id, declared variables ·
inbound line: enabled, phone, deployment id, hours, days, timezone, handoff ·
webhook token.

## 7. Values missing

Everything batch-specific is either hardcoded, taken from the environment, or
typed again on every launch:

| Missing | Where it comes from today |
|---|---|
| batch agent id / version | reuses the outbound one, with no way to differ |
| batch connection id | reuses outbound |
| caller number **pool** | `outbound.phoneNumber` split on commas |
| `app_type` | hardcoded `"agent"` (campaigns), `SARVAM_APP_TYPE` (single) |
| attempts per second | typed on every launch |
| retry policy | typed on every launch |
| allowed schedule (timezone, hours, days) | typed on every launch |
| cohort mode | `SARVAM_COHORT_MODE` environment variable |

## 8. How the new form will populate configuration

Step 3 becomes three sections. Each has a paste area for the matching Sarvam
example. Pasting is **parsing only**: the snippet is read as text, its URL
checked against an allowlist of Sarvam endpoints, its JSON body parsed with
`JSON.parse`, and only recognised fields copied into the form, where they can be
reviewed and edited. Nothing is executed, no request is made, no credential is
kept — an API key in a pasted header is dropped and reported. The saved
configuration is the validated fields, never the snippet.

## 9. Backward compatibility

- TenWeb has no `batch` block. `campaignConfig()` will **fall back to the
  outbound settings**, which is exactly what it uses today, so existing
  campaigns and calls behave identically.
- Its status will read "Using single-outbound settings" rather than
  "Configured", so the gap is visible without forcing it through onboarding.
- No value is ever copied from another workspace.
- The live inbound deployment, agent, version, number, token and transfer
  settings are untouched.
