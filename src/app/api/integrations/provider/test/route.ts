// ============================================================
// POST /api/integrations/provider/test
// ============================================================
//
// "Test connection": asks Sarvam, with Tringlo's credentials, whether this
// workspace's configuration points at things that actually exist.
//
// It reads; it never creates, changes or dials anything. What comes back says
// what was found, never a credential.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { getWebhookBaseUrl } from "@/lib/db";
import { markProviderVerified, platformCredentials, platformProblems, providerConfigFor } from "@/lib/providers/config";
import { listDeployments } from "@/lib/providers/sarvam/deployments";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(clientKey(request, `provider-test:${auth.tenantId}`), 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: { message: "Too many attempts. Wait a minute." } }, { status: 429 });
  }

  const credentials = platformCredentials();
  const config = providerConfigFor(auth.tenantId);
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

  checks.push({
    label: "Tringlo's Sarvam account",
    ok: Boolean(credentials),
    detail: credentials ? "Configured on the server." : platformProblems()[0] ?? "Not configured.",
  });

  checks.push({
    label: "Outbound agent",
    ok: Boolean(config?.outbound?.appId),
    detail: config?.outbound?.appId
      ? `Agent ${config.outbound.appId}, version ${config.outbound.appVersion}.`
      : "No outbound agent is set for this workspace.",
  });

  checks.push({
    label: "Inbound agent",
    ok: true,
    detail: config?.inbound?.appId
      ? `Agent ${config.inbound.appId}, version ${config.inbound.appVersion}.`
      : "Not set. Inbound calling stays off until it is.",
  });

  const base = getWebhookBaseUrl();
  checks.push({
    label: "Public address for call results",
    ok: Boolean(base && /^https:\/\//i.test(base)),
    detail: base && /^https:\/\//i.test(base) ? "Registered." : "No public HTTPS address is registered.",
  });

  // The one live check: can Tringlo actually reach Sarvam with its credentials?
  if (credentials) {
    try {
      const deployments = await listDeployments(credentials);
      const mine = (deployments.items ?? []).filter(
        (deployment) => deployment.app_id === config?.inbound?.appId || deployment.app_id === config?.outbound?.appId
      );
      checks.push({
        label: "Sarvam reachable",
        ok: true,
        detail: `Answered. ${mine.length} deployment${mine.length === 1 ? "" : "s"} found for this workspace's agents.`,
      });
    } catch (error) {
      checks.push({
        label: "Sarvam reachable",
        ok: false,
        detail: error instanceof Error ? error.message : "Sarvam could not be reached.",
      });
    }
  }

  const ok = checks.every((check) => check.ok);
  // Only a check that actually reached Sarvam may mark the configuration
  // verified, and only when every check passed. Editing it later clears this.
  if (ok && credentials) markProviderVerified(auth.tenantId);
  console.log(`PROVIDER_TEST tenant=${auth.tenantId} ok=${ok}`);
  return NextResponse.json({ ok, checks }, { headers: { "Cache-Control": "no-store" } });
}
