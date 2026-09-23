// ============================================================
// Dialo AI — Display Formatting
// ============================================================
// One rule, applied everywhere: a value Dialo does not have renders as an em
// dash. No "0%", no "N/A", no invented placeholder text standing in for a
// number that was never measured.
// ============================================================

import type { CallStatus, InterestLevel } from "@/lib/types";

export const EMPTY = "—";

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return EMPTY;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) return `${remainder}s`;
  return `${minutes}m ${remainder}s`;
}

export function formatClock(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return EMPTY;
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  return `${value.toFixed(digits)}%`;
}

/** Signed delta, for week-over-week style comparisons. Null means no baseline existed. */
export function formatDelta(value: number | null | undefined, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}${suffix}`;
}

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY;
  return value.toLocaleString();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return `${formatDate(value)} · ${formatTime(value)}`;
}

export function formatText(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY;
}

export function formatInterest(value: InterestLevel | string | null | undefined): string {
  if (!value) return EMPTY;
  const lowered = String(value).toLowerCase();
  if (lowered === "high") return "High";
  if (lowered === "medium") return "Medium";
  if (lowered === "low") return "Low";
  if (lowered === "none") return "None";
  return EMPTY;
}

// ------------------------------------------------------------
// Status vocabulary
// ------------------------------------------------------------

export interface StatusPresentation {
  label: string;
  /** Short sentence explaining what the state actually means. */
  description: string;
  tone: "neutral" | "pending" | "positive" | "warning" | "negative";
}

/**
 * Labels for every call state.
 *
 * `calling` deliberately reads "Waiting for provider" rather than "Ringing":
 * Sarvam's instant-outbound webhook reports the outcome of the attempt, not
 * per-leg ring events, so Dialo cannot honestly claim the phone is ringing.
 */
const CALL_STATUS: Record<CallStatus, StatusPresentation> = {
  queued: { label: "Queued", description: "Not yet dialled.", tone: "neutral" },
  scheduled: { label: "Scheduled", description: "Queued for a later time.", tone: "neutral" },
  suppressed: {
    label: "Do not call",
    description: "Suppressed — this lead asked not to be contacted.",
    tone: "negative",
  },
  initiating: {
    label: "Calling",
    description: "Sending the request to Sarvam.",
    tone: "pending",
  },
  calling: {
    label: "Waiting for provider",
    description: "Sarvam accepted the call. Waiting for the outcome.",
    tone: "pending",
  },
  connected: {
    label: "Connected",
    description: "The customer answered and spoke with the agent.",
    tone: "positive",
  },
  no_answer: { label: "Not picked", description: "Nobody picked up.", tone: "neutral" },
  // "Declined" is said only here, where the provider's own `busy` supports it.
  busy: {
    label: "Busy / declined",
    description: "The line was busy, or the person declined the call.",
    tone: "warning",
  },
  failed: {
    label: "Call failed",
    // Sarvam reports these with no reason at all, so the honest wording covers
    // what it actually means: the call never reached the agent.
    description: "The call never connected. It may have been declined, or the number may be switched off or unreachable.",
    tone: "negative",
  },
  cancelled: { label: "Cancelled", description: "The attempt was cancelled.", tone: "neutral" },
  provider_error: {
    label: "Provider error",
    description: "Sarvam rejected or could not place the call.",
    tone: "negative",
  },
};

export function callStatusPresentation(status: string | null | undefined): StatusPresentation {
  if (status && status in CALL_STATUS) return CALL_STATUS[status as CallStatus];
  return { label: EMPTY, description: "Status unknown.", tone: "neutral" };
}

/**
 * How long Dialo waits for a completion webhook before it stops describing a
 * call as in progress. Sarvam delivers the result when the attempt ends, so an
 * attempt still silent after this has almost certainly lost its webhook.
 */
export const RESULT_TIMEOUT_MS = 15 * 60 * 1000;

const NO_RESULT: StatusPresentation = {
  label: "No result received",
  description:
    "The call was placed, but Sarvam never delivered a result. Usually the webhook URL was unreachable. What happened on the call is unknown.",
  tone: "warning",
};

/**
 * Presentation for a whole call, rather than its status alone.
 *
 * An attempt stuck in `calling` long past the timeout is reported as "no result
 * received" — a statement about what Dialo knows, not a claim that the phone is
 * still ringing. Pass `now` from a ticking clock so this updates on its own.
 */
export function callStatePresentation(
  status: string | null | undefined,
  requestedAt: string | null | undefined,
  now: number
): StatusPresentation {
  if ((status === "calling" || status === "initiating") && requestedAt && now > 0) {
    const age = now - new Date(requestedAt).getTime();
    if (Number.isFinite(age) && age > RESULT_TIMEOUT_MS) return NO_RESULT;
  }
  return callStatusPresentation(status);
}

const OUTCOME_LABELS: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  follow_up: "Callback requested",
  human_handoff: "Human handoff",
  do_not_call: "Do not call",
  uncertain: "No clear outcome",
};

export function formatOutcome(value: string | null | undefined): string {
  if (!value) return EMPTY;
  return OUTCOME_LABELS[value] ?? EMPTY;
}

const FOLLOW_UP_LABELS: Record<string, string> = {
  needs_scheduling: "Needs a time",
  scheduled: "Scheduled",
  triggering: "Placing call",
  retry_pending: "Retrying",
  no_answer: "No answer",
  busy: "Busy",
  due: "Due",
  calling: "Calling",
  completed: "Completed",
  rescheduled: "Rescheduled",
  missed: "Missed",
  cancelled: "Cancelled",
  failed: "Failed",
};

export function formatFollowUpStatus(value: string | null | undefined): string {
  if (!value) return EMPTY;
  return FOLLOW_UP_LABELS[value] ?? EMPTY;
}
