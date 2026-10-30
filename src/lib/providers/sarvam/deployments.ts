// ============================================================
// Sarvam — Inbound deployment API client
// ============================================================
//
// Server-side only. Endpoints as Sarvam documents them:
//
//   POST  /api/app-authoring/v1/orgs/{org}/workspaces/{ws}/deployments
//   GET   …/deployments/{deployment_id}
//   PATCH …/deployments/{deployment_id}          (only while paused)
//   PUT   …/deployments/{deployment_id}/status   ({ action: pause | resume })
//   POST  /api/scheduling/v1/orgs/{org}/workspaces/{ws}/deployments/{id}/cohorts/stream
//   GET   /api/scheduling/v1/…/deployments/{id}/webhooks       (delivery records)
//   POST  /api/scheduling/v1/…/deployments/{id}/webhooks/retry
//
// A deployment is created ACTIVE and starts answering calls at once, so this
// module is only ever called from an explicit "Enable" — never on a page load.
// The API key, org and workspace come from the server environment on every
// request and are never logged or returned.
// ============================================================

import type { Weekday } from "@/lib/campaigns/types";
import type { PlatformCredentials } from "@/lib/providers/types";

const AUTHORING = "https://apps.sarvam.ai/api/app-authoring/v1";
const SCHEDULING = "https://apps.sarvam.ai/api/scheduling/v1";

export class SarvamDeploymentError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SarvamDeploymentError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Tringlo's own Sarvam account. Every workspace's deployments live inside it;
 * which deployment belongs to which workspace is Tringlo's own record.
 */
function scope(credentials: PlatformCredentials) {
  const { apiKey, orgId: org, workspaceId: workspace } = credentials;
  if (!apiKey) throw new SarvamDeploymentError("SARVAM_API_KEY is not set on the server.", 401, "missing_api_key");
  if (!org || !workspace) throw new SarvamDeploymentError("SARVAM_ORG_ID and SARVAM_WORKSPACE_ID must both be set.", 422, "missing_workspace_config");
  const path = `orgs/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/deployments`;
  return { apiKey, authoring: `${AUTHORING}/${path}`, scheduling: `${SCHEDULING}/${path}` };
}

