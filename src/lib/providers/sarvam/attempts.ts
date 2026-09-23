// ============================================================
// Sarvam Voice Agents — Attempt Status Polling
// ============================================================
//
// A second source of truth for what happened on a call.
//
// The completion webhook is authoritative and carries everything — transcript,
// agent variables, summary — but it only arrives when Sarvam decides the attempt
// is over, and it is lost entirely if the public URL was unreachable at that
// moment. Two failures follow from relying on it alone:
//
//   - Someone declines the call and Dialo still shows "waiting for provider"
//     long afterwards, because no webhook has arrived yet.
//   - A call whose webhook was lost sits in `calling` for ever.
//
// Sarvam's documented analytics endpoint answers both:
//
//   GET /api/analytics/v1/{org}/{workspace}/{app}/attempts?start_datetime&end_datetime
//
// It reports `connectivity_status` per attempt. This module reads it. It never
// invents anything: a status here is Sarvam's own record, and the richer
// conversation data still comes from the webhook.
// ============================================================

import type { CallStatus } from "@/lib/types";

const SARVAM_ANALYTICS = "https://apps.sarvam.ai/api/analytics/v1";

export interface SarvamAttempt {
  attempt_id: string;
  interaction_id: string | null;
  connectivity_status: string | null;
  failure_reason: string | null;
  ended_by: string | null;
  duration_in_seconds: number | null;
  num_messages: number | null;
  start_datetime: string | null;
  end_datetime: string | null;
}

export interface ProviderAttemptStatus {
  attemptId: string;
  status: CallStatus | null;
  duration: number | null;
  interactionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
  endedBy: string | null;
}

function readEnv(name: string): string {
  return (process.env[name] || "").trim().replace(/^["']|["']$/g, "");
}

const STATUS_MAP: Record<string, CallStatus> = {
  connected: "connected",
  completed: "connected",
  no_answer: "no_answer",
  noanswer: "no_answer",
  unanswered: "no_answer",
  busy: "busy",
  failed: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/** Null for anything unrecognised, or for an attempt still in progress. */
export function mapConnectivityStatus(raw: string | null | undefined): CallStatus | null {
  if (!raw) return null;
  const key = raw.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (key === "in_progress" || key === "ongoing" || key === "initiated" || key === "ringing") {
    return null;
  }
  return STATUS_MAP[key] ?? null;
}

/**
 * Sarvam's own timestamps are naive (`2026-09-22T15:23:32`) and are in UTC.
 * Parsing them without a zone would shift every call by the server's offset.
 */
function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalised = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// A short cache, so a browser polling every two seconds does not become two
// requests per second against Sarvam.
const CACHE_TTL_MS = 4000;
let cache: { key: string; at: number; attempts: SarvamAttempt[] } | null = null;

export function isAttemptPollingConfigured(): boolean {
  return Boolean(
    readEnv("SARVAM_API_KEY") &&
      readEnv("SARVAM_ORG_ID") &&
      readEnv("SARVAM_WORKSPACE_ID") &&
      (readEnv("SARVAM_APP_ID") || readEnv("SARVAM_AGENT_ID"))
  );
}

/** Attempts Sarvam recorded in a window. Empty on any failure — never throws. */
export async function fetchAttempts(fromIso: string, toIso: string): Promise<SarvamAttempt[]> {
  if (!isAttemptPollingConfigured()) return [];

  const key = `${fromIso}|${toIso}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.attempts;
  }

  const org = readEnv("SARVAM_ORG_ID");
  const workspace = readEnv("SARVAM_WORKSPACE_ID");
  const app = readEnv("SARVAM_APP_ID") || readEnv("SARVAM_AGENT_ID");

  const url =
    `${SARVAM_ANALYTICS}/${encodeURIComponent(org)}/${encodeURIComponent(workspace)}/${encodeURIComponent(app)}/attempts` +
    `?start_datetime=${encodeURIComponent(fromIso)}&end_datetime=${encodeURIComponent(toIso)}&limit=200`;

  try {
    const response = await fetch(url, {
      headers: { "X-API-Key": readEnv("SARVAM_API_KEY") },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.warn(`ATTEMPT_POLL_FAILED http=${response.status}`);
      return [];
    }
    const body = (await response.json()) as { items?: SarvamAttempt[] };
    const attempts = Array.isArray(body.items) ? body.items : [];
    cache = { key, at: Date.now(), attempts };
    return attempts;
  } catch (error: unknown) {
    console.warn(
      "ATTEMPT_POLL_ERROR",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

/**
 * Sarvam's record of one attempt, looked up around when Dialo placed it.
 * Returns null while the attempt is still running or if Sarvam has no row yet.
 */
export async function getProviderAttemptStatus(
  attemptId: string,
  placedAtIso: string | null
): Promise<ProviderAttemptStatus | null> {
  const placedAt = placedAtIso ? new Date(placedAtIso).getTime() : Date.now();
  // A window around the call: generous enough for clock skew and retries.
  const from = new Date(placedAt - 60 * 60 * 1000).toISOString();
  const to = new Date(Math.min(Date.now() + 5 * 60 * 1000, placedAt + 6 * 60 * 60 * 1000)).toISOString();

  const attempts = await fetchAttempts(from, to);
  const attempt = attempts.find((item) => item.attempt_id === attemptId);
  if (!attempt) return null;

  const status = mapConnectivityStatus(attempt.connectivity_status);

  return {
    attemptId,
    status,
    duration:
      typeof attempt.duration_in_seconds === "number" && attempt.duration_in_seconds > 0
        ? Math.round(attempt.duration_in_seconds)
        : null,
    interactionId:
      attempt.interaction_id && attempt.interaction_id !== "NO_INTERACTION_ID"
        ? attempt.interaction_id
        : null,
    startedAt: toIso(attempt.start_datetime),
    endedAt: toIso(attempt.end_datetime),
    // Sarvam writes these placeholders when it has nothing to say.
    failureReason:
      attempt.failure_reason && attempt.failure_reason !== "NO_FAILURE_REASON"
        ? attempt.failure_reason
        : null,
    endedBy: attempt.ended_by && attempt.ended_by !== "NO_END_REASON" ? attempt.ended_by : null,
  };
}
