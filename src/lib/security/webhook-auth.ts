// ============================================================
// Tringlo AI — Webhook Authentication
// ============================================================
//
// Sarvam's outbound `webhook_config` takes a URL and optional metadata. It does
// not offer a signing secret or custom headers for this webhook, so there is no
// provider signature to verify — inventing one would only look like security.
//
// What is available is the URL itself, which Tringlo controls. So the endpoint is
// protected by an unguessable token carried in the query string, plus strict
// payload validation and rate limiting.
//
// A second line already exists underneath this: the event reducer refuses to
// create anything for an `attempt_id` it did not place, so even an accepted
// request cannot inject a call that never happened.
// ============================================================

import { findTenantByWebhookToken } from "@/lib/db";

export type WebhookAuthResult =
  | {
      ok: true;
      mode: "token";
      /**
       * The workspace whose token was presented, when it was a workspace one.
       * Never the only thing a handler routes on: a delivery is matched to its
       * workspace by provider identifier, and this is checked against that.
       */
      tenantId?: string | null;
    }
  | { ok: false; reason: string };

/**
 * Checks the token on an incoming webhook.
 *
 * With no token configured the endpoint stays open, because closing it silently
 * would drop the results of calls already in flight. The health endpoint reports
 * that state as a warning rather than leaving it unnoticed.
 */
/**
 * Checks the token on an incoming webhook.
 *
 * Only a workspace's own token is accepted. The server-wide
 * `DIALO_WEBHOOK_TOKEN` is no longer honoured at runtime: it identified no
 * workspace, so a delivery carrying it could be authenticated without anyone
 * knowing whose call it was.
 *
 * This authenticates; it does not route. Which workspace a call belongs to is
 * still decided by the provider's own identifiers, and a handler compares the
 * two.
 */
export function authenticateWebhook(request: Request): WebhookAuthResult {
  // The token may arrive in a header — preferred, because it is kept out of
  // URLs and request logs — or in the query string, which Sarvam's call-result
  // webhook requires (its callback config carries no headers). A header wins.
  const provided = tokenFromHeader(request) || new URL(request.url).searchParams.get("k");
  if (!provided) return { ok: false, reason: "Missing webhook token." };

  const tenantId = findTenantByWebhookToken(provided);
  if (!tenantId) return { ok: false, reason: "Unrecognised webhook token." };

  return { ok: true, mode: "token", tenantId };
}

/** The workspace token from `Authorization: Bearer <token>` or `X-Webhook-Token`. */
function tokenFromHeader(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth) {
    const bearer = auth.match(/^Bearer\s+(.+)$/i);
    if (bearer) return bearer[1].trim();
  }
  const custom = request.headers.get("x-webhook-token") || request.headers.get("x-workspace-token");
  return custom ? custom.trim() : null;
}

/**
 * Appends a token to the URL registered with Sarvam.
 *
 * Each workspace has its own, so a delivery can be tied to the workspace that
 * registered it. The server-wide token is the fallback for anything registered
 * before per-workspace tokens existed.
 */
export function withWebhookToken(url: string, workspaceToken?: string | null): string {
  const token = workspaceToken?.trim();
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

  // Inbound completions identify the call by interaction_id instead.
  const attemptId = body.attempt_id ?? (body.deployment_id ? body.interaction_id : undefined);
  if (typeof attemptId !== "string" || attemptId.trim().length === 0) {
    return { valid: false, reason: "attempt_id (or, for inbound, interaction_id) is required." };
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
