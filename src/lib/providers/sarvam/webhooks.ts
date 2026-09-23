// ============================================================
// Sarvam Voice Agents — Webhook Parser
// ============================================================
//
// Pure parsing. No side effects, no defaults, no invented values.
//
// The one rule this file exists to enforce: a field is populated only when
// Sarvam actually sent it. Where Sarvam sent nothing, the parsed result holds
// `null` and the UI renders an em dash. In particular there is no synthetic
// "tomorrow at 11:00" callback, no "Summary not available." text written into
// the summary field, and no status that defaults to `connected`.
// ============================================================

import type { CallStatus, InterestLevel, TranscriptTurn } from "@/lib/types";
import { resolveCallbackRequest } from "@/lib/scheduling/time";
import type {
  SarvamOutputVariables,
  SarvamTranscriptTurn,
  SarvamWebhookPayload,
} from "./types";

// ------------------------------------------------------------
// Coercion helpers
// ------------------------------------------------------------

/** Trimmed non-empty string, else null. Rejects the placeholders agents emit for "nothing". */
export function cleanString(raw: unknown): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const lowered = value.toLowerCase();
  if (
    lowered === "null" ||
    lowered === "undefined" ||
    lowered === "n/a" ||
    lowered === "na" ||
    lowered === "not available" ||
    lowered === "unknown" ||
    /^<.*>$/.test(value)
  ) {
    return null;
  }
  return value;
}

/** Strict tri-state boolean: true / false / null (not reported). */
export function cleanBoolean(raw: unknown): boolean | null {
  if (raw === true) return true;
  if (raw === false) return false;
  const value = cleanString(raw);
  if (value === null) return null;
  const lowered = value.toLowerCase();
  if (["true", "yes", "y", "1"].includes(lowered)) return true;
  if (["false", "no", "n", "0"].includes(lowered)) return false;
  return null;
}

/**
 * Confidence normalised to 0-100, or null.
 * A 0-1 fraction is scaled; anything outside 0-100 is rejected rather than clamped,
 * because a nonsense value is not evidence of confidence.
 */
export function cleanConfidence(raw: unknown): number | null {
  const value = cleanString(raw);
  if (value === null) return null;
  const numeric = Number(value.replace("%", "").trim());
  if (!Number.isFinite(numeric)) return null;
  if (numeric > 0 && numeric <= 1) return Math.round(numeric * 100);
  if (numeric < 0 || numeric > 100) return null;
  return Math.round(numeric);
}

export function cleanInterestLevel(raw: unknown): InterestLevel | null {
  const value = cleanString(raw);
  if (value === null) return null;
  const lowered = value.toLowerCase();
  if (lowered === "high" || lowered === "medium" || lowered === "low") return lowered;
  if (lowered === "none" || lowered === "no interest") return "none";
  return null;
}

