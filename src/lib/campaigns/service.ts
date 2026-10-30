// ============================================================
// Tringlo AI — Campaign service
// ============================================================
//
// Launches Sarvam campaigns, keeps their status in step with Sarvam, and
// computes their progress from real call records.
//
// Sarvam owns the dialling: it works through the cohort within the allowed
// schedule and retries unanswered leads by the campaign's retry rules. Tringlo
// never dials campaign leads itself and never runs a second retry engine.
// Every attempt comes back through the existing webhook pipeline, which is
// what creates the call record, updates the lead and customer memory, and
// schedules any callback the customer asked for.
// ============================================================

import { createHash } from "node:crypto";

import {
  findCampaignRunByProviderId,
  getAgentConfig,
  getCallRecords,
  getCallingWindow,
  getCampaignRun,
  getLead,
  getLeads,
  getWebhookBaseUrl,
  saveCampaignRun,
  saveLead,
} from "@/lib/db";
import { ownedByTenant } from "@/lib/auth/guard";
import { normalisePhone, isPlaceholderName } from "@/lib/customers/identity";
import { getContextForCall } from "@/lib/memory/service";
import {
  SarvamCampaignError,
  createCampaign,
  getCampaign as getProviderCampaign,
  getCohort,
  streamCohort,
  updateCampaignStatus,
  uploadCohort,
  type SarvamCohortResponse,
  type SarvamCohortUser,
  type SarvamCreateCampaignPayload,
} from "@/lib/providers/sarvam/campaigns";
import { buildSarvamAgentVariables } from "@/lib/providers/sarvam/variables";
import { resolveMappings, type AgentVariableMapping } from "@/lib/providers/variable-mapping";
import { platformCredentials, platformProblems, resolveBatch, tryResolveOutbound } from "@/lib/providers/config";
import { NOT_CONFIGURED, type BatchProviderConfig, type PlatformCredentials } from "@/lib/providers/types";
import { withWebhookToken } from "@/lib/security/webhook-auth";
import type { CallRecord, Lead } from "@/lib/types";

import { validateCampaignCsv, type CsvReport, type ValidRow } from "./csv";
import {
  WEEKDAYS,
  fromProviderStatus,
  type Campaign,
  type CampaignMember,
  type CampaignRetry,
  type CampaignSchedule,
  type Weekday,
} from "./types";

// ------------------------------------------------------------
// Configuration — server-side, never hardcoded
// ------------------------------------------------------------

export interface CampaignConfig {
  ready: boolean;
  problems: string[];
  appId: string;
  appVersion: number;
  connectionId: string;
  phoneNumbers: string[];
  /** The variables the campaign agent declares; empty means none are sent. */
  agentVariables: string[];
  /** Where each one comes from. Authoritative when present. */
  variableMappings: AgentVariableMapping[];
  /** Public HTTPS base Sarvam can reach, or null. */
  webhookBase: string | null;
  cohortMode: "upload" | "stream";
  /** Sarvam's app_type for this workspace's campaigns. */
  appType: string;
  /** What a launch starts from, when the workspace has campaign settings. */
  defaults: {
    attemptsPerSecond: number;
    retry: BatchProviderConfig["retry"];
    schedule: BatchProviderConfig["schedule"];
  } | null;
  /** True when these came from the single-call settings rather than campaign ones. */
  inherited: boolean;
  /** Tringlo's own Sarvam credentials, or null when the server has none. */
  credentials: PlatformCredentials | null;
  /** The launching workspace's webhook token. */
  webhookToken: string | null;
}

