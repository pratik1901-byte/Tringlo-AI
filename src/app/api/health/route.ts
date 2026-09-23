import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  getCallRecords,
  getFollowUps,
  getLeads,
  getWebhookBaseUrl,
  getWebhookDelivery,
} from "@/lib/db";
import { sarvamVoiceService } from "@/lib/providers/sarvam";
import { checkWebhookReachable } from "@/lib/calls/webhook-reachability";
import { schedulerStatus } from "@/lib/scheduling/scheduler";
import { outboundCallsBlocked } from "@/lib/calls/place-call";
import { webhookToken } from "@/lib/security/webhook-auth";
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
  const sarvam = sarvamVoiceService.getConfigurationStatus();
  checks.push({
    name: "sarvam",
    state: sarvam.status === "ready" ? "ok" : "fail",
    detail: sarvam.status === "ready" ? "Configured." : `Missing: ${sarvam.missing.join(", ")}.`,
  });

  checks.push({
    name: "telephony",
    state: sarvam.hasConnectionId && sarvam.hasPhoneNumber ? "ok" : "fail",
    detail:
      sarvam.hasConnectionId && sarvam.hasPhoneNumber
        ? "Connection and caller ID configured."
        : "Telephony connection or caller ID is not configured.",
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

  checks.push({
    name: "webhook_auth",
    state: webhookToken() ? "ok" : "warn",
    detail: webhookToken()
      ? "Webhook requires a token."
      : "Webhook accepts unauthenticated posts. Set DIALO_WEBHOOK_TOKEN once no calls are in flight.",
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
