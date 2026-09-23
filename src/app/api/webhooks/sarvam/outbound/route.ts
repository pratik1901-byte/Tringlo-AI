import { NextRequest, NextResponse } from "next/server";

import { applySarvamEvent } from "@/lib/calls/service";
import { recordWebhookDelivery } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import {
  MAX_WEBHOOK_BYTES,
  authenticateWebhook,
  validateWebhookPayload,
} from "@/lib/security/webhook-auth";
import type { SarvamWebhookPayload } from "@/lib/providers/sarvam/types";

/** Generous enough for Sarvam's retries, tight enough to blunt a flood. */
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/webhooks/sarvam/outbound
 *
 * The only way a call acquires a result.
 *
 * Answers 2xx for anything well-formed that Dialo has accepted responsibility
 * for — including duplicates and events it chose not to apply — because a
 * non-2xx makes Sarvam retry an event that was received correctly. A 5xx is
 * reserved for the one case where a retry is genuinely wanted: the event was
 * valid but Dialo failed to store it.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now();

  // --- Rate limit ---
  const limit = rateLimit(clientKey(request, "webhook"), RATE_LIMIT, RATE_WINDOW_MS);
  if (!limit.allowed) {
    console.warn("WEBHOOK_RATE_LIMITED");
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  // --- Authenticate ---
  const auth = authenticateWebhook(request);
  if (!auth.ok) {
    // The reason is logged but not returned: an unauthenticated caller learns
    // only that it was rejected.
    console.warn(`WEBHOOK_REJECTED reason=${auth.reason}`);
    recordWebhookDelivery({ ok: false, reason: "Rejected: failed authentication." });
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // --- Read the body, bounded ---
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "Could not read the request body." }, { status: 400 });
  }

  if (raw.length > MAX_WEBHOOK_BYTES) {
    console.warn(`WEBHOOK_REJECTED reason=payload_too_large bytes=${raw.length}`);
    recordWebhookDelivery({ ok: false, reason: "Rejected: payload too large." });
    return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    recordWebhookDelivery({ ok: false, reason: "Rejected: body was not valid JSON." });
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // --- Validate shape ---
  const validation = validateWebhookPayload(payload);
  if (!validation.valid) {
    console.warn(`WEBHOOK_REJECTED reason=${validation.reason}`);
    recordWebhookDelivery({ ok: false, reason: `Rejected: ${validation.reason}` });
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  // --- Apply ---
  try {
    const result = applySarvamEvent(payload as SarvamWebhookPayload);
    const tookMs = Date.now() - startedAt;

    recordWebhookDelivery({
      ok: true,
      attemptId: result.attemptId,
      outcome: result.outcome,
      tookMs,
    });

    console.log(
      `WEBHOOK_PROCESSED attempt=${result.attemptId} outcome=${result.outcome} status=${result.status ?? "none"} tookMs=${tookMs}`
    );

    return NextResponse.json({
      received: true,
      outcome: result.outcome,
      attemptId: result.attemptId,
      callId: result.callId,
      status: result.status,
      followUpId: result.followUpId,
      suppressed: result.suppressed,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("WEBHOOK_PROCESSING_FAILED", message);
    recordWebhookDelivery({ ok: false, reason: message });

    // The event was valid but could not be stored, so a Sarvam retry is exactly
    // what should happen next. The message is not echoed to the caller.
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}

/**
 * GET /api/webhooks/sarvam/outbound
 *
 * Health probe. The launcher and `placeCall` fetch this through the public URL
 * to confirm a call result can actually get back before a call is placed.
 * Carries no data and needs no token.
 */
export function GET() {
  return NextResponse.json({ service: "dialo-sarvam-webhook", ready: true });
}
