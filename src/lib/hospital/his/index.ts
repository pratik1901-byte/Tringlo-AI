// ============================================================
// Tringlo AI — Reaching the hospital's system
// ============================================================
//
// One way in: `hospitalServer(tenantId)`. Everything above it — the panel's
// routes, the reminder worker, the agent's context — goes through the
// interface and never knows which implementation answered.
//
// The choice is the workspace's own configuration, and the default is the
// demonstration stand-in, because the default has to be the one that connects
// to nothing.
// ============================================================

import { getHospitalProfile } from "@/lib/db";
import { defaultIntegrationConfig, type HospitalIntegrationConfig } from "../records";
import { DemoHospitalServer } from "./demo";
import { LiveHospitalServer } from "./live";
import { CAPABILITY_LABELS, HIS_CAPABILITIES, type HisCapability, type HospitalServer } from "./types";

export * from "./types";
export { DemoHospitalServer } from "./demo";
export { LiveHospitalServer } from "./live";

/** This workspace's integration settings, defaulted rather than assumed. */
export function integrationConfig(tenantId: string): HospitalIntegrationConfig {
  const profile = getHospitalProfile(tenantId);
  const stored = profile?.integration;
  if (!stored) return defaultIntegrationConfig();
  // Merged over the defaults so a config written by an older version still
  // has every field the adapters read.
  return { ...defaultIntegrationConfig(), ...stored };
}

/**
 * The hospital's system for this workspace.
 *
 * A workspace set to "live" gets the HTTP adapter even when it is not yet
 * configured — and that is deliberate. The live adapter then reports
 * `not_configured` on every call, which is the truth, where falling back to
 * the demonstration stand-in would quietly answer with fictional patients.
 */
export function hospitalServer(tenantId: string): HospitalServer {
  const config = integrationConfig(tenantId);
  return config.mode === "live" ? new LiveHospitalServer(config) : new DemoHospitalServer(tenantId);
}

/** What the panel may know about the integration. Never the credential. */
export interface IntegrationStatus {
  mode: "demo" | "live";
  label: string;
  /** Whether a live integration has everything it needs to make a call. */
  configured: boolean;
  baseUrl: string | null;
  /** That a credential exists — not what it is. */
  hasCredential: boolean;
  reportDestination: "hospital_server" | "panel_review";
  timeoutMs: number;
  capabilities: Array<{ capability: HisCapability; label: string; available: boolean; reason: string | null }>;
  lastCheck: { at: string; ok: boolean; detail: string } | null;
  /** What an administrator still has to supply, in plain words. */
  outstanding: string[];
}

export function integrationStatus(tenantId: string): IntegrationStatus {
  const config = integrationConfig(tenantId);
  const server = hospitalServer(tenantId);

  const outstanding: string[] = [];
  if (config.mode === "live") {
    if (!config.baseUrl) outstanding.push("The hospital server's base URL, from its API documentation.");
    if (!config.token) outstanding.push("A credential for the hospital server, entered on the server side.");
    if (config.capabilities.length === 0) {
      outstanding.push("Which operations the hospital's API supports.");
    }
    for (const capability of config.capabilities) {
      if (!config.endpoints[capability]) {
        outstanding.push(`The request path for ${CAPABILITY_LABELS[capability as HisCapability] ?? capability}.`);
      }
    }
  }

  return {
    mode: config.mode,
    label: server.label,
    configured: config.mode === "demo" ? true : outstanding.length === 0,
    baseUrl: config.baseUrl,
    hasCredential: Boolean(config.token),
    reportDestination: config.reportDestination,
    timeoutMs: config.timeoutMs,
    capabilities: HIS_CAPABILITIES.map((capability) => ({
      capability,
      label: CAPABILITY_LABELS[capability],
      available: server.supports(capability),
      reason: server.supports(capability)
        ? null
        : config.mode === "demo"
          ? "Not offered by the demonstration stand-in."
          : !config.capabilities.includes(capability)
            ? "Not recorded as supported by the hospital's API."
            : !config.endpoints[capability]
              ? "No request path has been entered."
              : "The hospital server is not configured yet.",
    })),
    lastCheck: config.lastCheck ?? null,
    outstanding,
  };
}

/**
 * Where a collected history actually ends up, given what the hospital's API
 * can do.
 *
 * Said out loud so the panel can label a record rather than leaving a
 * clinician to assume the hospital has it.
 */
export function historyStorage(tenantId: string): "hospital_server" | "tringlo_local" {
  return hospitalServer(tenantId).supports("history_write") ? "hospital_server" : "tringlo_local";
}
