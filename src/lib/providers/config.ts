// ============================================================
// Tringlo AI — Resolving a workspace's voice provider configuration
// ============================================================
//
// One entry point for "which Sarvam account, which agent, which number" so no
// call path reads the environment for a resource id again.
//
// Two rules hold this file together:
//
//   1. The credential is the platform's; the resources are the workspace's.
//   2. A workspace that has not been configured FAILS. It never borrows
//      another workspace's agent, and the environment is not a runtime
//      fallback — it seeds the original workspace once, during migration,
//      and nothing else.
// ============================================================

import { randomBytes } from "crypto";

import { getProviderConfig, saveProviderConfig } from "@/lib/db";
import { parseMappings } from "./variable-mapping";
import { businessContextReach } from "./sarvam/variables";

import {
  NOT_CONFIGURED,
  type BatchProviderConfig,
  type ConfigStatus,
  ProviderNotConfiguredError,
  type InboundProviderConfig,
  type OutboundProviderConfig,
  type PlatformCredentials,
  type ResolvedInbound,
  type ResolvedOutbound,
  type WorkspaceProviderConfig,
} from "./types";

/** Strips accidental quotes from a `.env` value written as KEY="value". */
export function readEnv(name: string): string {
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

// ------------------------------------------------------------
// Platform credentials — Tringlo's own Sarvam account
// ------------------------------------------------------------

export function platformCredentials(): PlatformCredentials | null {
  const apiKey = readEnv("SARVAM_API_KEY");
  const orgId = readEnv("SARVAM_ORG_ID");
  const workspaceId = readEnv("SARVAM_WORKSPACE_ID");
  if (!apiKey || !orgId || !workspaceId) return null;
  return { apiKey, orgId, workspaceId };
}

/** What is missing from the platform's own credentials, for the health panel. */
export function platformProblems(): string[] {
  const problems: string[] = [];
  if (!readEnv("SARVAM_API_KEY")) problems.push("SARVAM_API_KEY is not set on the server.");
  if (!readEnv("SARVAM_ORG_ID")) problems.push("SARVAM_ORG_ID is not set on the server.");
  if (!readEnv("SARVAM_WORKSPACE_ID")) problems.push("SARVAM_WORKSPACE_ID is not set on the server.");
  return problems;
}

// ------------------------------------------------------------
// Workspace configuration
// ------------------------------------------------------------

export function providerConfigFor(tenantId: string): WorkspaceProviderConfig | null {
  return getProviderConfig(tenantId) ?? null;
}

function requireCredentials(): PlatformCredentials {
  const credentials = platformCredentials();
  if (!credentials) throw new ProviderNotConfiguredError(platformProblems());
  return credentials;
}

/**
 * The agent this workspace calls out with.
 *
 * Throws `ProviderNotConfiguredError` when the workspace has not been set up.
 * It never falls back to another workspace or to the environment.
 */
export function resolveOutbound(tenantId: string): ResolvedOutbound {
  const credentials = requireCredentials();
  const config = providerConfigFor(tenantId);
  const outbound = config?.outbound;
  if (!config || !outbound) throw new ProviderNotConfiguredError([NOT_CONFIGURED]);

  const problems = outboundProblems(outbound);
  if (problems.length) throw new ProviderNotConfiguredError(problems);

  return { credentials, outbound, webhookToken: config.webhookToken };
}

/** Like `resolveOutbound`, but reports the problem instead of throwing. */
export function tryResolveOutbound(tenantId: string): { ok: true; value: ResolvedOutbound } | { ok: false; problems: string[] } {
  try {
    return { ok: true, value: resolveOutbound(tenantId) };
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) return { ok: false, problems: error.problems };
    throw error;
  }
}

export function resolveInbound(tenantId: string): ResolvedInbound {
  const credentials = requireCredentials();
  const config = providerConfigFor(tenantId);
  const inbound = config?.inbound;
  if (!config || !inbound) {
    throw new ProviderNotConfiguredError(["No inbound agent is configured for this workspace."]);
  }

  const problems = inboundProblems(inbound);
  if (problems.length) throw new ProviderNotConfiguredError(problems);

  return { credentials, inbound, webhookToken: config.webhookToken };
}

/**
 * The campaign settings for one workspace.
 *
 * A workspace configured before campaigns were set up here has none, and falls
 * back to its single-call settings — which is exactly what campaigns used
 * before. It never falls back to another workspace.
 */
