import { NextRequest, NextResponse } from "next/server";

import { placeCall } from "@/lib/calls/place-call";

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
