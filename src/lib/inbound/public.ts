// ============================================================
// Tringlo AI — Inbound settings as the browser sees them
// ============================================================
//
// The browser gets what the workspace entered and plain statuses. The webhook
// address (it carries no token in storage, but is still infrastructure) and
// cohort ids stay on the server.
// ============================================================

import { WEEKDAYS, type Weekday } from "@/lib/campaigns/types";

import type { InboundSettingsInput } from "./service";
import type { InboundSettings } from "./types";

export interface PublicInboundSettings {
  enabled: boolean;
  phoneNumber: string | null;
  startTime: string;
  endTime: string;
  days: Weekday[];
  timezone: string;
  handoffNumber: string | null;
  afterHoursMessage: string | null;
  deploymentStatus: InboundSettings["deploymentStatus"];
  hasDeployment: boolean;
  /** Shown so an administrator can see and replace what Tringlo is pointed at. */
  deploymentId: string | null;
  lastError: string | null;
  knownCallersCount: number;
  knownCallersSyncedAt: string | null;
  knownCallersError: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
}

export function publicInboundSettings(settings: InboundSettings): PublicInboundSettings {
  return {
    enabled: settings.enabled,
    phoneNumber: settings.phoneNumber,
    startTime: settings.startTime,
    endTime: settings.endTime,
    days: settings.days,
    timezone: settings.timezone,
    handoffNumber: settings.handoffNumber,
    afterHoursMessage: settings.afterHoursMessage,
    deploymentStatus: settings.deploymentStatus,
    hasDeployment: Boolean(settings.deploymentId),
    deploymentId: settings.deploymentId,
    lastError: settings.lastError,
    knownCallersCount: settings.knownCallersCount ?? 0,
    knownCallersSyncedAt: settings.knownCallersSyncedAt ?? null,
    knownCallersError: settings.knownCallersError ?? null,
    lastSyncedAt: settings.lastSyncedAt ?? null,
    updatedAt: settings.updatedAt ?? null,
  };
}

/** Shape-checks a request body; the values themselves are validated by the service. */
export function parseInboundInput(body: unknown): InboundSettingsInput | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string).trim() : "");
  const days = Array.isArray(value.days) ? value.days.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday)) : [];
  return {
    phoneNumber: text("phoneNumber"),
    startTime: text("startTime"),
    endTime: text("endTime"),
    days,
    timezone: text("timezone"),
    handoffNumber: text("handoffNumber") || null,
    afterHoursMessage: text("afterHoursMessage") || null,
    // Absent means "leave the deployment alone"; present means the
    // administrator is choosing one.
    ...("deploymentId" in value ? { deploymentId: text("deploymentId") || null } : {}),
  };
}
