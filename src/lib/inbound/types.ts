// ============================================================
// Tringlo AI — Inbound calling
// ============================================================
//
// Optional, per workspace, and OFF until someone turns it on. When it is on,
// the workspace's inbound number is attached to a Sarvam *deployment*, which
// answers calls to that number with the workspace's agent. Every finished call
// comes back through the same webhook pipeline as outbound calls, marked
// `direction: "inbound"`.
//
// Deployment status is what Sarvam last confirmed, never assumed:
//   inactive  — no deployment exists (inbound has never been enabled)
//   creating  — a create/update request is in flight
//   active    — Sarvam reports the deployment active (answering calls)
//   paused    — Sarvam reports it paused (not answering)
//   failed    — the last create/update failed; see lastError
// ============================================================

import type { Weekday } from "@/lib/campaigns/types";

export type DeploymentStatus = "inactive" | "creating" | "active" | "paused" | "failed";

export interface InboundSettings {
  tenantId: string;
  /** The switch the workspace controls. Default false. */
  enabled: boolean;

  /** The number customers dial, E.164. Belongs to one workspace only. */
  phoneNumber: string | null;
  /** Calls are answered between these times on these days, in `timezone`. */
  startTime: string;
  endTime: string;
  days: Weekday[];
  timezone: string;
  /** Where the agent transfers a caller who needs a person, E.164. */
  handoffNumber: string | null;
  /** What callers are told about availability outside business hours. */
  afterHoursMessage: string | null;

  /** Sarvam's deployment, once one exists. */
  deploymentId: string | null;
  deploymentStatus: DeploymentStatus;
  lastError: string | null;
  /** The webhook URL given to Sarvam, without its token. */
  webhookUrl: string | null;

  /** Known callers pushed to the deployment for personalisation. */
  knownCallersCohortId: string | null;
  knownCallersCount: number;
  knownCallersSyncedAt: string | null;
  /** Last attempt, successful or not — retries wait a day. */
  knownCallersAttemptAt?: string | null;
  /** Why the last attempt failed, as Sarvam put it. */
  knownCallersError?: string | null;
  /** A contact's details changed: re-send the list on the next pass. */
  knownCallersStale?: boolean;

  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Reasons a caller rings, as the inbound agent may report them. */
export const INBOUND_INTENTS = [
  "product_question",
  "sales_enquiry",
  "pricing",
  "order_support",
  "account_help",
  "technical_issue",
  "billing",
  "complaint",
  "callback_request",
  "human_request",
  "other",
] as const;

export type InboundIntent = (typeof INBOUND_INTENTS)[number];

export type ResolutionStatus = "resolved" | "escalated" | "unresolved";

export function defaultInboundSettings(tenantId: string, timezone: string): InboundSettings {
  const now = new Date().toISOString();
  return {
    tenantId,
    enabled: false,
    phoneNumber: null,
    startTime: "09:00",
    endTime: "18:00",
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    timezone,
    handoffNumber: null,
    afterHoursMessage: null,
    deploymentId: null,
    deploymentStatus: "inactive",
    lastError: null,
    webhookUrl: null,
    knownCallersCohortId: null,
    knownCallersCount: 0,
    knownCallersSyncedAt: null,
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
