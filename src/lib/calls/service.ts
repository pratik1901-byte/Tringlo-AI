// ============================================================
// Dialo AI — Call Lifecycle Service
// ============================================================
// The single place where a Sarvam webhook becomes durable state.
//
// Both webhook routes funnel through `applySarvamEvent`, so correlation,
// idempotency, do-not-call suppression and follow-up creation behave identically
// no matter which endpoint Sarvam posts to.
// ============================================================

import {
  fingerprintWebhook,
  getCallRecord,
  getFollowUpByExecutedAttempt,
  getCallRecordByAttemptId,
  getLead,
  hasProcessedWebhook,
  recordWebhookReceipt,
  saveCallRecord,
  saveFollowUp,
  saveRawEvent,
  suppressLead,
  updateFollowUp,
  updateLead,
} from "@/lib/db";
import { deriveAiStatus, parseSarvamWebhook } from "@/lib/providers/sarvam/webhooks";
import { prefetchRecordingLater } from "@/lib/recordings";
import { recordCallInMemory } from "@/lib/memory/service";
import type { SarvamWebhookPayload } from "@/lib/providers/sarvam/types";
import type { AICallResult, CallRecord, CallStatus, FollowUp, Lead } from "@/lib/types";
import { isTerminalCallStatus } from "@/lib/types";

export type ApplyOutcome =
  | "applied"
  | "duplicate"
  | "unknown_status"
  | "unknown_attempt"
  | "stale";

export interface ApplyResult {
  outcome: ApplyOutcome;
  attemptId: string;
  callId: string | null;
  status: string | null;
  record: CallRecord | null;
  followUpId: string | null;
  suppressed: boolean;
  detail?: string;
}

/**
 * The name to label agent turns with.
 *
 * Taken from the call record, so a transcript is labelled with the agent that
 * actually ran that call rather than whatever the deployment is configured with
 * today. Falls back to a neutral label rather than a hardcoded persona.
 */
function agentLabel(record?: CallRecord): string {
  return (
    record?.agentName?.trim() ||
    process.env.SARVAM_AGENT_NAME?.trim() ||
    "Agent"
  );
}

/**
 * Applies one Sarvam webhook body.
 *
 * Every early return leaves existing state untouched: an unrecognised status, an
 * attempt Dialo never triggered, or a late event arriving after a terminal one
 * are all cases where doing nothing is more honest than writing a guess.
 */
/** How long to wait before retrying a callback nobody picked up. */
const RETRY_DELAY_MS = 15 * 60 * 1000;
/** Attempts at reaching someone before the callback is handed to a person. */
const MAX_CALLBACK_ATTEMPTS = 3;

/**
 * Closes out the follow-up whose callback this webhook is reporting on.
 *
 * Without this a triggered follow-up sat at `calling` forever: the call itself
 * was recorded correctly, but nothing ever linked the result back to the row
 * that caused it, so the Follow-ups page showed a callback permanently in
 * progress and the scheduler could never retry an unanswered one.
 */
function closeTriggeredFollowUp(
  attemptId: string,
  status: CallStatus,
  event: { interactionId: string | null; failureReason: string | null }
): string | null {
  const followUp = getFollowUpByExecutedAttempt(attemptId);
  if (!followUp) return null;

  const attempts = followUp.executionAttempts ?? 1;
  const base = {
    interactionId: event.interactionId,
    failureReason: event.failureReason,
    lockedAt: null,
  };

  if (status === "connected") {
    updateFollowUp(followUp.id, { ...base, status: "completed", nextAttemptAt: null });
    console.log(`FOLLOW_UP_COMPLETED followUp=${followUp.id} attempt=${attemptId}`);
    return followUp.id;
  }

  // Nobody picked up. Worth another try, but not indefinitely.
  if (status === "no_answer" || status === "busy") {
    if (attempts < MAX_CALLBACK_ATTEMPTS) {
      const nextAttemptAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      updateFollowUp(followUp.id, { ...base, status: "retry_pending", nextAttemptAt });
      console.log(
        `FOLLOW_UP_RETRY_QUEUED followUp=${followUp.id} status=${status} attempt=${attempts} next=${nextAttemptAt}`
      );
    } else {
      updateFollowUp(followUp.id, { ...base, status, nextAttemptAt: null });
      console.log(`FOLLOW_UP_EXHAUSTED followUp=${followUp.id} status=${status} attempts=${attempts}`);
    }
    return followUp.id;
  }

  updateFollowUp(followUp.id, { ...base, status: "failed", nextAttemptAt: null });
  console.log(`FOLLOW_UP_FAILED followUp=${followUp.id} status=${status}`);
  return followUp.id;
}