export function campaignConfig(tenantId: string): CampaignConfig {
  const problems: string[] = [...platformProblems()];
  const resolved = tryResolveOutbound(tenantId);
  if (!resolved.ok) problems.push(...resolved.problems);

  // Campaigns run on this workspace's campaign settings. A workspace that has
  // none falls back to its single-call settings — which is what campaigns used
  // before these existed — and says so, rather than looking fully configured.
  const settings = resolveBatch(tenantId);
  const batch = settings?.batch ?? null;
  if (!batch) problems.push(NOT_CONFIGURED);

  const base = getWebhookBaseUrl();
  const webhookBase = base && /^https:\/\//i.test(base) ? base.replace(/\/+$/, "") : null;
  const cohortMode = batch?.cohortMode ?? "stream";

  if (!webhookBase) problems.push("No public HTTPS webhook address is registered, so Sarvam could not report results.");
  if (cohortMode === "upload" && !transformationSchemaConfirmed()) {
    problems.push("Cohort upload needs the confirmed cohort_transformation_file format; use streaming instead.");
  }

  return {
    ready: problems.length === 0,
    problems,
    appId: batch?.appId ?? "",
    appVersion: batch?.appVersion ?? 0,
    appType: batch?.appType ?? "agent",
    connectionId: batch?.connectionId ?? "",
    phoneNumbers: batch?.phoneNumbers ?? [],
    /** What the campaign agent declares; empty means none are sent. */
    agentVariables: batch?.agentVariables ?? [],
    /** Where each one comes from, including `csv.<column>` sources. */
    variableMappings: batch?.variableMappings ?? [],
    webhookBase,
    cohortMode,
    defaults: batch
      ? { attemptsPerSecond: batch.attemptsPerSecond, retry: batch.retry, schedule: batch.schedule }
      : null,
    inherited: settings?.inherited ?? false,
    credentials: resolved.ok ? resolved.value.credentials : null,
    webhookToken: resolved.ok ? resolved.value.webhookToken : null,
  };
}

// ------------------------------------------------------------
// Cohort transformation file
// ------------------------------------------------------------
//
// The multipart upload endpoint requires a JSON "transformation" file mapping
// CSV columns to the phone number, user_identifier and agent variables.
// Sarvam's public documentation does not publish that file's schema, and a
// guessed schema would either be rejected or — worse — map columns wrongly.
// Until the exact format is confirmed, uploads are refused before anything is
// sent and cohorts go through the documented JSON stream endpoint instead,
// which carries the same data: user_phone_number, user_identifier,
// app_variables.

function transformationSchemaConfirmed(): boolean {
  return false;
}

/**
 * The cohort CSV Tringlo sends: one row per lead, with the normalised number,
 * the Tringlo lead id as user_identifier, and every agent variable in a column
 * of exactly its own name.
 */
