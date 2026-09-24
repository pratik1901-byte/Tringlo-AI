import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { placeCall } from "@/lib/calls/place-call";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

function resolveWebhookBaseUrl(request: NextRequest): string {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const host = request.headers.get("host") || "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${protocol}://${host}`;
}

/**
 * POST /api/calls/start
 *
 * Places one real outbound call: Dialo -> Sarvam Instant Outbound -> Vobiz.
 *
 * The work lives in `placeCall`, which the follow-up scheduler also uses, so a
 * manual call and an autonomous callback pass through identical guards.
 */
export async function POST(request: NextRequest) {
  // Placing a call spends real money and rings a real phone, so it requires a
  // signed-in account — from any device, including a phone on the LAN.
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // Generous for a person working a list, far too few for a script dialling
  // everyone in the database.
  const limit = rateLimit(clientKey(request, "calls:start"), 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many calls started in a minute. Wait a moment.", type: "rate_limited" },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => ({}));

    const result = await placeCall({
      leadId: body?.leadId,
      leadName: body?.leadName,
      leadPhone: body?.leadPhone,
      leadCompany: body?.leadCompany,
      leadNotes: body?.leadNotes,
      campaignId: body?.campaignId,
      campaignName: body?.campaignName,
      agentConfig: body?.agentConfig,
      webhookBaseUrl: resolveWebhookBaseUrl(request),
      origin: "manual",
      tenantId: auth.tenantId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, type: result.reason, ...(result.details ?? {}) },
        { status: result.status }
      );
    }

    return NextResponse.json({
      callId: result.callId,
      attemptId: result.attemptId,
      leadId: result.leadId,
      provider: "sarvam",
      status: "calling",
      knowledgeSources: result.knowledgeSources,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[POST /api/calls/start]", message);
    return NextResponse.json({ error: message, type: "internal_error" }, { status: 500 });
  }
}
