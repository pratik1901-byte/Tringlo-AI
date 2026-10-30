// ============================================================
// Tringlo AI — Campaign results from Sarvam's records
// ============================================================
//
// The campaign webhook is the fast path for results, but it is only as good as
// the URL it was given at launch. A dev tunnel that restarts gets a new
// address, and every result Sarvam posts afterwards goes nowhere — which is
// exactly how a real campaign lost all of its results.
//
// So results are also pulled. Sarvam keeps every attempt in its analytics:
//
//   GET /api/analytics/v1/{org}/{ws}/{app}/attempts            (filtered by campaign_id)
//   GET /api/analytics/v1/{org}/{ws}/{app}/transcripts/{interaction_id}
//
// Each attempt is turned into the same shape the campaign webhook carries and
// handed to the same reducer, so a pulled result and a pushed one are
// indistinguishable afterwards: one call record per attempt (keyed by
// attempt_id, so pulling twice changes nothing), memory updated, any callback
// the customer asked for scheduled, the recording fetched.
//
// Read-only towards Sarvam. Nothing here can place a call.
// ============================================================

import { applySarvamEvent } from "@/lib/calls/service";
import { platformCredentials } from "@/lib/providers/config";
import { getAllCampaignRuns, getCallRecordByAttemptId, getCampaignRun, saveCampaignRun, updateCallRecord } from "@/lib/db";
import { isInstructionText, withoutInstructions } from "@/lib/providers/sarvam/instruction-text";
import type { SarvamWebhookPayload } from "@/lib/providers/sarvam/types";
import { isTerminalCallStatus, type CallRecord } from "@/lib/types";

import { findMember, syncCampaign } from "./service";
import type { Campaign } from "./types";

const ANALYTICS = "https://apps.sarvam.ai/api/analytics/v1";
const PAGE = 100;
/** How long a missing transcript is still worth asking Sarvam for. */
const TRANSCRIPT_GRACE_MS = 60 * 60 * 1000;

interface AnalyticsAttempt {
  attempt_id?: string | null;
  interaction_id?: string | null;
  user_identifier?: string | null;
  connectivity_status?: string | null;
  failure_reason?: string | null;
  ended_by?: string | null;
  duration_in_seconds?: number | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
  retry_attempt?: number | null;
  campaign_id?: string | null;
  cohort_id?: string | null;
  agent_variables?: Record<string, unknown> | null;
}

/** Sarvam writes these instead of null when it has nothing to say. */
function real(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^NO_[A-Z_]+$/.test(value) ? null : value;
}

const TEXT_FIELDS = [
  "aiSummary",
  "objection",
  "customerRequirement",
  "painPoints",
  "budgetIndication",
  "timelineToDecide",
  "authorityLevel",
  "competitorMentioned",
  "chosenNextStep",
  "nextAction",
] as const;

/** Clears instruction text already stored on a call (from before it was filtered). */
function scrubInstructions(record: CallRecord) {
  const updates: Partial<CallRecord> = {};
  for (const field of TEXT_FIELDS) {
    const value = record[field];
    if (isInstructionText(value)) updates[field] = null;
  }
  if (Object.keys(updates).length > 0) {
    updateCallRecord(record.id, updates);
    console.log(`CAMPAIGN_SYNC_SCRUBBED call=${record.id} fields=${Object.keys(updates).join(",")}`);
  }
}

