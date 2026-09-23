// ============================================================
// Sarvam Voice Agents — HTTP Client
// ============================================================
// Server-side only. The API key is read from the environment on each request
// and is never logged, returned to the browser, or written to the database.
// ============================================================

import type { SarvamOutboundPayload, SarvamOutboundResponse } from "./types";

const SARVAM_APPS_BASE_URL = "https://apps.sarvam.ai";

export class SarvamClientError extends Error {
  status: number;
  type?: string;
  details?: unknown;

  constructor(message: string, status: number, type?: string, details?: unknown) {
    super(message);
    this.name = "SarvamClientError";
    this.status = status;
    this.type = type;
    this.details = details;
  }
}

interface SarvamErrorBody {
  error?: {
    message?: string;
    type?: string;
    data?: { details?: string };
  };
  message?: string;
  attempt_id?: string;
  status?: string;
}

/** Strips accidental quotes from a `.env` value that was written as KEY="value". */
function readEnv(name: string): string {
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

export class SarvamVoiceAgentsClient {
  public hasApiKey(): boolean {
    return readEnv("SARVAM_API_KEY").length > 0;
  }

  /**
   * POST /api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds
   *
   * Returns as soon as Sarvam accepts the trigger. Acceptance means the request
   * was valid — not that the phone rang.
   */
  public async createInstantOutbound(
    payload: SarvamOutboundPayload
  ): Promise<SarvamOutboundResponse> {
    const apiKey = readEnv("SARVAM_API_KEY");
    const orgId = readEnv("SARVAM_ORG_ID");
    const workspaceId = readEnv("SARVAM_WORKSPACE_ID");

    if (!apiKey) {
      throw new SarvamClientError(
        "SARVAM_API_KEY is not set on the server.",
        401,
        "missing_api_key"
      );
    }
    if (!orgId || !workspaceId) {
      throw new SarvamClientError(
        "SARVAM_ORG_ID and SARVAM_WORKSPACE_ID must both be set.",
        422,
        "missing_workspace_config"
      );
    }

    const endpoint = `${SARVAM_APPS_BASE_URL}/api/outbounds/v1/orgs/${encodeURIComponent(
      orgId
    )}/workspaces/${encodeURIComponent(workspaceId)}/outbounds`;

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new SarvamClientError(
        `Could not reach the Sarvam Voice Agents API: ${
          err instanceof Error ? err.message : "network error"
        }`,
        502,
        "network_error"
      );
    }

    const text = await response.text();
    let body: SarvamErrorBody = {};
    try {
      body = JSON.parse(text) as SarvamErrorBody;
    } catch {
      body = { message: text };
    }

    if (!response.ok) {
      const detail = body.error?.data?.details;
      const base =
        body.error?.message || body.message || `Sarvam returned HTTP ${response.status}`;

      console.error(
        `[Sarvam] Outbound rejected — status: ${response.status}, type: ${
          body.error?.type ?? "unknown"
        }`
      );

      throw new SarvamClientError(
        detail ? `${base} — ${detail}` : base,
        response.status,
        body.error?.type || "provider_error",
        body
      );
    }

    console.log(`[Sarvam] Outbound accepted — attempt_id: ${body.attempt_id ?? "none"}`);

    return {
      attempt_id: body.attempt_id ?? "",
      status: body.status,
      message: body.message,
      rawResponse: body,
    };
  }
}
