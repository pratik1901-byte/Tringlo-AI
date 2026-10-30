// ============================================================
// Sarvam — Campaign API client
// ============================================================
//
// Server-side only. Endpoints and payloads follow Sarvam's published API:
//
//   POST  /api/scheduling/v1/orgs/{org}/workspaces/{ws}/campaigns
//   GET   /api/scheduling/v1/orgs/{org}/workspaces/{ws}/campaigns/{id}
//   PUT   /api/scheduling/v1/orgs/{org}/workspaces/{ws}/campaigns/{id}/status
//   POST  …/campaigns/{id}/cohorts/upload      (multipart: name, cohort_file,
//                                               cohort_transformation_file)
//   POST  …/campaigns/{id}/cohorts/stream      (JSON: name, users[])
//   GET   …/campaigns/{id}/cohorts/{cohort_id}
//
// The API key, org and workspace come from the server environment on every
// request. They are never logged, stored, or returned to a browser.
// ============================================================

import type { PlatformCredentials } from "@/lib/providers/types";
import type { SarvamCampaignStatus, Weekday } from "@/lib/campaigns/types";

const BASE = "https://apps.sarvam.ai/api/scheduling/v1";

export class SarvamCampaignError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SarvamCampaignError";
    this.status = status;
    this.code = code;
  }
}

function endpoint(credentials: PlatformCredentials) {
  const { apiKey, orgId, workspaceId } = credentials;
  if (!apiKey) throw new SarvamCampaignError("SARVAM_API_KEY is not set on the server.", 401, "missing_api_key");
  if (!orgId || !workspaceId) {
    throw new SarvamCampaignError("SARVAM_ORG_ID and SARVAM_WORKSPACE_ID must both be set.", 422, "missing_workspace_config");
  }
  return {
    apiKey,
    root: `${BASE}/orgs/${encodeURIComponent(orgId)}/workspaces/${encodeURIComponent(workspaceId)}/campaigns`,
  };
}

async function request<T>(creds: PlatformCredentials, method: string, path: string, body?: BodyInit, json = true): Promise<T> {
  const { apiKey, root } = endpoint(creds);
  const headers: Record<string, string> = { "X-API-Key": apiKey };
  if (json && body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${root}${path}`, { method, headers, body, cache: "no-store" });
  } catch (error) {
    throw new SarvamCampaignError(
      `Could not reach Sarvam: ${error instanceof Error ? error.message : "network error"}`,
      502,
      "network_error"
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }

  if (!response.ok) {
    const error = (parsed as { error?: { code?: string; message?: string }; detail?: unknown; message?: string }) ?? {};
    const detail = Array.isArray(error.detail)
      ? (error.detail as Array<{ loc?: unknown[]; msg?: string }>)
          .map((item) => `${(item.loc ?? []).join(".")}: ${item.msg ?? ""}`)
          .join("; ")
      : typeof error.detail === "string"
        ? error.detail
        : null;
    const message = error.error?.message || detail || error.message || `Sarvam returned HTTP ${response.status}`;
    // Status and code only: bodies can echo phone numbers.
    console.error(`[Sarvam campaigns] ${method} ${path.split("?")[0] || "/"} → ${response.status} ${error.error?.code ?? ""}`);
    throw new SarvamCampaignError(message, response.status, error.error?.code ?? null);
  }

  return parsed as T;
}

// ------------------------------------------------------------
// Payload types, as Sarvam names them
// ------------------------------------------------------------

export interface RetryOnSetting {
  enabled: boolean;
  threshold_seconds?: number;
}

export interface SarvamCreateCampaignPayload {
  name: string;
  description?: string | null;
  app_config: {
    app_id: string;
    app_version: number;
    /** Sarvam's app type. "agent" in every example seen so far. */
    app_type: string;
    attempts_per_second: number;
    connection_configs: Array<{ connection_id: string; phone_numbers: string[] }>;
    retry_config: {
      max_retries: number;
      retry_interval_minutes: number;
      retry_on: {
        busy?: RetryOnSetting;
        no_answer?: RetryOnSetting;
        failed?: RetryOnSetting;
        short_duration?: RetryOnSetting;
      };
    };
    webhook_config?: { url: string; metadata?: Record<string, unknown> };
  };
  start_timestamp: string;
  end_timestamp: string;
  allowed_schedule: {
    timezone: string;
    allowed_start_time: string;
    allowed_end_time: string;
    allowed_days: Weekday[];
  };
}

export interface SarvamCampaignResponse {
  name: string;
  campaign_id: string;
  status: SarvamCampaignStatus;
  app_id: string;
  created_at: string;
  updated_at: string;
  app_version?: number | null;
}

export interface SarvamCohortResponse {
  name: string;
  cohort_id: string;
  status: "processing" | "completed" | "failed";
  source_type: "pre_signed_url" | "file_upload";
  created_at: string;
  updated_at: string;
  result?: { total_records: number; valid_records: number; rejected_records: number } | null;
}

export interface SarvamCohortUser {
  user_phone_number: string;
  user_identifier?: string;
  /** Keys must be variables declared on the agent. Values are strings. */
  app_variables?: Record<string, string>;
}

// ------------------------------------------------------------
// Calls
// ------------------------------------------------------------

export function createCampaign(creds: PlatformCredentials, payload: SarvamCreateCampaignPayload) {
  return request<SarvamCampaignResponse>(creds, "POST", "", JSON.stringify(payload));
}

export function getCampaign(creds: PlatformCredentials, campaignId: string) {
  return request<SarvamCampaignResponse>(creds, "GET", `/${encodeURIComponent(campaignId)}`);
}

/** Sarvam's actions are exactly `pause`, `resume` and `cancel`. */
export function updateCampaignStatus(creds: PlatformCredentials, campaignId: string, action: "pause" | "resume" | "cancel") {
  return request<SarvamCampaignResponse>(creds, "PUT", `/${encodeURIComponent(campaignId)}/status`, JSON.stringify({ action }));
}

/** Multipart upload: `name`, `cohort_file` (CSV), `cohort_transformation_file` (JSON). */
export function uploadCohort(creds: PlatformCredentials, campaignId: string, name: string, csv: string, transformation: unknown) {
  const form = new FormData();
  form.append("name", name);
  form.append("cohort_file", new Blob([csv], { type: "text/csv" }), "cohort.csv");
  form.append(
    "cohort_transformation_file",
    new Blob([JSON.stringify(transformation)], { type: "application/json" }),
    "cohort_transformation.json"
  );
  return request<SarvamCohortResponse>(creds, "POST", `/${encodeURIComponent(campaignId)}/cohorts/upload`, form, false);
}

/** JSON stream: up to 1000 users per request. */
export function streamCohort(creds: PlatformCredentials, campaignId: string, name: string, users: SarvamCohortUser[]) {
  return request<SarvamCohortResponse>(creds, "POST", `/${encodeURIComponent(campaignId)}/cohorts/stream`, JSON.stringify({ name, users }));
}

export function getCohort(creds: PlatformCredentials, campaignId: string, cohortId: string) {
  return request<SarvamCohortResponse>(creds, "GET", `/${encodeURIComponent(campaignId)}/cohorts/${encodeURIComponent(cohortId)}`);
}
