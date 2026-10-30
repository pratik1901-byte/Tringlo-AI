// ============================================================
// Tringlo AI — creating a workspace
// ============================================================
//
// One place that turns a filled-in creation form into a workspace, used by
// both routes that make one:
//
//   POST /api/workspaces        an account adding another company
//   POST /api/auth/bootstrap    first run, when no account exists yet
//
// They differ only in who is asking. What a workspace *is* — its company
// profile, its own Sarvam agent and numbers, its own inbound line, switched
// off — is decided here, so the two cannot drift apart.
//
// Nothing is copied from another workspace. A new workspace starts with its
// own empty leads, calls, customers and memory, and the configuration the
// form supplied and nothing else.
// ============================================================

import {
  deleteTenant,
  grantMembership,
  saveAgentConfig,
  saveInboundSettings,
  saveTenant,
} from "@/lib/db";
import { defaultInboundSettings } from "@/lib/inbound/types";
import { validateInboundInput, type InboundSettingsInput } from "@/lib/inbound/service";
import { batchProblems, inboundProblems, outboundProblems, saveWorkspaceProvider } from "@/lib/providers/config";
import type { AgentConfig, Tenant } from "@/lib/types";

export interface WorkspaceDraft {
  businessName: string;
  company: Partial<AgentConfig>;
  outbound: Parameters<typeof saveWorkspaceProvider>[1]["outbound"];
  batch: Parameters<typeof saveWorkspaceProvider>[1]["batch"];
  inboundAgent: Parameters<typeof saveWorkspaceProvider>[1]["inbound"];
  inboundLine: InboundSettingsInput | null;
}

export interface WorkspaceCreated {
  ok: true;
  tenant: Tenant;
}
export interface WorkspaceRefused {
  ok: false;
  problems: string[];
}

/**
 * Everything wrong with the form, checked before anything is written.
 *
 * A workspace that exists but cannot place a call is worse than one the form
 * refused to make, so this runs to completion and reports all of it.
 */
export function workspaceDraftProblems(draft: WorkspaceDraft): string[] {
  const problems: string[] = [];
  if (!draft.businessName.trim()) problems.push("A business name is required.");
  if (!draft.company.companyName) {
    problems.push("Enter the company name — the agent introduces itself with it on every call.");
  }
  problems.push(...outboundProblems(draft.outbound ?? undefined));
  problems.push(...batchProblems(draft.batch ?? undefined));
  if (draft.inboundAgent) problems.push(...inboundProblems(draft.inboundAgent));
  if (draft.inboundLine) {
    // A tenant id that cannot collide, only so the number can be checked
    // against the lines that already exist.
    problems.push(...validateInboundInput(`pending_${Date.now()}`, draft.inboundLine).problems);
  }
  return problems;
}

/**
 * Creates the workspace and makes `ownerUserId` its owner.
 *
 * The owner is always the authenticated account the caller resolved; this
 * function is never given a user id from a request body.
 *
 * If any part of the setup fails the whole workspace is removed again: half a
 * workspace is not a workspace.
 */