/** Analytics timestamps are naive UTC (`2026-10-01T04:30:26`). */
function utc(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function get<T>(apiKey: string, path: string): Promise<T> {
  const response = await fetch(`${ANALYTICS}/${path}`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Sarvam analytics returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

function appPath(campaign: Campaign): { apiKey: string; path: string } | null {
  const credentials = platformCredentials();
  const app = campaign.appId;
  if (!credentials || !app) return null;
  const { apiKey, orgId: org, workspaceId: workspace } = credentials;
  return {
    apiKey,
    path: `${encodeURIComponent(org)}/${encodeURIComponent(workspace)}/${encodeURIComponent(app)}`,
  };
}

async function listAttempts(apiKey: string, base: string, campaign: Campaign): Promise<AnalyticsAttempt[]> {
  const from = new Date(new Date(campaign.launchedAt ?? campaign.createdAt).getTime() - 60 * 60 * 1000).toISOString();
  const to = new Date(Math.min(Date.now() + 5 * 60 * 1000, new Date(campaign.schedule.end).getTime() + 24 * 60 * 60 * 1000)).toISOString();
  const filter = JSON.stringify([{ id: "1", field: "campaign_id", operator: "equals", value: campaign.providerCampaignId }]);

  const all: AnalyticsAttempt[] = [];
  for (let offset = 0; offset < 20_000; offset += PAGE) {
    const page = await get<{ items?: AnalyticsAttempt[]; total?: number }>(apiKey, `${base}/attempts?start_datetime=${encodeURIComponent(from)}&end_datetime=${encodeURIComponent(to)}` +
        `&limit=${PAGE}&offset=${offset}&sort_by=start_datetime&sort_order=asc&filter_conditions=${encodeURIComponent(filter)}`
    );
    const items = Array.isArray(page.items) ? page.items : [];
    all.push(...items);
    if (items.length < PAGE || all.length >= (page.total ?? 0)) break;
  }
  // The filter is Sarvam's; the check is ours.
  return all.filter((attempt) => attempt.campaign_id === campaign.providerCampaignId);
}

/** The transcript in the webhook's shape: [{ role, en_text }]. */
async function transcriptFor(apiKey: string, base: string, interactionId: string) {
  const body = await get<{ messages?: Array<{ role?: string; content?: string }> }>(
    apiKey,
    `${base}/transcripts/${encodeURIComponent(interactionId)}`
  );
  return (body.messages ?? [])
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .map((message) => ({
      role: message.role === "assistant" ? "agent" : message.role === "user" ? "user" : (message.role ?? "user"),
      en_text: (message.content ?? "").trim(),
    }));
}

/** Records the sync on a fresh copy, so a status change made meanwhile is kept. */
function stamp(campaign: Campaign, error: string | null) {
  const fresh = getCampaignRun(campaign.tenantId, campaign.id) ?? campaign;
  saveCampaignRun({ ...fresh, lastResultsSyncAt: new Date().toISOString(), lastResultsSyncError: error });
}

export interface SyncResult {
  ok: boolean;
  found: number;
  applied: number;
  unchanged: number;
  skipped: number;
  error?: string;
}

/**
 * Pulls every attempt Sarvam recorded for a campaign into Tringlo.
 *
 * Safe to run any number of times: an attempt already settled is skipped,
 * and the reducer ignores a repeat of anything it has applied.
 */
const inFlight = new Set<string>();

export async function syncCampaignResults(campaign: Campaign): Promise<SyncResult> {
  const result: SyncResult = { ok: true, found: 0, applied: 0, unchanged: 0, skipped: 0 };
  // One pull per campaign at a time (background tick vs. a page refresh).
  if (inFlight.has(campaign.id)) return result;
  inFlight.add(campaign.id);
  try {
    return await pull(campaign, result);
  } finally {
    inFlight.delete(campaign.id);
  }
}

async function pull(campaign: Campaign, result: SyncResult): Promise<SyncResult> {
  const endpoint = appPath(campaign);
  if (!endpoint || !campaign.providerCampaignId) {
    return { ...result, ok: false, error: "Sarvam is not configured for this campaign's workspace." };
  }
  const { apiKey, path: base } = endpoint;

  let attempts: AnalyticsAttempt[];
  try {
    attempts = await listAttempts(apiKey, base, campaign);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read Sarvam's call records.";
    stamp(campaign, message);
    return { ...result, ok: false, error: message };
  }
  result.found = attempts.length;

  for (const attempt of attempts) {
    const attemptId = attempt.attempt_id;
    const status = (attempt.connectivity_status ?? "").toLowerCase();
    // Still ringing, or not an attempt at all.
    if (!attemptId || !["connected", "no_answer", "busy", "failed"].includes(status)) {
      result.skipped++;
      continue;
    }

    // Settled already. A connected call with no transcript is looked at again
    // only during its first hour, in case Sarvam publishes the transcript late.
    const existing = getCallRecordByAttemptId(attemptId);
    if (existing) scrubInstructions(existing);
    if (existing && isTerminalCallStatus(existing.status)) {
      const endedAt = new Date(existing.endedAt ?? existing.requestedAt ?? 0).getTime();
      const awaitingTranscript =
        existing.status === "connected" && !existing.transcriptTurns?.length && Date.now() - endedAt < TRANSCRIPT_GRACE_MS;
      if (!awaitingTranscript) {
        result.unchanged++;
        continue;
      }
    }

    const member = findMember(campaign, attempt.user_identifier);
    if (!member) {
      result.skipped++;
      continue;
    }

    const interactionId = real(attempt.interaction_id);
    const connected = status === "connected";
    let transcript: Array<{ role: string; en_text: string }> | null = null;
    if (connected && interactionId) {
      try {
        transcript = await transcriptFor(apiKey, base, interactionId);
      } catch (error) {
        console.warn(`CAMPAIGN_SYNC_TRANSCRIPT_FAILED attempt=${attemptId}`, error instanceof Error ? error.message : error);
      }
    }

    const startedAt = utc(attempt.start_datetime);
    const endedAt = utc(attempt.end_datetime);
    const payload: SarvamWebhookPayload = {
      attempt_id: attemptId,
      campaign_id: campaign.providerCampaignId,
      cohort_id: attempt.cohort_id ?? undefined,
      user_identifier: member.leadId,
      user_phone_number: member.phone,
      connectivity_status: status,
      completion_status: connected ? "completed" : "failed",
      // Not in the analytics record; whether Sarvam retries is visible as the
      // next attempt, when it happens.
      next_action_status: null,
      failure_reason: real(attempt.failure_reason),
      duration: connected && typeof attempt.duration_in_seconds === "number" ? attempt.duration_in_seconds : null,
      interaction_id: connected ? interactionId : null,
      // Analytics counts attempts from 1; the webhook counts retries from 0.
      retry_attempt: Math.max(0, (attempt.retry_attempt ?? 1) - 1),
      start_datetime: startedAt,
      end_datetime: endedAt,
      output_agent_variables: connected ? (withoutInstructions(attempt.agent_variables) as SarvamWebhookPayload["output_agent_variables"]) : null,
      interaction_transcript: transcript as SarvamWebhookPayload["interaction_transcript"],
      metadata: { source: "sarvam_analytics", dialo_campaign_id: campaign.id },
    };

    const applied = applySarvamEvent(payload);
    if (applied.outcome === "applied") {
      result.applied++;
      // An unanswered attempt has no clock in Sarvam's record; leave the time
      // blank rather than stamping it with "now".
      if (!startedAt && !endedAt && applied.callId) updateCallRecord(applied.callId, { endedAt: null, lastContactedAt: null });
    } else {
      result.unchanged++;
    }
  }

  stamp(campaign, null);
  console.log(`CAMPAIGN_RESULTS_SYNCED campaign=${campaign.id} found=${result.found} applied=${result.applied} unchanged=${result.unchanged} skipped=${result.skipped}`);
  return result;
}

// ------------------------------------------------------------
// Background sync, from the scheduler tick
// ------------------------------------------------------------

const LIVE_EVERY_MS = 60 * 1000;
const FINISHED_EVERY_MS = 10 * 60 * 1000;
/** Results for an ended campaign are still looked for this long afterwards. */
const FINISHED_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

let running = false;

/**
 * Keeps every campaign's results current without anyone opening the page.
 * Running campaigns about once a minute; finished ones every ten minutes for
 * two days, to catch late attempts. One pass at a time.
 */
export async function syncDueCampaigns(now = Date.now()): Promise<number> {
  if (running || !platformCredentials()) return 0;
  running = true;
  let synced = 0;
  try {
    for (const campaign of getAllCampaignRuns()) {
      if (!campaign.providerCampaignId || campaign.status === "failed" || campaign.status === "launching") continue;
      const live = campaign.status === "active" || campaign.status === "scheduled" || campaign.status === "paused";
      const endedAt = new Date(campaign.schedule.end).getTime();
      if (!live && now - Math.max(endedAt, new Date(campaign.updatedAt).getTime()) > FINISHED_WINDOW_MS) continue;
      const last = campaign.lastResultsSyncAt ? new Date(campaign.lastResultsSyncAt).getTime() : 0;
      if (now - last < (live ? LIVE_EVERY_MS : FINISHED_EVERY_MS)) continue;

      const current = live ? await syncCampaign(campaign) : campaign;
      await syncCampaignResults(current);
      synced++;
    }
  } catch (error) {
    console.error("CAMPAIGN_SYNC_TICK_FAILED", error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
  return synced;
}