/** Positive integer seconds, or null. Zero is not a duration worth reporting. */
export function cleanDuration(raw: unknown): number | null {
  if (raw == null) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

export function cleanTimestamp(raw: unknown): string | null {
  const value = cleanString(raw);
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// ------------------------------------------------------------
// Status mapping
// ------------------------------------------------------------

const STATUS_MAP: Record<string, CallStatus> = {
  connected: "connected",
  answered: "connected",
  completed: "connected",
  success: "connected",
  no_answer: "no_answer",
  noanswer: "no_answer",
  unanswered: "no_answer",
  busy: "busy",
  failed: "failed",
  failure: "failed",
  error: "failed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/**
 * Maps a Sarvam status onto a Dialo call status.
 *
 * Returns null for anything unrecognised. The caller must then leave the call in
 * its current state — guessing `connected` here is exactly the fabrication this
 * pipeline exists to eliminate.
 */
export function mapSarvamStatus(payload: SarvamWebhookPayload): CallStatus | null {
  const candidates = [payload.status, payload.connectivity_status, payload.completion_status];

  for (const candidate of candidates) {
    const value = cleanString(candidate);
    if (value === null) continue;
    const key = value.toLowerCase().replace(/[\s-]+/g, "_");
    if (STATUS_MAP[key]) return STATUS_MAP[key];
  }

  return null;
}

// ------------------------------------------------------------
// Output variables
// ------------------------------------------------------------

/**
 * Merges the two variable bags Sarvam may send. `final_agent_variables` is the
 * authoritative end-of-call snapshot and wins on conflict; `output_agent_variables`
 * fills gaps. Empty values never overwrite real ones.
 */
export function mergeOutputVariables(
  payload: SarvamWebhookPayload
): SarvamOutputVariables | null {
  const output = payload.output_agent_variables;
  const final = payload.final_agent_variables;
  if (!output && !final) return null;

  const merged: SarvamOutputVariables = {};
  for (const source of [output, final]) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined || value === "") continue;
      merged[key] = value;
    }
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

// ------------------------------------------------------------
// Transcript
// ------------------------------------------------------------

function normaliseRole(raw: unknown): TranscriptTurn["role"] {
  const value = (cleanString(raw) || "").toLowerCase();
  if (value === "agent" || value === "assistant" || value === "bot") return "agent";
  if (value === "system") return "system";
  return "user";
}

export interface ParsedTranscript {
  turns: TranscriptTurn[];
  text: string;
}

/**
 * Builds the transcript from `interaction_transcript` only. If Sarvam sent no
 * turns — or only empty ones — the result is null and the UI shows no transcript.
 */
export function parseTranscript(
  turns: SarvamTranscriptTurn[] | null | undefined,
  agentName: string
): ParsedTranscript | null {
  if (!Array.isArray(turns) || turns.length === 0) return null;

  const parsed: TranscriptTurn[] = [];
  for (const turn of turns) {
    const text = cleanString(turn?.en_text) ?? cleanString(turn?.text);
    if (text === null) continue;
    parsed.push({
      role: normaliseRole(turn?.role),
      text,
      startTime: typeof turn?.start_time === "number" ? turn.start_time : null,
      endTime: typeof turn?.end_time === "number" ? turn.end_time : null,
    });
  }

  if (parsed.length === 0) return null;

  const text = parsed
    .map((turn) => {
      const speaker =
        turn.role === "agent" ? agentName : turn.role === "system" ? "System" : "Customer";
      return `${speaker}: ${turn.text}`;
    })
    .join("\n\n");

  return { turns: parsed, text };
}

// ------------------------------------------------------------
// Follow-up resolution
// ------------------------------------------------------------

export interface ResolvedFollowUp {
  required: boolean;
  /** ISO datetime, or null when Sarvam asked for a callback without a usable time. */
  scheduledTime: string | null;
  /** The raw value Sarvam sent, retained even when it could not be parsed. */
  rawRequest: string | null;
  timezone: string | null;
  date: string | null;
  time: string | null;
  interest: InterestLevel | null;
  notes: string | null;
  nextAction: string | null;
  /** True when a callback was requested but no exact datetime could be derived. */
  unparseable: boolean;
  /** How the request was understood, shown beside the customer's own wording. */
  interpretation: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/**
 * Server-side validation of the callback Sarvam requested.
 *
 * A follow-up is created only when the agent actually asked for one. The time comes
 * from `follow_up_date` + `follow_up_time`, or from `next_step_date_time`. If neither
 * parses the follow-up is still recorded — dropping it would lose a real customer
 * request — but with `scheduledTime: null`, so the UI prompts for a time rather than
 * inventing one.
 */
export interface ResolveFollowUpOptions {
  /** Instant the call ended, which is what "in 5 minutes" is relative to. */
  now: number;
  /** The customer's timezone, from the lead. */
  timezone: string;
}

export function resolveFollowUp(
  vars: SarvamOutputVariables | null,
  options: ResolveFollowUpOptions
): ResolvedFollowUp | null {
  if (!vars) return null;

  const explicitFlag = cleanBoolean(vars.follow_up_required);
  const outcome = (cleanString(vars.call_outcome) || "").toUpperCase().replace(/[\s-]+/g, "_");
  const disposition = (
    cleanString(vars.call_disposition) ??
    cleanString(vars.disposition) ??
    ""
  )
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  const date = cleanString(vars.follow_up_date);
  const time = cleanString(vars.follow_up_time);
  const nextStep = cleanString(vars.next_step_date_time);

  const outcomeAsksCallback =
    outcome === "CALL_BACK" ||
    outcome === "CALLBACK" ||
    disposition === "CALL_BACK" ||
    disposition === "CALLBACK";

  const required =
    explicitFlag === true || outcomeAsksCallback || Boolean(date) || Boolean(nextStep);

  if (!required) return null;

  // A do-not-call request overrides any callback the agent also recorded.
  if (cleanBoolean(vars.do_not_call) === true || outcome === "DO_NOT_CALL") return null;

  const timezone = cleanString(vars.follow_up_timezone) ?? options.timezone;

  // The cleanest case: the agent gave a well-formed date and time.
  const validDate = date && DATE_RE.test(date) ? date : null;
  const validTime = time && TIME_RE.test(time) ? (time.length === 5 ? `${time}:00` : time) : null;

  let resolved: ReturnType<typeof resolveCallbackRequest> | null = null;

  if (validDate && validTime) {
    resolved = resolveCallbackRequest(`${validDate}T${validTime}`, {
      now: options.now,
      timezone,
    });
  }

  // Otherwise read whatever the agent passed through — agents frequently return
  // the customer's own phrasing ("in 5 minutes", "tomorrow at 4 PM") rather than
  // a resolved timestamp, and a request Dialo cannot read is a request lost.
  if (!resolved || resolved.kind !== "exact") {
    for (const candidate of [nextStep, date && time ? `${date} ${time}` : null, date, time]) {
      if (!candidate) continue;
      const attempt = resolveCallbackRequest(candidate, { now: options.now, timezone });
      if (!resolved || attempt.kind === "exact" || (attempt.kind === "dateOnly" && resolved.kind === "vague")) {
        resolved = attempt;
      }
      if (resolved.kind === "exact") break;
    }
  }

  if (!resolved) {
    resolved = resolveCallbackRequest(null, { now: options.now, timezone });
  }

  const rawRequest = nextStep ?? (date && time ? `${date} ${time}` : date ?? time);

  return {
    required: true,
    // Only an exact instant may be scheduled. A date without a time is recorded
    // and surfaced for the time to be asked for — never filled in by Dialo.
    scheduledTime: resolved.kind === "exact" ? resolved.instant : null,
    rawRequest,
    timezone,
    date: resolved.date,
    time: resolved.time,
    interest: cleanInterestLevel(vars.interest_level),
    notes: cleanString(vars.call_summary) ?? cleanString(vars.summary),
    nextAction: cleanString(vars.chosen_next_step) ?? cleanString(vars.next_action),
    unparseable: resolved.kind !== "exact",
    interpretation: resolved.interpretation,
  };
}

// ------------------------------------------------------------
// Parsed event
// ------------------------------------------------------------

export interface ParsedSarvamEvent {
  attemptId: string;
  /** Null when Sarvam sent a status Dialo does not recognise. */
  status: CallStatus | null;
  rawStatus: string | null;
  connectivityStatus: string | null;
  completionStatus: string | null;

  leadId: string | null;
  callId: string | null;

  duration: number | null;
  interactionId: string | null;
  failureReason: string | null;
  recordingUrl: string | null;
  startedAt: string | null;
  endedAt: string | null;
  customerPhone: string | null;

  transcript: ParsedTranscript | null;
  outputVariables: SarvamOutputVariables | null;

  summary: string | null;
  callOutcome: string | null;
  callDisposition: string | null;
  interestLevel: InterestLevel | null;
  interestConfidence: number | null;
  painPoints: string | null;
  objection: string | null;
  customerRequirement: string | null;
  budgetIndication: string | null;
  timelineToDecide: string | null;
  authorityLevel: string | null;
  competitorMentioned: string | null;
  discoveryFitScore: string | null;
  nextAction: string | null;
  chosenNextStep: string | null;
  nextStepDateTime: string | null;

  doNotCall: boolean;
  humanHandoff: boolean;
  followUp: ResolvedFollowUp | null;
}

function joinRequirement(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const parts = raw
      .map((item) => cleanString(item))
      .filter((item): item is string => item !== null);
    return parts.length > 0 ? parts.join("; ") : null;
  }
  return cleanString(raw);
}

/**
 * Turns a raw webhook body into a fully validated event.
 *
 * Conversation-derived fields are read only when the call connected: an unanswered
 * or failed attempt has no summary, transcript or interest, so reading those bags at
 * all would only let stale values leak into the record.
 */
export function parseSarvamWebhook(
  payload: SarvamWebhookPayload,
  options: { agentName?: string; timezone?: string; now?: number } = {}
): ParsedSarvamEvent {
  const agentName = options.agentName?.trim() || "Agent";
  const timezone = options.timezone?.trim() || "Asia/Kolkata";
  const status = mapSarvamStatus(payload);

  const metadata = {
    ...(payload.webhook_config?.metadata || {}),
    ...(payload.metadata || {}),
  } as Record<string, unknown>;

  const base = {
    attemptId: String(payload.attempt_id),
    status,
    rawStatus: cleanString(payload.status),
    connectivityStatus: cleanString(payload.connectivity_status),
    completionStatus: cleanString(payload.completion_status),
    leadId: cleanString(metadata.lead_id) ?? cleanString(metadata.leadId),
    callId: cleanString(metadata.callId) ?? cleanString(metadata.call_id),
    duration: cleanDuration(payload.duration),
    interactionId: cleanString(payload.interaction_id),
    failureReason: cleanString(payload.failure_reason),
    recordingUrl: cleanString(payload.recording_url),
    startedAt: cleanTimestamp(payload.start_datetime),
    endedAt: cleanTimestamp(payload.end_datetime),
    customerPhone:
      cleanString(payload.user_phone_number) ?? cleanString(payload.channel_info?.to_number),
  };

  const empty: ParsedSarvamEvent = {
    ...base,
    transcript: null,
    outputVariables: null,
    summary: null,
    callOutcome: null,
    callDisposition: null,
    interestLevel: null,
    interestConfidence: null,
    painPoints: null,
    objection: null,
    customerRequirement: null,
    budgetIndication: null,
    timelineToDecide: null,
    authorityLevel: null,
    competitorMentioned: null,
    discoveryFitScore: null,
    nextAction: null,
    chosenNextStep: null,
    nextStepDateTime: null,
    doNotCall: false,
    humanHandoff: false,
    followUp: null,
  };

  // No conversation happened — there is nothing more to read.
  if (status !== "connected") return empty;

  const transcript = parseTranscript(payload.interaction_transcript, agentName);
  const vars = mergeOutputVariables(payload);
  if (!vars) return { ...empty, transcript };

  const outcome = cleanString(vars.call_outcome);
  const normalisedOutcome = (outcome || "").toUpperCase().replace(/[\s-]+/g, "_");

  return {
    ...empty,
    transcript,
    outputVariables: vars,
    summary: cleanString(vars.call_summary) ?? cleanString(vars.summary),
    callOutcome: outcome,
    callDisposition: cleanString(vars.call_disposition) ?? cleanString(vars.disposition),
    interestLevel: cleanInterestLevel(vars.interest_level),
    interestConfidence: cleanConfidence(vars.interest_confidence),
    painPoints: cleanString(vars.pain_points) ?? cleanString(vars.pain_points_mentioned),
    objection: cleanString(vars.objection) ?? cleanString(vars.rejection_reason),
    customerRequirement: joinRequirement(vars.customer_requirement),
    budgetIndication: cleanString(vars.budget_indication),
    timelineToDecide: cleanString(vars.timeline_to_decide),
    authorityLevel: cleanString(vars.authority_level),
    competitorMentioned: cleanString(vars.competitor_mentioned),
    discoveryFitScore: cleanString(vars.discovery_fit_score_estimate),
    nextAction: cleanString(vars.next_action),
    chosenNextStep: cleanString(vars.chosen_next_step),
    nextStepDateTime: cleanString(vars.next_step_date_time),
    doNotCall: cleanBoolean(vars.do_not_call) === true || normalisedOutcome === "DO_NOT_CALL",
    humanHandoff:
      cleanBoolean(vars.human_handoff_required) === true ||
      normalisedOutcome === "HUMAN_HANDOFF",
    // Relative requests resolve against when the call ended, not when the
    // webhook happened to be processed.
    followUp: resolveFollowUp(vars, {
      now: base.endedAt ? new Date(base.endedAt).getTime() : options.now ?? Date.now(),
      timezone,
    }),
  };
}

// ------------------------------------------------------------
// AI result derivation
// ------------------------------------------------------------

export type DerivedAiStatus =
  | "interested"
  | "not_interested"
  | "follow_up"
  | "human_handoff"
  | "do_not_call"
  | "uncertain";

/**
 * Derives the structured outcome from what the agent reported.
 *
 * Falls back to `uncertain` rather than `interested`: a connected call with no
 * disposition is an unknown outcome, not a win.
 */
export function deriveAiStatus(event: ParsedSarvamEvent): DerivedAiStatus {
  if (event.doNotCall) return "do_not_call";
  if (event.humanHandoff) return "human_handoff";

  const outcome = (event.callOutcome || event.callDisposition || "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (outcome === "INTERESTED") return "interested";
  if (outcome === "NOT_INTERESTED") return "not_interested";
  if (outcome === "CALL_BACK" || outcome === "CALLBACK") return "follow_up";

  if (event.followUp?.required) return "follow_up";
  if (event.interestLevel === "high") return "interested";
  if (event.interestLevel === "none") return "not_interested";

  return "uncertain";
}