export function createWorkspace(draft: WorkspaceDraft, ownerUserId: string, createdBy: string | null = null): WorkspaceCreated | WorkspaceRefused {
  const problems = workspaceDraftProblems(draft);
  if (problems.length) return { ok: false, problems };

  const now = new Date().toISOString();
  const tenant: Tenant = {
    id: `tenant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: draft.businessName.trim(),
    createdAt: now,
  };
  saveTenant(tenant);

  try {
    grantMembership({ userId: ownerUserId, tenantId: tenant.id, role: "owner", createdBy });
    saveAgentConfig(tenant.id, draft.company);
    saveWorkspaceProvider(
      tenant.id,
      { outbound: draft.outbound, batch: draft.batch, inbound: draft.inboundAgent },
      ownerUserId
    );

    if (draft.inboundLine) {
      // Stored, switched off. A deployment answers calls the moment it exists,
      // so going live stays an explicit act in Settings.
      const base = defaultInboundSettings(tenant.id, draft.inboundLine.timezone);
      saveInboundSettings({
        ...base,
        enabled: false,
        phoneNumber: draft.inboundLine.phoneNumber,
        startTime: draft.inboundLine.startTime,
        endTime: draft.inboundLine.endTime,
        days: draft.inboundLine.days,
        timezone: draft.inboundLine.timezone,
        handoffNumber: draft.inboundLine.handoffNumber,
        afterHoursMessage: draft.inboundLine.afterHoursMessage,
        deploymentId: draft.inboundLine.deploymentId ?? null,
      });
    }
  } catch (error) {
    deleteTenant(tenant.id);
    console.error("WORKSPACE_SETUP_FAILED", error instanceof Error ? error.message : error);
    return { ok: false, problems: ["The workspace could not be set up, so nothing was created. Try again."] };
  }

  console.log(`WORKSPACE_CREATED tenant=${tenant.id} owner=${ownerUserId}`);
  return { ok: true, tenant };
}

/**
 * Reads a creation form into a draft.
 *
 * Shared so the two routes accept exactly the same shape, and so the wizard
 * has one payload to send whichever of them it is talking to.
 */
/** A comma-separated string or a list; either way, the names as written. */
function variableNames(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return raw.map((name) => String(name).trim()).filter(Boolean);
}

export function readWorkspaceDraft(body: Record<string, unknown>): WorkspaceDraft {
  const text = (source: Record<string, unknown>, key: string) =>
    typeof source[key] === "string" ? (source[key] as string).trim() : "";

  const rawCompany = (body.company ?? {}) as Record<string, unknown>;
  const company: Partial<AgentConfig> = {
    companyName: text(rawCompany, "companyName"),
    industry: text(rawCompany, "industry"),
    companyDescription: text(rawCompany, "companyDescription"),
    productName: text(rawCompany, "productName"),
    productDescription: text(rawCompany, "productDescription"),
    salesObjective: text(rawCompany, "salesObjective"),
    faqs: text(rawCompany, "faqs"),
    agentName: text(rawCompany, "agentName"),
  };

  const rawOutbound = (body.outbound ?? {}) as Record<string, unknown>;
  const outbound = {
    appId: text(rawOutbound, "appId"),
    appVersion: Number(rawOutbound.appVersion),
    connectionId: text(rawOutbound, "connectionId"),
    phoneNumber: text(rawOutbound, "phoneNumber"),
    agentName: text(rawOutbound, "agentName") || text(rawCompany, "agentName") || null,
    agentVariables: variableNames(rawOutbound.agentVariables),
  };

  const rawBatch = (body.batch ?? {}) as Record<string, unknown>;
  const rawRetry = (rawBatch.retry ?? {}) as Record<string, unknown>;
  const rawSchedule = (rawBatch.schedule ?? {}) as Record<string, unknown>;
  const batch = {
    appId: text(rawBatch, "appId") || outbound.appId,
    appVersion: Number(rawBatch.appVersion) || outbound.appVersion,
    appType: text(rawBatch, "appType") || "agent",
    // A campaign that runs the single-call agent declares the same variables.
    agentVariables: variableNames(rawBatch.agentVariables).length
      ? variableNames(rawBatch.agentVariables)
      : outbound.agentVariables,
    connectionId: text(rawBatch, "connectionId") || outbound.connectionId,
    phoneNumbers: Array.isArray(rawBatch.phoneNumbers)
      ? (rawBatch.phoneNumbers as unknown[]).map((v) => String(v).trim()).filter(Boolean)
      : outbound.phoneNumber
        ? [outbound.phoneNumber]
        : [],
    attemptsPerSecond: Number(rawBatch.attemptsPerSecond) || 1,
    cohortMode: rawBatch.cohortMode === "upload" ? ("upload" as const) : ("stream" as const),
    retry: {
      maxRetries: Number(rawRetry.maxRetries ?? 2),
      intervalMinutes: Number(rawRetry.intervalMinutes ?? 30),
      onBusy: rawRetry.onBusy !== false,
      onNoAnswer: rawRetry.onNoAnswer !== false,
      onFailed: Boolean(rawRetry.onFailed),
      onShortDuration: Boolean(rawRetry.onShortDuration),
      shortDurationSeconds: Number(rawRetry.shortDurationSeconds ?? 25),
    },
    schedule: {
      timezone: text(rawSchedule, "timezone") || "Asia/Kolkata",
      startTime: text(rawSchedule, "startTime") || "09:00",
      endTime: text(rawSchedule, "endTime") || "19:00",
      days: Array.isArray(rawSchedule.days)
        ? (rawSchedule.days as string[])
        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    },
  };

  const rawInbound = body.inbound ? ((body.inbound ?? {}) as Record<string, unknown>) : null;
  const inboundAgent = rawInbound
    ? {
        appId: text(rawInbound, "appId") || outbound.appId,
        appVersion: Number(rawInbound.appVersion) || outbound.appVersion,
        connectionId: text(rawInbound, "connectionId") || outbound.connectionId,
        agentVariables: [] as string[],
      }
    : null;
  const inboundLine: InboundSettingsInput | null = rawInbound
    ? {
        phoneNumber: text(rawInbound, "phoneNumber"),
        startTime: text(rawInbound, "startTime") || "09:00",
        endTime: text(rawInbound, "endTime") || "18:00",
        days: Array.isArray(rawInbound.days)
          ? (rawInbound.days as InboundSettingsInput["days"])
          : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        timezone: text(rawInbound, "timezone") || "Asia/Kolkata",
        handoffNumber: text(rawInbound, "handoffNumber") || null,
        afterHoursMessage: text(rawInbound, "afterHoursMessage") || null,
        deploymentId: text(rawInbound, "deploymentId") || null,
      }
    : null;

  return {
    businessName: typeof body.businessName === "string" ? body.businessName.trim() : "",
    company,
    outbound,
    batch,
    inboundAgent,
    inboundLine,
  };
}