export function cohortCsv(users: SarvamCohortUser[]): string {
  const variableColumns = [...new Set(users.flatMap((user) => Object.keys(user.app_variables ?? {})))].sort();
  const header = ["user_phone_number", "user_identifier", ...variableColumns];
  const escape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = users.map((user) =>
    [user.user_phone_number, user.user_identifier ?? "", ...variableColumns.map((column) => user.app_variables?.[column] ?? "")]
      .map(escape)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function buildTransformation(): never {
  throw new SarvamCampaignError(
    "The cohort_transformation_file format has not been confirmed, so a CSV upload was not attempted.",
    501,
    "transformation_unconfirmed"
  );
}

// ------------------------------------------------------------
// Validating a launch request
// ------------------------------------------------------------

export interface LaunchInput {
  name: string;
  cohortName: string;
  csv: string;
  schedule: CampaignSchedule;
  retry: CampaignRetry;
  attemptsPerSecond: number;
  /** The person confirmed launching without the invalid rows. */
  skipInvalidRows: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateLaunchSettings(input: Omit<LaunchInput, "csv">): string[] {
  const problems: string[] = [];
  const name = input.name.trim();
  if (!name) problems.push("Give the campaign a name.");
  if (name.length > 100) problems.push("Keep the campaign name under 100 characters.");
  if (!/^[A-Za-z0-9 _-]{1,50}$/.test(input.cohortName.trim())) {
    problems.push("Cohort name: 1–50 letters, numbers, spaces, underscores or hyphens.");
  }

  const { schedule, retry } = input;
  const start = new Date(schedule.start).getTime();
  const end = new Date(schedule.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) problems.push("Choose a valid start and end.");
  else {
    if (end <= start) problems.push("The end must be after the start.");
    if (end <= Date.now()) problems.push("The end is in the past.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone });
  } catch {
    problems.push("Choose a valid timezone.");
  }
  if (!HHMM.test(schedule.startTime) || !HHMM.test(schedule.endTime)) problems.push("Calling hours must be HH:MM.");
  else if (schedule.endTime <= schedule.startTime) problems.push("Calling hours must end after they start.");
  if (!schedule.days.length || schedule.days.some((day) => !WEEKDAYS.includes(day))) problems.push("Choose at least one calling day.");

  if (!Number.isInteger(retry.maxRetries) || retry.maxRetries < 0 || retry.maxRetries > 20) problems.push("Max retries must be 0–20.");
  if (retry.maxRetries > 0) {
    if (!Number.isFinite(retry.intervalMinutes) || retry.intervalMinutes < 1 || retry.intervalMinutes > 10080) {
      problems.push("Retry interval must be 1–10080 minutes.");
    }
    if (!retry.onBusy && !retry.onNoAnswer && !retry.onFailed && !retry.onShortDuration) {
      problems.push("Choose which outcomes to retry, or set max retries to 0.");
    }
    if (retry.onShortDuration && (!Number.isFinite(retry.shortDurationSeconds) || retry.shortDurationSeconds < 1 || retry.shortDurationSeconds > 600)) {
      problems.push("Short-duration threshold must be 1–600 seconds.");
    }
  }
  if (!Number.isFinite(input.attemptsPerSecond) || input.attemptsPerSecond < 0.1 || input.attemptsPerSecond > 500) {
    problems.push("Calling rate must be 0.1–500 calls per second.");
  }
  return problems;
}

// ------------------------------------------------------------
// Leads and per-lead variables
// ------------------------------------------------------------

/** Finds the workspace's lead for a number, or creates one. Never crosses workspaces. */
function upsertLead(tenantId: string, row: ValidRow, campaignId: string): Lead {
  const national = normalisePhone(row.phone).national;
  const existing = getLeads().find(
    (lead) => ownedByTenant(lead, tenantId) && normalisePhone(lead.phone).national === national
  );
  const now = new Date().toISOString();

  if (existing) {
    return saveLead({
      ...existing,
      // A real name from the sheet fills a placeholder; it never overwrites one.
      name: isPlaceholderName(existing.name) && row.name ? row.name : existing.name,
      company: existing.company || row.variables.company_name || existing.company,
      notes: existing.notes || row.variables.lead_notes || existing.notes,
      campaign: campaignId,
    });
  }

  return saveLead({
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    name: row.name || "Customer",
    phone: row.phone,
    company: row.variables.company_name,
    notes: row.variables.lead_notes,
    campaign: campaignId,
    callingDate: now.slice(0, 10),
    callingTime: "",
    timezone: getCallingWindow(tenantId).timezone || "Asia/Kolkata",
    createdAt: now,
    status: "queued",
    suppressed: false,
  } as Lead);
}

function toStrings(variables: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
    if (text.trim()) out[key] = text;
  }
  return out;
}

/**
 * The agent variables for one lead.
 *
 * Built exactly as a single call builds them (same declared-names filter, same
 * guard against sending output variables), then the sheet's own values for
 * declared variables, then the customer's memory: relevant facts and the last
 * conversation, never the whole history. A first-time customer has none.
 */
function variablesFor(
  tenantId: string,
  lead: Lead,
  row: ValidRow,
  campaignName: string,
  campaignId: string,
  declaredVariables: string[],
  mappings: AgentVariableMapping[]
) {
  const agentConfig = getAgentConfig(tenantId);
  const memory = getContextForCall(tenantId, lead, { isFollowUp: false, topic: campaignName });

  // A campaign agent with its own mapping is authoritative: exactly those
  // names, from the lead, the workspace or a column of this very sheet.
  if (mappings.length > 0) {
    const mapped = resolveMappings(mappings, {
      lead: { name: lead.name, phone: row.phone, company: lead.company, notes: lead.notes, email: lead.email },
      workspace: { company: agentConfig.companyName, product: agentConfig.productName, industry: agentConfig.industry },
      call: { campaignName, previousInteraction: memory.previousInteraction },
      row: row.variables as Record<string, string>,
    });
    return { variables: toStrings(mapped.variables), hadMemory: !memory.isEmpty, missingRequired: mapped.missingRequired };
  }

  const { variables } = buildSarvamAgentVariables({
    lead,
    agentConfig,
    // The agent actually dialling decides which variables may travel, exactly
    // as it does for a single call. Without this every campaign would be built
    // against the fallback list rather than against that agent.
    declaredVariables,
    normalizedPhone: row.phone,
    companyName: (agentConfig.companyName || "").trim(),
    productName: agentConfig.productName || agentConfig.productsServices,
    campaignName,
    campaignId,
    previousInteraction: memory.previousInteraction,
    customVariables: {
      // Sheet values, verbatim names — already restricted to declared variables.
      ...row.variables,
      ...(memory.isEmpty
        ? {}
        : {
            customer_id: memory.customerId ?? "",
            customer_memory_context: memory.customerMemoryContext,
            previous_interaction: memory.previousInteraction,
            priorTouchpointSummary: memory.priorTouchpointSummary || memory.previousInteraction,
            last_call_summary: memory.lastCallSummary ?? "",
            previous_objection: memory.previousObjection ?? "",
            previous_interest: memory.previousInterest ?? "",
          }),
    },
  });

  return { variables: toStrings(variables), hadMemory: !memory.isEmpty, missingRequired: [] as string[] };
}

// ------------------------------------------------------------
// Launch
// ------------------------------------------------------------

export interface LaunchResult {
  ok: boolean;
  campaign?: Campaign;
  report?: CsvReport;
  problems?: string[];
}

export async function launchCampaign(tenantId: string, userId: string, input: LaunchInput): Promise<LaunchResult> {
  const config = campaignConfig(tenantId);
  if (!config.ready) return { ok: false, problems: config.problems };

  const problems = validateLaunchSettings(input);
  const report = validateCampaignCsv(input.csv, config.agentVariables, config.variableMappings);
  if (report.fileErrors.length) problems.push(...report.fileErrors);
  if (report.valid.length === 0) problems.push("There are no valid leads to call.");
  if (report.invalid.length > 0 && !input.skipInvalidRows) {
    problems.push(`${report.invalid.length} row(s) are invalid. Fix them, or confirm launching without them.`);
  }
  if (problems.length) return { ok: false, problems, report };

  const now = new Date().toISOString();
  const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const name = input.name.trim();

  // ---- leads and their variables, before anything is sent -----------------
  const members: CampaignMember[] = [];
  const users: SarvamCohortUser[] = [];
  for (const row of report.valid) {
    const lead = upsertLead(tenantId, row, id);
    if (lead.suppressed) continue; // A do-not-call request stands.
    const { variables, hadMemory, missingRequired } = variablesFor(
      tenantId, lead, row, name, id, config.agentVariables, config.variableMappings
    );
    // Said before anything is sent, naming the lead and the mapping, so the
    // sheet can be corrected rather than a campaign half-dialled.
    if (missingRequired.length > 0) {
      return {
        ok: false,
        report,
        problems: [
          `${row.phone}: no value for ${missingRequired.join(", ")}, which this agent's mapping requires. Add the column to the sheet, or give the mapping a default in Settings → Voice provider.`,
        ],
      };
    }
    members.push({ leadId: lead.id, phone: row.phone, name: lead.name, hadMemory });
    users.push({ user_phone_number: row.phone, user_identifier: lead.id, app_variables: variables });
  }
  if (users.length === 0) return { ok: false, problems: ["Every valid lead has asked not to be called."], report };

  const webhookPath = `${config.webhookBase}/api/webhooks/sarvam/campaign`;
  let campaign: Campaign = {
    id,
    tenantId,
    name,
    status: "launching",
    providerStatus: null,
    providerCampaignId: null,
    cohortName: input.cohortName.trim(),
    providerCohortId: null,
    cohortStatus: null,
    cohortResult: null,
    cohortMode: config.cohortMode,
    appId: config.appId,
    appVersion: config.appVersion,
    connectionId: config.connectionId,
    phoneNumbers: config.phoneNumbers,
    attemptsPerSecond: input.attemptsPerSecond,
    retry: input.retry,
    schedule: input.schedule,
    members,
    failureReason: null,
    webhookUrl: webhookPath,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    launchedAt: null,
    lastSyncedAt: null,
  };
  campaign = saveCampaignRun(campaign);

  // ---- create at Sarvam ----------------------------------------------------
  const { retry, schedule } = input;
  const payload: SarvamCreateCampaignPayload = {
    name,
    app_config: {
      app_id: config.appId,
      app_version: config.appVersion,
      app_type: config.appType,
      attempts_per_second: input.attemptsPerSecond,
      connection_configs: [{ connection_id: config.connectionId, phone_numbers: config.phoneNumbers }],
      retry_config: {
        max_retries: retry.maxRetries,
        retry_interval_minutes: retry.intervalMinutes,
        retry_on: {
          busy: { enabled: retry.maxRetries > 0 && retry.onBusy },
          no_answer: { enabled: retry.maxRetries > 0 && retry.onNoAnswer },
          failed: { enabled: retry.maxRetries > 0 && retry.onFailed },
          short_duration: {
            enabled: retry.maxRetries > 0 && retry.onShortDuration,
            threshold_seconds: retry.shortDurationSeconds,
          },
        },
      },
      webhook_config: {
        url: withWebhookToken(webhookPath, config.webhookToken),
        metadata: { tringlo_campaign_id: id, tringlo_tenant_id: tenantId },
      },
    },
    start_timestamp: new Date(schedule.start).toISOString(),
    end_timestamp: new Date(schedule.end).toISOString(),
    allowed_schedule: {
      timezone: schedule.timezone,
      allowed_start_time: schedule.startTime,
      allowed_end_time: schedule.endTime,
      allowed_days: schedule.days as Weekday[],
    },
  };

  try {
    const created = await createCampaign(config.credentials!, payload);
    campaign = saveCampaignRun({
      ...campaign,
      providerCampaignId: created.campaign_id,
      providerStatus: created.status,
    });
    console.log(`CAMPAIGN_CREATED campaign=${id} provider=${created.campaign_id} status=${created.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sarvam rejected the campaign.";
    campaign = saveCampaignRun({ ...campaign, status: "failed", failureReason: `Sarvam did not create the campaign: ${message}` });
    return { ok: false, campaign, problems: [campaign.failureReason ?? message], report };
  }

  // ---- hand over the leads ------------------------------------------------
  try {
    let cohort: SarvamCohortResponse | null = null;
    if (config.cohortMode === "upload") {
      cohort = await uploadCohort(config.credentials!, campaign.providerCampaignId!, campaign.cohortName, cohortCsv(users), buildTransformation());
    } else {
      // Up to 1000 users per request; one cohort name per batch.
      for (let offset = 0; offset < users.length; offset += 1000) {
        const batch = users.slice(offset, offset + 1000);
        const batchName = users.length > 1000 ? `${campaign.cohortName}-${offset / 1000 + 1}`.slice(0, 50) : campaign.cohortName;
        cohort = await streamCohort(config.credentials!, campaign.providerCampaignId!, batchName, batch);
      }
    }
    campaign = saveCampaignRun({
      ...campaign,
      providerCohortId: cohort?.cohort_id ?? null,
      cohortStatus: cohort?.status ?? null,
      cohortResult: cohort?.result
        ? { total: cohort.result.total_records, valid: cohort.result.valid_records, rejected: cohort.result.rejected_records }
        : null,
      status: fromProviderStatus(campaign.providerStatus) ?? "scheduled",
      launchedAt: new Date().toISOString(),
    });
    console.log(`CAMPAIGN_COHORT_SENT campaign=${id} users=${users.length} cohort=${cohort?.cohort_id ?? "?"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sarvam rejected the leads.";
    // A campaign without its leads must not sit there waiting to run.
    try {
      await updateCampaignStatus(config.credentials!, campaign.providerCampaignId!, "cancel");
    } catch {
      // Reported below; the campaign has no leads either way.
    }
    campaign = saveCampaignRun({ ...campaign, status: "failed", failureReason: `Sarvam did not accept the leads: ${message}` });
    return { ok: false, campaign, problems: [campaign.failureReason ?? message], report };
  }

  return { ok: true, campaign, report };
}

// ------------------------------------------------------------
// Sync and control
// ------------------------------------------------------------

/** Pulls Sarvam's status (and the cohort's) into the campaign. Throttled. */
export async function syncCampaign(campaign: Campaign, force = false): Promise<Campaign> {
  if (!campaign.providerCampaignId || campaign.status === "failed") return campaign;
  const last = campaign.lastSyncedAt ? new Date(campaign.lastSyncedAt).getTime() : 0;
  if (!force && Date.now() - last < 10_000) return campaign;

  try {
    const credentials = platformCredentials();
    if (!credentials) return campaign;
    const remote = await getProviderCampaign(credentials, campaign.providerCampaignId);
    let next: Campaign = {
      ...campaign,
      providerStatus: remote.status,
      status: fromProviderStatus(remote.status) ?? campaign.status,
      lastSyncedAt: new Date().toISOString(),
    };
    if (next.providerCohortId && next.cohortStatus !== "completed" && next.cohortStatus !== "failed") {
      const cohort = await getCohort(credentials, next.providerCampaignId!, next.providerCohortId);
      next = {
        ...next,
        cohortStatus: cohort.status,
        cohortResult: cohort.result
          ? { total: cohort.result.total_records, valid: cohort.result.valid_records, rejected: cohort.result.rejected_records }
          : next.cohortResult,
      };
    }
    return saveCampaignRun(next);
  } catch (error) {
    console.error(`CAMPAIGN_SYNC_FAILED campaign=${campaign.id}`, error instanceof Error ? error.message : error);
    return campaign;
  }
}

const ALLOWED: Record<"pause" | "resume" | "cancel", Campaign["status"][]> = {
  pause: ["active", "scheduled"],
  resume: ["paused"],
  cancel: ["active", "scheduled", "paused"],
};

export async function controlCampaign(
  campaign: Campaign,
  action: "pause" | "resume" | "cancel"
): Promise<{ ok: boolean; campaign: Campaign; error?: string }> {
  const fresh = await syncCampaign(campaign, true);
  if (!fresh.providerCampaignId) return { ok: false, campaign: fresh, error: "This campaign was never created at Sarvam." };
  if (!ALLOWED[action].includes(fresh.status)) {
    return { ok: false, campaign: fresh, error: `A ${fresh.status} campaign cannot be ${action === "resume" ? "resumed" : action === "pause" ? "paused" : "cancelled"}.` };
  }
  try {
    const credentials = platformCredentials();
    if (!credentials) return { ok: false, campaign: fresh, error: platformProblems()[0] ?? "Sarvam is not configured on this server." };
    const remote = await updateCampaignStatus(credentials, fresh.providerCampaignId, action);
    const next = saveCampaignRun({
      ...fresh,
      providerStatus: remote.status,
      status: fromProviderStatus(remote.status) ?? fresh.status,
      failureReason: null,
      lastSyncedAt: new Date().toISOString(),
    });
    console.log(`CAMPAIGN_${action.toUpperCase()} campaign=${fresh.id} status=${remote.status}`);
    return { ok: true, campaign: next };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sarvam refused the change.";
    return { ok: false, campaign: fresh, error: message };
  }
}

// ------------------------------------------------------------
// Progress — from real call records only
// ------------------------------------------------------------

export interface CampaignStats {
  totalLeads: number;
  /** Leads with no attempt reported yet: waiting at Sarvam. */
  queued: number;
  /**
   * Campaign webhooks arrive after each attempt ends, so Sarvam does not tell
   * Tringlo that a lead is ringing right now. Always null; shown as unknown.
   */
  calling: null;
  connected: number;
  noAnswer: number;
  busy: number;
  failed: number;
  /** Latest attempt was unanswered and Sarvam said it will retry. */
  retrying: number;
  interested: number;
  notInterested: number;
  followUp: number;
  humanHandoff: number;
  /** Leads whose outcome is final: connected, or out of retries. */
  finished: number;
  remaining: number;
  attempts: number;
  /** 0–1 */
  progress: number;
  connectionRate: number | null;
}

function latestFirst(a: CallRecord, b: CallRecord): number {
  return String(b.endedAt ?? b.requestedAt ?? "").localeCompare(String(a.endedAt ?? a.requestedAt ?? ""));
}

export function campaignAttempts(campaign: Campaign): CallRecord[] {
  return getCallRecords()
    .filter((record) => record.campaignId === campaign.id && record.tenantId === campaign.tenantId)
    .sort(latestFirst);
}

export function campaignStats(campaign: Campaign, attempts = campaignAttempts(campaign)): CampaignStats {
  const byLead = new Map<string, CallRecord[]>();
  for (const attempt of attempts) {
    byLead.set(attempt.leadId, [...(byLead.get(attempt.leadId) ?? []), attempt]);
  }

  const stats: CampaignStats = {
    totalLeads: campaign.members.length,
    queued: 0,
    calling: null,
    connected: 0,
    noAnswer: 0,
    busy: 0,
    failed: 0,
    retrying: 0,
    interested: 0,
    notInterested: 0,
    followUp: 0,
    humanHandoff: 0,
    finished: 0,
    remaining: 0,
    attempts: attempts.length,
    progress: 0,
    connectionRate: null,
  };

  for (const member of campaign.members) {
    const history = byLead.get(member.leadId) ?? [];
    if (history.length === 0) {
      stats.queued++;
      continue;
    }
    const connected = history.find((record) => record.status === "connected");
    const latest = history[0];

    if (connected) {
      stats.connected++;
      stats.finished++;
      const outcome = connected.aiResult?.status;
      if (outcome === "interested") stats.interested++;
      else if (outcome === "not_interested" || outcome === "do_not_call") stats.notInterested++;
      if (outcome === "follow_up" || connected.followUpRequired) stats.followUp++;
      if (outcome === "human_handoff" || connected.humanHandoffRequired) stats.humanHandoff++;
      continue;
    }

    if (latest.status === "no_answer") stats.noAnswer++;
    else if (latest.status === "busy") stats.busy++;
    else stats.failed++;

    if (latest.nextActionStatus) stats.retrying++;
    else stats.finished++;
  }

  stats.remaining = stats.totalLeads - stats.finished;
  stats.progress = stats.totalLeads ? stats.finished / stats.totalLeads : 0;
  const reached = stats.totalLeads - stats.queued;
  stats.connectionRate = reached > 0 ? stats.connected / reached : null;
  return stats;
}

// ------------------------------------------------------------
// Webhook support
// ------------------------------------------------------------

/**
 * The campaign member an identifier refers to.
 *
 * Tringlo sends each lead's id as `user_identifier`, and Sarvam echoes it back on
 * unanswered attempts — but on connected attempts it reports the SHA-256 hex
 * of the lead's E.164 number instead (observed on real campaign data). Both
 * forms are accepted; nothing else is.
 */
export function findMember(campaign: Campaign, identifier: string | null | undefined): CampaignMember | undefined {
  if (!identifier) return undefined;
  const direct = campaign.members.find((member) => member.leadId === identifier);
  if (direct) return direct;
  const lower = identifier.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(lower)) return undefined;
  return campaign.members.find((member) => createHash("sha256").update(member.phone).digest("hex") === lower);
}

/**
 * The call record for a campaign attempt Tringlo has not seen before.
 *
 * Campaign attempts are created by Sarvam, so the first Tringlo hears of one is
 * its webhook. The lead is found by `user_identifier` (the Tringlo lead id sent
 * with the cohort), and only if it belongs to that campaign's workspace and
 * the phone number matches — a stray or forged identifier creates nothing.
 */
export function recordForCampaignAttempt(payload: {
  attempt_id: string;
  campaign_id?: string;
  cohort_id?: string;
  user_identifier?: string;
  user_phone_number?: string;
  retry_attempt?: number;
  executed_at?: string | null;
}): CallRecord | null {
  if (!payload.campaign_id || !payload.user_identifier) return null;
  const campaign = findCampaignRunByProviderId(payload.campaign_id);
  if (!campaign) return null;

  const member = findMember(campaign, payload.user_identifier);
  const lead = member ? getLead(member.leadId) : undefined;
  if (!member || !lead || !ownedByTenant(lead, campaign.tenantId)) return null;
  if (payload.user_phone_number && normalisePhone(payload.user_phone_number).national !== normalisePhone(member.phone).national) {
    return null;
  }

  return {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: campaign.tenantId,
    leadId: lead.id,
    lead,
    status: "calling",
    startedAt: null,
    endedAt: null,
    requestedAt: payload.executed_at ?? new Date().toISOString(),
    connectedAt: null,
    duration: null,
    attempts: (payload.retry_attempt ?? 0) + 1,
    transcript: null,
    transcriptTurns: null,
    aiSummary: null,
    aiResult: null,
    lastContactedAt: null,
    nextAction: null,
    humanHandoffStatus: "none",
    provider: "sarvam",
    origin: "campaign",
    providerAttemptId: payload.attempt_id,
    campaignId: campaign.id,
    providerCampaignId: payload.campaign_id,
    providerCohortId: payload.cohort_id ?? null,
    retryAttempt: payload.retry_attempt ?? 0,
  } as CallRecord;
}

export { getCampaignRun };