async function call<T>(method: string, url: string, apiKey: string, body?: unknown): Promise<T> {
  let response: Response;
  // Form data (a CSV upload) sets its own multipart boundary header.
  const isForm = body instanceof FormData;
  try {
    response = await fetch(url, {
      method,
      headers: { "X-API-Key": apiKey, ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new SarvamDeploymentError(`Could not reach Sarvam: ${error instanceof Error ? error.message : "network error"}`, 502, "network_error");
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }
  if (!response.ok) {
    const error = (parsed ?? {}) as { error?: { code?: string; message?: string; data?: { details?: unknown } }; detail?: unknown; message?: string };
    // Sarvam puts the useful part ("User Identifier is not supported…") here.
    const specific = typeof error.error?.data?.details === "string" ? error.error.data.details : null;
    const detail = Array.isArray(error.detail)
      ? (error.detail as Array<{ loc?: unknown[]; msg?: string }>).map((item) => `${(item.loc ?? []).join(".")}: ${item.msg ?? ""}`).join("; ")
      : typeof error.detail === "string"
        ? error.detail
        : null;
    console.error(`[Sarvam deployments] ${method} → ${response.status} ${error.error?.code ?? ""}`);
    throw new SarvamDeploymentError(
      specific || error.error?.message || detail || error.message || `Sarvam returned HTTP ${response.status}`,
      response.status,
      error.error?.code ?? null
    );
  }
  return parsed as T;
}

// ------------------------------------------------------------
// Types, as Sarvam names them
// ------------------------------------------------------------

export interface InboundConfigPayload {
  start_time: string;
  end_time: string;
  allowed_days: Weekday[];
  timezone: string;
}

export interface DeploymentPayload {
  name: string;
  description?: string | null;
  app_id: string;
  app_version: number;
  connection_configs: Array<{ connection_id: string; phone_numbers: string[] }>;
  inbound_config: InboundConfigPayload;
  webhook_config: { url: string; metadata?: Record<string, unknown> };
}

export interface DeploymentResponse {
  deployment_id: string;
  app_id: string;
  app_version: number;
  channel_direction?: string;
  status?: "active" | "paused" | null;
  name?: string | null;
  inbound_config?: InboundConfigPayload | null;
  webhook_config?: { url: string; metadata?: Record<string, unknown> | null } | null;
  /** On GET of one deployment. */
  connection_configs?: Array<{ connection_id: string; phone_numbers?: string[] }> | null;
  /** On the list endpoint, flattened. */
  phone_numbers?: string[] | null;
  updated_at?: string;
}

/**
 * One known caller. No user_identifier: Sarvam's docs list it, but its API
 * rejects it for deployments ("User Identifier is not supported for
 * deployments") — callers are matched by phone number alone.
 */
export interface CohortUser {
  user_phone_number: string;
  app_variables?: Record<string, string>;
  /** Supported keys: initial_bot_message, initial_language_name, initial_state_name. */
  app_overrides?: Record<string, string>;
}

// ------------------------------------------------------------
// Calls
// ------------------------------------------------------------

export function createDeployment(credentials: PlatformCredentials, payload: DeploymentPayload) {
  const { apiKey, authoring } = scope(credentials);
  return call<DeploymentResponse>("POST", authoring, apiKey, payload);
}

/** Every deployment in the workspace (first 100 — a workspace has a handful). */
export function listDeployments(credentials: PlatformCredentials) {
  const { authoring, apiKey } = scope(credentials);
  return call<{ items?: DeploymentResponse[] }>("GET", `${authoring}?limit=100`, apiKey);
}

export function getDeployment(credentials: PlatformCredentials, deploymentId: string) {
  const { apiKey, authoring } = scope(credentials);
  return call<DeploymentResponse>("GET", `${authoring}/${encodeURIComponent(deploymentId)}`, apiKey);
}

/** Only accepted while the deployment is paused. */
export function updateDeployment(credentials: PlatformCredentials, deploymentId: string, changes: Partial<Omit<DeploymentPayload, "app_id">>) {
  const { apiKey, authoring } = scope(credentials);
  return call<DeploymentResponse>("PATCH", `${authoring}/${encodeURIComponent(deploymentId)}`, apiKey, changes);
}

export function setDeploymentStatus(credentials: PlatformCredentials, deploymentId: string, action: "pause" | "resume") {
  const { apiKey, authoring } = scope(credentials);
  return call<DeploymentResponse>("PUT", `${authoring}/${encodeURIComponent(deploymentId)}/status`, apiKey, { action });
}

/** Known callers, as JSON: up to 1000 per request. */
export function streamDeploymentCohort(credentials: PlatformCredentials, deploymentId: string, name: string, users: CohortUser[]) {
  const { apiKey, scheduling } = scope(credentials);
  return call<{ cohort_id: string; status: string; result?: { total_records: number; valid_records: number; rejected_records: number } | null }>(
    "POST",
    `${scheduling}/${encodeURIComponent(deploymentId)}/cohorts/stream`,
    apiKey,
    { name, users }
  );
}

/**
 * Known callers as a CSV upload — the route that works for deployments (the
 * JSON stream is refused with "User Identifier is not supported for
 * deployments"). The transformation format is undocumented; this shape is
 * the one Sarvam's validator asks for and accepts:
 *   { phone_number: { column_name }, app_variables: { <var>: { column_name } },
 *     app_overrides: { initial_bot_message: { column_name } } }
 */
export function uploadDeploymentCohort(credentials: PlatformCredentials, deploymentId: string, name: string, users: CohortUser[]) {
  const { apiKey, scheduling } = scope(credentials);
  const variableKeys = [...new Set(users.flatMap((user) => Object.keys(user.app_variables ?? {})))].sort();
  const overrideKeys = [...new Set(users.flatMap((user) => Object.keys(user.app_overrides ?? {})))].sort();
  const columns = ["phone", ...variableKeys.map((key) => `var_${key}`), ...overrideKeys.map((key) => `override_${key}`)];
  const escape = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const rows = users.map((user) =>
    [
      user.user_phone_number,
      ...variableKeys.map((key) => user.app_variables?.[key] ?? ""),
      ...overrideKeys.map((key) => user.app_overrides?.[key] ?? ""),
    ]
      .map(escape)
      .join(",")
  );
  const transformation = {
    phone_number: { column_name: "phone" },
    app_variables: Object.fromEntries(variableKeys.map((key) => [key, { column_name: `var_${key}` }])),
    ...(overrideKeys.length
      ? { app_overrides: Object.fromEntries(overrideKeys.map((key) => [key, { column_name: `override_${key}` }])) }
      : {}),
  };
  const form = new FormData();
  form.append("name", name);
  form.append("cohort_file", new Blob([[columns.join(","), ...rows].join("\n")], { type: "text/csv" }), "known-callers.csv");
  form.append("cohort_transformation_file", new Blob([JSON.stringify(transformation)], { type: "application/json" }), "transformation.json");
  return call<{ cohort_id: string; status: string; result?: { total_records: number; valid_records: number; rejected_records: number } | null }>(
    "POST",
    `${scheduling}/${encodeURIComponent(deploymentId)}/cohorts/upload`,
    apiKey,
    form
  );
}

export function listWebhookDeliveries(credentials: PlatformCredentials, deploymentId: string, status: "failed" | "completed" | "running", sinceIso: string) {
  const { apiKey, scheduling } = scope(credentials);
  const query = `limit=250&status=${status}&start_datetime=${encodeURIComponent(sinceIso)}`;
  return call<{ items: Array<{ attempt_id: string; status: string }> }>(
    "GET",
    `${scheduling}/${encodeURIComponent(deploymentId)}/webhooks?${query}`,
    apiKey
  );
}

/** Re-delivers up to 200 attempts to the deployment's current webhook URL. */
export function retryWebhookDeliveries(credentials: PlatformCredentials, deploymentId: string, attemptIds: string[]) {
  const { apiKey, scheduling } = scope(credentials);
  return call<unknown>("POST", `${scheduling}/${encodeURIComponent(deploymentId)}/webhooks/retry`, apiKey, {
    attempt_ids: attemptIds.slice(0, 200),
  });
}
