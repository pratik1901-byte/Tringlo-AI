import { NextRequest, NextResponse } from "next/server";

import { applySarvamEvent } from "@/lib/calls/service";
import type { SarvamWebhookPayload } from "@/lib/providers/sarvam/types";

/**
 * POST /api/webhooks/sarvam/campaign
 *
 * Campaign-triggered calls deliver the same completion payload as instant
 * outbounds, so they run through the identical reducer. Keeping a second parsing
 * path here is how the two endpoints would drift into disagreeing about a call.
 */
export async function POST(request: NextRequest) {
  let payload: SarvamWebhookPayload;

  try {
    payload = (await request.json()) as SarvamWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON webhook payload." }, { status: 400 });
  }

  try {
    const result = applySarvamEvent(payload);

    console.log(
      `[Sarvam campaign webhook] attempt=${result.attemptId} outcome=${result.outcome} status=${result.status ?? "none"}`
    );

    return NextResponse.json({
      received: true,
      outcome: result.outcome,
      attemptId: result.attemptId,
      callId: result.callId,
      status: result.status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Sarvam campaign webhook] Failed to apply event:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
