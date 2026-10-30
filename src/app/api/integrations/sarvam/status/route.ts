import { NextResponse } from "next/server";

import { sarvamVoiceService } from "@/lib/providers/sarvam";
import { requireAuth } from "@/lib/auth/guard";

type Connectivity = "reachable" | "unreachable" | "not_tested";

/**
 * Probes the outbound endpoint with an intentionally empty body.
 *
 * Sarvam validates auth before it validates the schema, so a 422 proves the key
 * works while the missing `app_config` guarantees no call is ever placed. Only
 * 401/403 mean the credentials are wrong.
 */
async function probeSarvam(): Promise<{ connectivity: Connectivity; details: string | null }> {
  const apiKey = process.env.SARVAM_API_KEY?.trim();
  const orgId = process.env.SARVAM_ORG_ID?.trim();
  const workspaceId = process.env.SARVAM_WORKSPACE_ID?.trim();

  if (!apiKey || !orgId || !workspaceId) {
    return { connectivity: "not_tested", details: null };
  }

  try {
    const response = await fetch(
      `https://apps.sarvam.ai/api/outbounds/v1/orgs/${encodeURIComponent(
        orgId
      )}/workspaces/${encodeURIComponent(workspaceId)}/outbounds`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      }
    );

    if (response.status === 401 || response.status === 403) {
      return {
        connectivity: "unreachable",
        details: `Sarvam rejected the API key (HTTP ${response.status}). Check SARVAM_API_KEY, SARVAM_ORG_ID and SARVAM_WORKSPACE_ID.`,
      };
    }

    if (response.status === 404) {
      return {
        connectivity: "unreachable",
        details:
          "Sarvam did not recognise this org/workspace. Check SARVAM_ORG_ID and SARVAM_WORKSPACE_ID.",
      };
    }

    return {
      connectivity: "reachable",
      details: "Authenticated with the Sarvam Voice Agents API.",
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "network error";
    return {
      connectivity: "unreachable",
      details: `Could not reach apps.sarvam.ai: ${message}`,
    };
  }
}

/**
 * GET /api/integrations/sarvam/status
 *
 * Reports which server-side settings are present and whether Sarvam accepts
 * them. Credential values themselves never leave the server — only booleans.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const status = sarvamVoiceService.getConfigurationStatus(auth.tenantId);
    const probe = await probeSarvam();

    return NextResponse.json({
      ...status,
      providerConnectivity: probe.connectivity,
      providerDetails: probe.details ?? status.details,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GET /api/integrations/sarvam/status]", message);

    return NextResponse.json(
      {
        status: "provider_error",
        details: "Could not inspect the Sarvam configuration.",
        missing: [],
        hasApiKey: false,
        hasOrgId: false,
        hasWorkspaceId: false,
        hasAgentId: false,
        hasConnectionId: false,
        hasPhoneNumber: false,
        hasPublicUrl: false,
        providerConnectivity: "not_tested",
        providerDetails: null,
      },
      { status: 500 }
    );
  }
}
