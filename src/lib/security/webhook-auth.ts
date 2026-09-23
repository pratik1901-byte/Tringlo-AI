// ============================================================
// Dialo AI — Webhook Authentication
// ============================================================
//
// Sarvam's outbound `webhook_config` takes a URL and optional metadata. It does
// not offer a signing secret or custom headers for this webhook, so there is no
// provider signature to verify — inventing one would only look like security.
//
// What is available is the URL itself, which Dialo controls. So the endpoint is
// protected by an unguessable token carried in the query string, plus strict
// payload validation and rate limiting.
//
// A second line already exists underneath this: the event reducer refuses to
// create anything for an `attempt_id` it did not place, so even an accepted
// request cannot inject a call that never happened.
// ============================================================

import { timingSafeEqual } from "node:crypto";

export type WebhookAuthResult =
  | { ok: true; mode: "token" | "unauthenticated" }
  | { ok: false; reason: string };

/** The token, when one is configured. Server-side only; never sent to a browser. */
export function webhookToken(): string | null {
  const token = process.env.DIALO_WEBHOOK_TOKEN?.trim();
  return token && token.length >= 16 ? token : null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Checks the token on an incoming webhook.
 *
 * With no token configured the endpoint stays open, because closing it silently
 * would drop the results of calls already in flight. The health endpoint reports
 * that state as a warning rather than leaving it unnoticed.
 */
export function authenticateWebhook(request: Request): WebhookAuthResult {
  const expected = webhookToken();
  if (!expected) return { ok: true, mode: "unauthenticated" };

  const provided = new URL(request.url).searchParams.get("k");
  if (!provided) return { ok: false, reason: "Missing webhook token." };
  if (!constantTimeEquals(provided, expected)) return { ok: false, reason: "Invalid webhook token." };

  return { ok: true, mode: "token" };
}

/** Appends the token to the URL registered with Sarvam, when one is configured. */
export function withWebhookToken(url: string): string {
  const token = webhookToken();
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}k=${encodeURIComponent(token)}`;
}

// ------------------------------------------------------------
// Payload validation
// ------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Rejects anything that is not shaped like a Sarvam completion webhook, before
 * it reaches the reducer.
 *
 * Only structure is checked here. What the values *mean* is decided by the
 * parser, which already refuses to invent anything the provider did not send.
 */
export function validateWebhookPayload(payload: unknown): ValidationResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { valid: false, reason: "Payload must be a JSON object." };
  }

  const body = payload as Record<string, unknown>;

  const attemptId = body.attempt_id;
  if (typeof attemptId !== "string" || attemptId.trim().length === 0) {
    return { valid: false, reason: "attempt_id is required." };
  }
  if (attemptId.length > 200) {
    return { valid: false, reason: "attempt_id is implausibly long." };
  }

  // Sarvam sends these as arrays/objects; anything else is not its payload.
  if (body.interaction_transcript != null && !Array.isArray(body.interaction_transcript)) {
    return { valid: false, reason: "interaction_transcript must be an array." };
  }
  for (const key of ["final_agent_variables", "output_agent_variables", "metadata", "webhook_config"]) {
    const value = body[key];
    if (value != null && (typeof value !== "object" || Array.isArray(value))) {
      return { valid: false, reason: `${key} must be an object.` };
    }
  }
  if (body.duration != null && typeof body.duration !== "number") {
    return { valid: false, reason: "duration must be a number." };
  }

  return { valid: true };
}

/** Largest webhook body accepted. A real transcript is far below this. */
export const MAX_WEBHOOK_BYTES = 1_000_000;