export function resolveBatch(tenantId: string): { batch: BatchProviderConfig; inherited: boolean } | null {
  const config = providerConfigFor(tenantId);
  if (config?.batch) {
    // A campaign that lists nothing of its own may borrow the single-call
    // agent's variables, but only when it is that same agent, at that same
    // version. A different agent declares different names, and handing it
    // another agent's list is how a whole campaign gets refused.
    //
    // Normalised on the way out: a batch saved by an older path can be missing
    // `agentVariables` entirely, and reading `.length` off it crashed the
    // whole provider-config endpoint — which is what left every section of the
    // agent page showing "Not set".
    const batch = {
      ...config.batch,
      agentVariables: config.batch.agentVariables ?? [],
      variableMappings: config.batch.variableMappings ?? [],
    };
    const sameAgent =
      Boolean(config.outbound) &&
      batch.appId === config.outbound!.appId &&
      batch.appVersion === config.outbound!.appVersion;
    const listsNothing = batch.agentVariables.length === 0 && (batch.variableMappings ?? []).length === 0;
    if (sameAgent && listsNothing) {
      return {
        inherited: true,
        batch: {
          ...batch,
          agentVariables: config.outbound!.agentVariables,
          variableMappings: config.outbound!.variableMappings,
        },
      };
    }
    return { batch, inherited: false };
  }

  const outbound = config?.outbound;
  if (!outbound) return null;
  return {
    inherited: true,
    batch: {
      appId: outbound.appId,
      appVersion: outbound.appVersion,
      appType: "agent",
      connectionId: outbound.connectionId,
      phoneNumbers: outbound.phoneNumber.split(",").map((value) => value.trim()).filter(Boolean),
      attemptsPerSecond: 1,
      // The same agent and version, so the same declared variables. A
      // campaign on a different agent carries its own; see BatchProviderConfig.
      agentVariables: outbound.agentVariables,
      variableMappings: outbound.variableMappings,
      cohortMode: "stream",
      retry: { maxRetries: 2, intervalMinutes: 30, onBusy: true, onNoAnswer: true, onFailed: false, onShortDuration: false, shortDurationSeconds: 25 },
      schedule: { timezone: "Asia/Kolkata", startTime: "09:00", endTime: "19:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    },
  };
}

export function tryResolveInbound(tenantId: string): { ok: true; value: ResolvedInbound } | { ok: false; problems: string[] } {
  try {
    return { ok: true, value: resolveInbound(tenantId) };
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) return { ok: false, problems: error.problems };
    throw error;
  }
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

export function outboundProblems(outbound: Partial<OutboundProviderConfig> | null | undefined): string[] {
  const problems: string[] = [];
  if (!outbound?.appId?.trim()) problems.push("The outbound agent ID is not set for this workspace.");
  if (!Number.isInteger(outbound?.appVersion) || (outbound?.appVersion ?? 0) < 1) {
    problems.push("The outbound agent version must be a whole number, 1 or more.");
  }
  if (!outbound?.connectionId?.trim()) problems.push("The outbound telephony connection ID is not set.");
  if (!outbound?.phoneNumber?.trim()) problems.push("The outbound caller number is not set.");
  return problems;
}

/**
 * Which of the four schema states a saved agent is in.
 *
 * An explicit mapping or list is a declaration. Nothing at all is "none" —
 * said out loud, so a workspace saved today is never mistaken for one that
 * predates per-agent variables and swept up by the legacy migration.
 */
function schemaSource(
  outbound: { agentVariables?: string[] | null; variableMappings?: unknown; variableSchemaSource?: unknown }
): "legacy_default" | "declared" | "none" {
  if (outbound.variableSchemaSource === "legacy_default") return "legacy_default";
  const declared = cleanList(outbound.agentVariables).length > 0 || parseMappings(outbound.variableMappings).length > 0;
  return declared ? "declared" : "none";
}

export function batchProblems(batch: Partial<BatchProviderConfig> | null | undefined): string[] {
  const problems: string[] = [];
  if (!batch?.appId?.trim()) problems.push("The campaign agent ID is not set for this workspace.");
  if (!Number.isInteger(batch?.appVersion) || (batch?.appVersion ?? 0) < 1) {
    problems.push("The campaign agent version must be a whole number, 1 or more.");
  }
  if (!batch?.connectionId?.trim()) problems.push("The campaign telephony connection ID is not set.");
  if (!batch?.phoneNumbers?.length) problems.push("Campaigns need at least one number to dial from.");
  if (!Number.isFinite(batch?.attemptsPerSecond) || (batch?.attemptsPerSecond ?? 0) <= 0) {
    problems.push("Set how many calls a second a campaign may place.");
  }
  if (batch?.cohortMode === "upload") {
    problems.push("Cohort upload is not confirmed against Sarvam yet. Use streaming, which is the tested path.");
  }
  const schedule = batch?.schedule;
  if (!schedule?.days?.length) problems.push("Choose the days campaigns may call on.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule?.startTime ?? "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule?.endTime ?? "")) {
    problems.push("Campaign calling hours must be HH:MM.");
  } else if ((schedule?.endTime ?? "") <= (schedule?.startTime ?? "")) {
    problems.push("Campaign calling hours must end after they start.");
  }
  return problems;
}

export function inboundProblems(inbound: Partial<InboundProviderConfig> | null | undefined): string[] {
  const problems: string[] = [];
  if (!inbound?.appId?.trim()) problems.push("The inbound agent ID is not set for this workspace.");
  if (!Number.isInteger(inbound?.appVersion) || (inbound?.appVersion ?? 0) < 1) {
    problems.push("The inbound agent version must be a whole number, 1 or more.");
  }
  if (!inbound?.connectionId?.trim()) problems.push("The inbound telephony connection ID is not set.");
  return problems;
}

// ------------------------------------------------------------
// Writing
// ------------------------------------------------------------

export interface ProviderConfigInput {
  outbound?: Partial<OutboundProviderConfig> | null;
  batch?: Partial<BatchProviderConfig> | null;
  inbound?: Partial<InboundProviderConfig> | null;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return typeof value === "string" ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Saves what an administrator entered. Only resource ids — the API key is the
 * platform's and is never accepted here.
 */
export function saveWorkspaceProvider(
  tenantId: string,
  input: ProviderConfigInput,
  updatedBy: string | null
): { ok: boolean; problems: string[]; config?: WorkspaceProviderConfig } {
  const existing = providerConfigFor(tenantId);
  const problems: string[] = [];

  let outbound: OutboundProviderConfig | null = existing?.outbound ?? null;
  if (input.outbound !== undefined) {
    if (input.outbound === null) {
      outbound = null;
    } else {
      const candidate: OutboundProviderConfig = {
        appId: text(input.outbound.appId),
        appVersion: Number(input.outbound.appVersion),
        connectionId: text(input.outbound.connectionId),
        phoneNumber: text(input.outbound.phoneNumber),
        agentName: text(input.outbound.agentName) || null,
        agentVariables: cleanList(input.outbound.agentVariables),
        variableMappings: parseMappings(input.outbound.variableMappings),
        variableSchemaSource: schemaSource(input.outbound),
        ...(input.outbound.useOwnGreeting === undefined ? {} : { useOwnGreeting: Boolean(input.outbound.useOwnGreeting) }),
      };
      problems.push(...outboundProblems(candidate));
      outbound = candidate;
    }
  }

  let batch: BatchProviderConfig | null = existing?.batch ?? null;
  if (input.batch !== undefined) {
    if (input.batch === null) {
      batch = null;
    } else {
      const candidate: BatchProviderConfig = {
        appId: text(input.batch.appId),
        appVersion: Number(input.batch.appVersion),
        appType: text(input.batch.appType) || "agent",
        connectionId: text(input.batch.connectionId),
        phoneNumbers: cleanList(input.batch.phoneNumbers),
        attemptsPerSecond: Number(input.batch.attemptsPerSecond),
        agentVariables: cleanList(input.batch.agentVariables),
        variableMappings: parseMappings(input.batch.variableMappings),
        cohortMode: input.batch.cohortMode === "upload" ? "upload" : "stream",
        retry: {
          maxRetries: Number(input.batch.retry?.maxRetries ?? 2),
          intervalMinutes: Number(input.batch.retry?.intervalMinutes ?? 30),
          onBusy: Boolean(input.batch.retry?.onBusy ?? true),
          onNoAnswer: Boolean(input.batch.retry?.onNoAnswer ?? true),
          onFailed: Boolean(input.batch.retry?.onFailed ?? false),
          onShortDuration: Boolean(input.batch.retry?.onShortDuration ?? false),
          shortDurationSeconds: Number(input.batch.retry?.shortDurationSeconds ?? 25),
        },
        schedule: {
          timezone: text(input.batch.schedule?.timezone) || "Asia/Kolkata",
          startTime: text(input.batch.schedule?.startTime) || "09:00",
          endTime: text(input.batch.schedule?.endTime) || "19:00",
          days: Array.isArray(input.batch.schedule?.days) ? input.batch.schedule!.days : [],
        },
      };
      problems.push(...batchProblems(candidate));
      batch = candidate;
    }
  }

  let inbound: InboundProviderConfig | null = existing?.inbound ?? null;
  if (input.inbound !== undefined) {
    if (input.inbound === null) {
      inbound = null;
    } else {
      const candidate: InboundProviderConfig = {
        appId: text(input.inbound.appId),
        appVersion: Number(input.inbound.appVersion),
        connectionId: text(input.inbound.connectionId),
        agentVariables: cleanList(input.inbound.agentVariables),
        variableMappings: parseMappings(input.inbound.variableMappings),
      };
      problems.push(...inboundProblems(candidate));
      inbound = candidate;
    }
  }

  if (problems.length) return { ok: false, problems };

  const config = saveProviderConfig({
    tenantId,
    outbound,
    batch,
    inbound,
    webhookToken: existing?.webhookToken ?? newWebhookToken(),
    seededFromEnv: existing?.seededFromEnv,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  });
  console.log(`PROVIDER_CONFIG_SAVED tenant=${tenantId} outbound=${Boolean(outbound)} batch=${Boolean(batch)} inbound=${Boolean(inbound)}`);
  return { ok: true, problems: [], config };
}

/** A workspace's webhook token. Long enough that guessing one is not a strategy. */
export function newWebhookToken(): string {
  return `ws_${randomBytes(24).toString("hex")}`;
}

/**
 * True only when a real provider check succeeded and nothing has been edited
 * since. A check older than the last change says nothing about what is stored
 * now, so it stops counting.
 */
function verifiedNow(config: WorkspaceProviderConfig | null | undefined): boolean {
  if (!config?.verifiedAt) return false;
  return new Date(config.verifiedAt).getTime() >= new Date(config.updatedAt).getTime();
}

/**
 * Whether this workspace could actually hand a lead set to Sarvam.
 *
 * Streaming is Sarvam's documented route for submitting contacts by API, and
 * the one Tringlo uses. A CSV upload additionally needs the
 * cohort_transformation_file schema, which Sarvam's API reference does not
 * publish, so a workspace set to upload is valid but cannot run.
 */
function leadSubmissionStatus(batch: BatchProviderConfig | null): ConfigStatus {
  if (!batch) return "incomplete";
  return batch.cohortMode === "upload" ? "unavailable" : "saved";
}

/** Records that a provider check actually reached Sarvam and passed. */
export function markProviderVerified(tenantId: string): void {
  const config = providerConfigFor(tenantId);
  if (!config) return;
  saveProviderConfig({ ...config, verifiedAt: new Date().toISOString() });
}

/** What the browser may know: resource ids, never the credential. */
export function publicProviderConfig(tenantId: string) {
  const config = providerConfigFor(tenantId);
  const credentials = platformCredentials();
  const batch = resolveBatch(tenantId);
  return {
    outbound: config?.outbound ?? null,
    batch: config?.batch ?? null,
    inbound: config?.inbound ?? null,
    configured: Boolean(config?.outbound),
    /** What each calling method's configuration actually amounts to. */
    status: {
      singleOutbound: !config?.outbound
        ? "incomplete"
        : outboundProblems(config.outbound).length > 0
          ? "error"
          : verifiedNow(config)
            ? "verified"
            : "saved",
      batchOutbound: !config?.batch
        ? batch
          ? "inherited"
          : "incomplete"
        : batchProblems(config.batch).length > 0
          ? "error"
          : verifiedNow(config)
            ? "verified"
            : "saved",
      // Submitting the leads is the part that can be valid yet unrunnable: a
      // CSV upload needs a transformation format Sarvam has not published.
      leadSubmission: leadSubmissionStatus(config?.batch ?? batch?.batch ?? null),
      inbound: !config?.inbound
        ? "off"
        : inboundProblems(config.inbound).length > 0
          ? "error"
          : verifiedNow(config)
            ? "verified"
            : "saved",
    } satisfies Record<string, ConfigStatus>,
    // Only whether the platform can reach Sarvam at all — never the values.
    platform: {
      ready: Boolean(credentials),
      problems: platformProblems(),
    },
    // Whether this workspace's business information can actually reach its
    // outbound agent. When it cannot, the agent speaks from its own
    // provider-side prompt and nothing configured here touches the call —
    // which is exactly how an agent ends up talking about the wrong business.
    // Names and counts only; never a value.
    businessContext: config?.outbound
      ? businessContextReach(config.outbound.agentVariables, config.outbound.variableMappings)
      : null,
    updatedAt: config?.updatedAt ?? null,
  };
}

// ------------------------------------------------------------
// The agent a past call ran on
// ------------------------------------------------------------

/**
 * Which Sarvam agent to ask about a call that has already happened — for its
 * recording, or its status in analytics.
 *
 * The agent recorded on the call wins: a workspace that later changes its
 * agent must still be able to play yesterday's recording. Older calls, from
 * before the agent was recorded, fall back to the workspace's current agent
 * for that direction.
 */
export function resolveCallAgent(record: {
  tenantId?: string | null;
  direction?: "outbound" | "inbound" | null;
  providerAppId?: string | null;
}): { credentials: PlatformCredentials; appId: string } | null {
  const credentials = platformCredentials();
  if (!credentials) return null;

  if (record.providerAppId) return { credentials, appId: record.providerAppId };

  const tenantId = record.tenantId;
  if (!tenantId) return null;
  const config = providerConfigFor(tenantId);
  const appId = record.direction === "inbound" ? config?.inbound?.appId : config?.outbound?.appId;
  return appId ? { credentials, appId } : null;
}
