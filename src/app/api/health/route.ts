import { getAllProviderConfigs } from "@/lib/db";
import { platformProblems } from "@/lib/providers/config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getCallRecords,
  getFollowUps,
  getLeads,
  getWebhookBaseUrl,
  getWebhookDelivery,
} from "@/lib/db";
import { checkWebhookReachable } from "@/lib/calls/webhook-reachability";
import { schedulerStatus } from "@/lib/scheduling/scheduler";
import { outboundCallsBlocked } from "@/lib/calls/place-call";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export type CheckState = "ok" | "warn" | "fail";

interface Check {
  name: string;
  state: CheckState;
  detail: string;
}

/**
 * GET /api/health
 *
 * Whether this instance can actually do its job: reach its database, be reached
 * by Sarvam, and place calls.
 *
 * Reports only states and counts. No credential, token or URL secret is ever
 * included, so this is safe to expose to a monitor. `?deep=1` additionally
 * probes the public webhook URL, which costs a network round trip.
 */
export async function GET(request: NextRequest) {
  const limit = rateLimit(clientKey(request, "health"), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const deep = request.nextUrl.searchParams.get("deep") === "1";
  const checks: Check[] = [];

  // --- Database ---
  let counts = { leads: 0, calls: 0, followUps: 0 };
  try {
    counts = {
      leads: getLeads().length,
      calls: getCallRecords().length,
      followUps: getFollowUps().length,
    };
    checks.push({
      name: "database",
      state: "ok",
      detail: `Readable. ${counts.calls} calls, ${counts.followUps} follow-ups.`,
    });
  } catch (error: unknown) {
    checks.push({
      name: "database",
      state: "fail",
      detail: error instanceof Error ? error.message : "Database is not readable.",
    });
  }

  // --- Sarvam configuration ---
  // Health is about the server, so it reports Tringlo's own credentials. Whether
  // a particular workspace has an agent is that workspace's own business, and
  // is reported in its Settings.
  const platform = platformProblems();
  checks.push({
    name: "sarvam",
    state: platform.length === 0 ? "ok" : "fail",
    detail: platform.length === 0 ? "Configured." : platform.join(" "),
  });

  const workspacesConfigured = getAllProviderConfigs().filter((config) => config.outbound).length;
  checks.push({
    name: "workspaces",
    state: "ok",
    detail: `${workspacesConfigured} workspace${workspacesConfigured === 1 ? "" : "s"} configured for calling.`,
  });

  const withTelephony = getAllProviderConfigs().filter(
    (config) => config.outbound?.connectionId && config.outbound?.phoneNumber
  ).length;
  checks.push({
    name: "telephony",
    state: workspacesConfigured === 0 || withTelephony === workspacesConfigured ? "ok" : "fail",
    detail:
      workspacesConfigured === 0
        ? "No workspace has been configured for calling yet."
        : `${withTelephony} of ${workspacesConfigured} configured workspaces have a connection and caller ID.`,
  });

  // --- Webhook configuration ---
  const baseUrl = getWebhookBaseUrl();
  const isPublic = Boolean(baseUrl) && !baseUrl!.includes("localhost");
  const isQuickTunnel = Boolean(baseUrl?.includes("trycloudflare.com"));

  checks.push({
    name: "webhook_url",
    state: !isPublic ? "fail" : isQuickTunnel ? "warn" : "ok",
    detail: !isPublic
      ? "No public webhook URL is configured, so call results cannot be delivered."
      : isQuickTunnel
        ? "Using a temporary quick tunnel. The hostname changes on restart and can be revoked — use a named tunnel or a deployed URL."
        : "Stable public URL configured.",
  });

  // Every workspace that can receive a webhook has its own token.
  const tokenedWorkspaces = getAllProviderConfigs().filter((config) => config.webhookToken).length;
  checks.push({
    name: "webhook_auth",
    state: tokenedWorkspaces > 0 ? "ok" : "warn",
    detail:
      tokenedWorkspaces > 0
        ? `Webhooks require a workspace token (${tokenedWorkspaces} configured).`
        : "No workspace has a webhook token yet, so no webhook can be accepted.",
  });

  // --- Webhook delivery history ---
  const delivery = getWebhookDelivery();
  checks.push({
    name: "webhook_delivery",
    state: delivery.lastSuccessAt ? "ok" : delivery.totalReceived > 0 ? "warn" : "warn",
    detail: delivery.lastSuccessAt
      ? `Last processed ${delivery.lastSuccessAt}.`
      : delivery.totalReceived > 0
        ? "Webhooks received but none processed successfully."
        : "No webhook has been received yet.",
  });

  // --- Scheduler ---
  const scheduler = schedulerStatus();
  checks.push({
    name: "scheduler",
    state: scheduler.running ? "ok" : "fail",
    detail: scheduler.running
      ? `Running every ${scheduler.intervalMs / 1000}s. Last tick ${scheduler.lastTickAt ?? "pending"}.`
      : "Not running, so due callbacks will not be placed.",
  });

  // --- Outbound kill switch ---
  if (outboundCallsBlocked()) {
    checks.push({
      name: "outbound",
      state: "warn",
      detail: "Outbound calling is disabled by DIALO_BLOCK_OUTBOUND_CALLS.",
    });
  }

  // --- Optional live reachability probe ---
  if (deep && baseUrl) {
    const reachable = await checkWebhookReachable(baseUrl);
    checks.push({
      name: "webhook_reachable",
      state: reachable.reachable ? "ok" : "fail",
      detail: reachable.detail,
    });
  }

  const state: CheckState = checks.some((c) => c.state === "fail")
    ? "fail"
    : checks.some((c) => c.state === "warn")
      ? "warn"
      : "ok";

  return NextResponse.json(
    {
      status: state,
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      counts,
      checks,
      delivery: {
        lastReceivedAt: delivery.lastReceivedAt,
        lastSuccessAt: delivery.lastSuccessAt,
        lastSuccessOutcome: delivery.lastSuccessOutcome,
        lastFailureAt: delivery.lastFailureAt,
        lastFailureReason: delivery.lastFailureReason,
        totalReceived: delivery.totalReceived,
        totalRejected: delivery.totalRejected,
      },
      scheduler,
    },
    // `fail` returns 503 so an uptime monitor treats it as down.
    { status: state === "fail" ? 503 : 200 }
  );
}