export function applySarvamEvent(rawPayload: SarvamWebhookPayload): ApplyResult {
  const attemptId = String(rawPayload?.attempt_id || "").trim();
  const payloadRecord = rawPayload as unknown as Record<string, unknown>;

  saveRawEvent(payloadRecord, attemptId || undefined, String(rawPayload?.status ?? ""));
  console.log(`WEBHOOK_RECEIVED attempt=${attemptId || "none"} status=${rawPayload?.status ?? "none"}`);

  if (!attemptId) {
    return {
      outcome: "unknown_attempt",
      attemptId: "",
      callId: null,
      status: null,
      record: null,
      followUpId: null,
      suppressed: false,
      detail: "Webhook payload carried no attempt_id, so it cannot be correlated to a call.",
    };
  }

  // Correlate first: the transcript is labelled with this call's agent, and a
  // relative callback ("in 5 minutes") is resolved in the customer's timezone.
  const correlated = getCallRecordByAttemptId(attemptId);
  const event = parseSarvamWebhook(rawPayload, {
    agentName: agentLabel(correlated),
    timezone: correlated?.lead?.timezone || "Asia/Kolkata",
  });

  const base: ApplyResult = {
    outcome: "applied",
    attemptId,
    callId: null,
    status: event.status,
    record: null,
    followUpId: null,
    suppressed: false,
  };

  // Idempotency: a redelivery of an event already applied changes nothing.
  const fingerprint = fingerprintWebhook(payloadRecord);
  if (hasProcessedWebhook(attemptId, fingerprint)) {
    console.log(`WEBHOOK_DUPLICATE_IGNORED attempt=${attemptId}`);
    return { ...base, outcome: "duplicate", detail: "Event already applied." };
  }

  if (event.status === null) {
    return {
      ...base,
      outcome: "unknown_status",
      detail: `Sarvam reported an unrecognised status (${event.rawStatus ?? "none"}); call left unchanged.`,
    };
  }

  // Correlate: attempt_id first, then the callId Dialo put in webhook metadata.
  const existing = correlated || (event.callId ? getCallRecord(event.callId) : undefined);

  if (!existing) {
    return {
      ...base,
      outcome: "unknown_attempt",
      detail: `No call record matches attempt ${attemptId}. Not creating one — Dialo did not place this call.`,
    };
  }

  // A terminal call does not go backwards. Late duplicates of an earlier state are ignored.
  if (isTerminalCallStatus(existing.status) && existing.status !== event.status) {
    recordWebhookReceipt(attemptId, fingerprint, event.status);
    return {
      ...base,
      outcome: "stale",
      callId: existing.id,
      record: existing,
      detail: `Call is already ${existing.status}; refusing to overwrite with ${event.status}.`,
    };
  }

  const lead: Lead | undefined = getLead(existing.leadId) || existing.lead;
  const connected = event.status === "connected";

  const aiResult: AICallResult | null = connected
    ? {
        status: deriveAiStatus(event),
        interest_level: event.interestLevel,
        callback_required: Boolean(event.followUp?.required),
        callback_datetime: event.followUp?.scheduledTime ?? null,
        reason_not_interested: event.objection,
        customer_requirements: event.customerRequirement
          ? event.customerRequirement.split(";").map((part) => part.trim()).filter(Boolean)
          : [],
        human_handoff_required: event.humanHandoff,
        opt_out: event.doNotCall,
        confidence: event.interestConfidence,
      }
    : null;

  const updated: CallRecord = {
    ...existing,
    lead: lead ?? existing.lead,
    status: event.status,
    startedAt: event.startedAt ?? existing.startedAt,
    endedAt: event.endedAt ?? new Date().toISOString(),
    connectedAt: connected ? event.startedAt ?? existing.startedAt : null,
    duration: event.duration,
    transcript: event.transcript?.text ?? null,
    transcriptTurns: event.transcript?.turns ?? null,
    aiSummary: event.summary,
    aiResult,
    lastContactedAt: event.endedAt ?? new Date().toISOString(),
    nextAction: event.chosenNextStep ?? event.nextAction,
    humanHandoffStatus: event.humanHandoff ? "requested" : "none",

    providerAttemptId: attemptId,
    providerInteractionId: event.interactionId,
    providerStatus: event.rawStatus,
    connectivityStatus: event.connectivityStatus,
    completionStatus: event.completionStatus,
    failureReason: event.failureReason,
    recordingUrl: event.recordingUrl,

    callOutcome: event.callOutcome,
    callDisposition: event.callDisposition,
    interestLevel: event.interestLevel,
    interestConfidence: event.interestConfidence,
    painPoints: event.painPoints,
    objection: event.objection,
    customerRequirement: event.customerRequirement,
    budgetIndication: event.budgetIndication,
    timelineToDecide: event.timelineToDecide,
    authorityLevel: event.authorityLevel,
    competitorMentioned: event.competitorMentioned,
    discoveryFitScore: event.discoveryFitScore,
    chosenNextStep: event.chosenNextStep,
    nextStepDateTime: event.nextStepDateTime,
    followUpRequired: Boolean(event.followUp?.required),
    followUpDate: event.followUp?.date ?? null,
    followUpTime: event.followUp?.time ?? null,
    followUpTimezone: event.followUp?.timezone ?? null,
    doNotCall: event.doNotCall,
    humanHandoffRequired: event.humanHandoff,
    outputVariables: event.outputVariables,
  };

  const savedRecord = saveCallRecord(updated);

  // Learn from the conversation, now that the record is authoritative.
  //
  // Deliberately after the save and deliberately not awaited on anything
  // external: memory is valuable but it is not worth failing a webhook over.
  // A redelivered webhook is harmless here — repeated facts confirm rather
  // than duplicate, and the summary is keyed by call id.
  try {
    recordCallInMemory(savedRecord);
  } catch (error) {
    console.error(
      `MEMORY_UPDATE_FAILED call=${savedRecord.id}`,
      error instanceof Error ? error.message : error
    );
  }

  // Save the audio in the background. The webhook never carries it, and it is
  // not always ready the moment the call ends, so this retries on its own and
  // does not delay the response to Sarvam.
  if (connected && event.interactionId) {
    prefetchRecordingLater(event.interactionId);
  }

  // If this webhook is the result of a callback the scheduler placed, that
  // follow-up is now finished (or due a retry).
  closeTriggeredFollowUp(attemptId, event.status, {
    interactionId: event.interactionId,
    failureReason: event.failureReason,
  });

  // Do-not-call wins over everything else, including a callback the agent recorded.
  let suppressed = false;
  if (event.doNotCall) {
    console.log(`DO_NOT_CALL_REQUESTED attempt=${attemptId} lead=${existing.leadId}`);
    suppressed = suppressLead(
      existing.leadId,
      `Customer requested do-not-call during attempt ${attemptId}.`
    );
  } else {
    updateLead(existing.leadId, { status: event.status, lastAttemptId: attemptId });
  }

  let followUpId: string | null = null;
  if (event.followUp?.required) {
    console.log(
      `FOLLOW_UP_DETECTED attempt=${attemptId} raw="${event.followUp.rawRequest ?? ""}"`
    );
    console.log(
      `FOLLOW_UP_NORMALIZED attempt=${attemptId} scheduled=${event.followUp.scheduledTime ?? "none"} tz=${event.followUp.timezone} reading="${event.followUp.interpretation}"`
    );
  }

  if (event.followUp?.required && !event.doNotCall && lead) {
    const now = new Date().toISOString();
    const followUp: FollowUp = {
      id: `fu_${attemptId}`,
      leadId: existing.leadId,
      lead,
      previousResponse: event.summary,
      interest: event.followUp.interest,
      requestedCallback: event.followUp.rawRequest,
      scheduledTime: event.followUp.scheduledTime,
      timezone: event.followUp.timezone,
      // An exact time schedules itself and the worker will place the call. Anything
      // vaguer waits for a time to be agreed — Dialo never picks one.
      status: event.followUp.unparseable ? "needs_scheduling" : "scheduled",
      interpretation: event.followUp.interpretation,
      nextAction: event.followUp.nextAction,
      executionAttempts: 0,
      lockedAt: null,
      source: "sarvam_call",
      attemptId,
      callId: existing.id,
      createdAt: now,
      updatedAt: now,
    };
    followUpId = saveFollowUp(followUp).id;
    console.log(
      `FOLLOW_UP_SAVED followUp=${followUpId} status=${followUp.status} scheduled=${followUp.scheduledTime ?? "none"}`
    );
  }

  recordWebhookReceipt(attemptId, fingerprint, event.status);

  return {
    ...base,
    callId: savedRecord.id,
    record: savedRecord,
    followUpId,
    suppressed,
  };
}
