// ============================================================
// Tringlo AI — Call Lifecycle Service
// ============================================================
// The single place where a Sarvam webhook becomes durable state.
//
// Both webhook routes funnel through `applySarvamEvent`, so correlation,
// idempotency, do-not-call suppression and follow-up creation behave identically
// no matter which endpoint Sarvam posts to.
// ============================================================

import { providerConfigFor, resolveCallAgent } from "@/lib/providers/config";
import {
  fingerprintWebhook,
  findCampaignRunByProviderId,
  findInboundSettingsByDeployment,
  getAgentConfig,
  getCallRecord,
  getFollowUpByExecutedAttempt,
  getCallRecordByAttemptId,
  getFollowUps,
  getLead,
  hasProcessedWebhook,
  recordWebhookReceipt,
  saveCallRecord,
  saveFollowUp,
  saveRawEvent,
  suppressLead,
  updateFollowUp,
} from "@/lib/db";
import { deriveAiStatus, parseSarvamWebhook } from "@/lib/providers/sarvam/webhooks";
import { prefetchRecordingLater } from "@/lib/recordings";
import { recordCallInMemory } from "@/lib/memory/service";
import { syncLeadStatus } from "@/lib/calls/lead-status";
import { recordForCampaignAttempt } from "@/lib/campaigns/service";
import { renameLead, statedCustomerName } from "@/lib/customers/rename";
import { isPlaceholderName } from "@/lib/customers/identity";
import { inboundCallerName, inboundIntent, inboundResolution } from "@/lib/inbound/outcome";
import { recordForInboundCall, verifyTransferLater } from "@/lib/inbound/service";
import { notifyIfInterested } from "@/lib/notifications";
import { applyReminderCallResult } from "@/lib/hospital/reminder-outcomes";
import { recordForHospitalReminderAttempt } from "@/lib/hospital/reminder-batch";
import type { SarvamWebhookPayload } from "@/lib/providers/sarvam/types";
import type { AICallResult, CallRecord, CallStatus, FollowUp, Lead } from "@/lib/types";
import { isTerminalCallStatus } from "@/lib/types";

/** How late a requested callback may be and still be placed automatically. */
const LATE_CALLBACK_GRACE_MS = 10 * 60 * 1000;

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
  if (record?.agentName?.trim()) return record.agentName.trim();
  const tenantId = record?.tenantId;
  const configured = tenantId ? providerConfigFor(tenantId)?.outbound?.agentName : null;
  return configured?.trim() || "Agent";
}

/**
 * Applies one Sarvam webhook body.
 *
 * Every early return leaves existing state untouched: an unrecognised status, an
 * attempt Tringlo never triggered, or a late event arriving after a terminal one
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

function tenantForDelivery(rawPayload: SarvamWebhookPayload, attemptId: string): string | null {
  if (attemptId) {
    const correlated = getCallRecordByAttemptId(attemptId);
    if (correlated?.tenantId) return correlated.tenantId;
  }
  if (rawPayload?.deployment_id) {
    return findInboundSettingsByDeployment(rawPayload.deployment_id)?.tenantId ?? null;
  }
  if (rawPayload?.campaign_id) {
    return findCampaignRunByProviderId(rawPayload.campaign_id)?.tenantId ?? null;
  }
  return null;
}

export function applySarvamEvent(rawPayload: SarvamWebhookPayload): ApplyResult {
  // Inbound completions carry no attempt_id; Sarvam uses the interaction id
  // as the attempt id for them (in its delivery records and retries too).
  const isInbound = Boolean(rawPayload?.deployment_id && !rawPayload?.campaign_id);
  const attemptId = String(rawPayload?.attempt_id || (isInbound ? rawPayload?.interaction_id : "") || "").trim();
  const payloadRecord = rawPayload as unknown as Record<string, unknown>;

  const deliveryTenantId = tenantForDelivery(rawPayload, attemptId);
  saveRawEvent(payloadRecord, attemptId || undefined, String(rawPayload?.status ?? ""), deliveryTenantId);
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

  // Correlate: attempt_id first, then the callId Tringlo put in webhook metadata.
  let existing = correlated || (event.callId ? getCallRecord(event.callId) : undefined);

  // A campaign attempt is created by Sarvam, so its first webhook is the first
  // Tringlo hears of it. Its record is created here — only for a lead that
  // belongs to that campaign's workspace — and then handled exactly like any
  // other call. A redelivery finds this record by attempt id and creates none.
  if (!existing && rawPayload.campaign_id) {
    const fresh = recordForCampaignAttempt(rawPayload);
    if (fresh) {
      existing = saveCallRecord(fresh);
      console.log(`CAMPAIGN_ATTEMPT_RECORDED attempt=${attemptId} call=${existing.id} retry=${fresh.retryAttempt ?? 0}`);
    } else {
      // Not a platform campaign attempt — it may be one of Maya's hospital
      // reminder cohorts, matched by campaign id + appointment id. Returns null
      // for anything else, so platform campaigns are unaffected.
      const hospital = recordForHospitalReminderAttempt(rawPayload);
      if (hospital) {
        existing = saveCallRecord(hospital);
        console.log(`HOSPITAL_REMINDER_ATTEMPT_RECORDED attempt=${attemptId} call=${existing.id}`);
      }
    }
  }

  // An inbound call is created by the caller, so its completion is the first
  // Tringlo hears of it. The workspace comes from the deployment that answered.
  if (!existing && isInbound) {
    const fresh = recordForInboundCall(rawPayload);
    if (fresh) {
      existing = saveCallRecord(fresh);
      console.log(`INBOUND_CALL_RECORDED interaction=${attemptId} call=${existing.id} lead=${existing.leadId}`);
    }
  }

  if (!existing) {
    return {
      ...base,
      outcome: "unknown_attempt",
      detail: `No call record matches attempt ${attemptId}. Not creating one — Tringlo did not place this call.`,
    };
  }

  // A terminal call does not go backwards. Late duplicates of an earlier state are ignored.
  if (isTerminalCallStatus(existing.status) && existing.status !== event.status) {
    recordWebhookReceipt(attemptId, fingerprint, event.status, existing.tenantId ?? deliveryTenantId);
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
    // Inbound calls: why they called and how it ended, as the agent reported it.
    ...(isInbound
      ? {
          direction: "inbound" as const,
          intent: inboundIntent(event.outputVariables),
          resolutionStatus: event.humanHandoff
            ? ("escalated" as const)
            : inboundResolution(event.outputVariables),
          inboundNumber: existing.inboundNumber ?? rawPayload.agent_phone_number ?? null,
        }
      : {}),
    // Campaign attempts: what Sarvam's retry engine will do next for this lead.
    ...(rawPayload.campaign_id
      ? {
          providerCohortId: rawPayload.cohort_id ?? existing.providerCohortId ?? null,
          retryAttempt: rawPayload.retry_attempt ?? existing.retryAttempt ?? 0,
          nextActionStatus: rawPayload.next_action_status ?? null,
        }
      : {}),
  };

  // An inbound caller who was not on file and told the agent their name gets
  // it on their contact — never over a name the team already has.
  if (isInbound && connected) {
    const givenName = inboundCallerName(event.outputVariables);
    const onFile = getLead(existing.leadId);
    if (givenName && onFile && isPlaceholderName(onFile.name)) {
      const renamed = renameLead(onFile.id, givenName, "caller");
      if (renamed) updated.lead = { ...updated.lead, name: renamed.name };
    }
  }

  // What the person said about their own name during this call outranks what
  // was on file, because they are the authority on it. The agent reports it
  // only when it differs from what it was given, so this is a correction.
  //
  // Read from stated_customer_name alone: customer_name is an input, and an
  // agent echoes its own default back on that one — which is how a demo name
  // reached a customer on 9 October 2026.
  if (connected && !isInbound) {
    const agentName = existing.tenantId ? getAgentConfig(existing.tenantId)?.agentName ?? null : null;
    const stated = statedCustomerName(event.outputVariables, agentName);
    const onFile = getLead(existing.leadId);
    if (stated && onFile && stated.toLowerCase() !== (onFile.name ?? "").trim().toLowerCase()) {
      const renamed = renameLead(onFile.id, stated, "customer");
      if (renamed) {
        updated.lead = { ...updated.lead, name: renamed.name };
        console.log(`LEAD_NAME_STATED_BY_CUSTOMER call=${existing.id} lead=${onFile.id}`);
      }
    }
  }

  const savedRecord = saveCallRecord(updated);

  // Whether a requested transfer actually happened is in Sarvam's own call
  // record, not in this webhook. Checked shortly after, then recorded.
  if (isInbound && connected) verifyTransferLater(savedRecord.id);

  // Learn from the conversation, now that the record is authoritative.
  //
  // Deliberately after the save and deliberately not awaited on anything
  // external: memory is valuable but it is not worth failing a webhook over.
  // A redelivered webhook is harmless here — repeated facts confirm rather
  // than duplicate, and the summary is keyed by call id.
  // Not awaited: Sarvam is waiting on this response, and an email must never
  // delay or fail a webhook. It stamps the call itself, so a redelivery does
  // not send it twice.
  void notifyIfInterested(savedRecord);

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
    const agent = resolveCallAgent(savedRecord);
    if (agent) prefetchRecordingLater(event.interactionId, agent);
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
    // The lead takes the status of its most recent call — which is this one,
    // unless this is a late webhook for an older attempt, in which case the
    // newer call's status is correctly left in place.
    syncLeadStatus(existing.leadId);
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

    // A result Tringlo learns of late — recovered from Sarvam's records after a
    // lost webhook — can ask for a time that has already gone. Scheduling it
    // would dial at once, hours after the customer expected; it is kept for a
    // person to reschedule instead.
    const requestedAt = event.followUp.scheduledTime ? new Date(event.followUp.scheduledTime).getTime() : null;
    const alreadyPassed = requestedAt !== null && requestedAt < Date.now() - LATE_CALLBACK_GRACE_MS;
    // A contact on the do-not-call list is never dialled automatically — not
    // even when they themselves called in and asked for a callback. A person
    // decides.
    const onDoNotCall = Boolean(getLead(existing.leadId)?.suppressed);

    // The newest request is the one that stands: "call me at 2", then on the
    // next call "make it 3", leaves one callback at 3, not two.
    for (const open of getFollowUps()) {
      if (
        open.leadId === existing.leadId &&
        open.id !== `fu_${attemptId}` &&
        (open.status === "scheduled" || open.status === "needs_scheduling" || open.status === "retry_pending") &&
        new Date(open.createdAt).getTime() <= new Date(existing.endedAt ?? now).getTime()
      ) {
        updateFollowUp(open.id, {
          status: "cancelled",
          lastError: `Replaced by a newer callback request on attempt ${attemptId}.`,
        } as Partial<FollowUp>);
        console.log(`FOLLOW_UP_SUPERSEDED followUp=${open.id} by=fu_${attemptId}`);
      }
    }

    const followUp: FollowUp = {
      id: `fu_${attemptId}`,
      // Owned by the call's workspace, so tenant-scoped lists can see it.
      tenantId: existing.tenantId ?? lead.tenantId ?? null,
      leadId: existing.leadId,
      lead,
      previousResponse: event.summary,
      interest: event.followUp.interest,
      requestedCallback: event.followUp.rawRequest,
      scheduledTime: event.followUp.scheduledTime,
      timezone: event.followUp.timezone,
      // An exact time schedules itself and the worker will place the call. Anything
      // vaguer waits for a time to be agreed — Tringlo never picks one.
      status: event.followUp.unparseable || alreadyPassed || onDoNotCall ? "needs_scheduling" : "scheduled",
      interpretation: onDoNotCall
        ? `${event.followUp.interpretation} This contact is on the do-not-call list, so the callback was not scheduled automatically.`
        : alreadyPassed
        ? `${event.followUp.interpretation} The requested time had already passed when Tringlo received this call's result, so it was not dialled automatically — choose a new time.`
        : event.followUp.interpretation,
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

  // A hospital confirmation call feeds its result back to the appointment it
  // was placed for — confirmed, rescheduled, or handed to a person — judged on
  // the extracted variables the backend validates, never on the agent's spoken
  // claim. This fires only for a hospital workspace that has a reminder linked
  // to this call, so every other workspace (TenWeb/Priya included) returns at
  // once untouched. The confirm and reschedule paths run synchronously here;
  // only a cancellation request is deferred. It is never allowed to fail the
  // webhook.
  applyReminderCallResult(savedRecord)
    .then((outcome) => {
      if (outcome.handled) {
        console.log(
          `HOSPITAL_REMINDER_OUTCOME call=${savedRecord.id} reminder=${outcome.reminderId} ` +
            `response=${outcome.response} action="${outcome.action ?? ""}"` +
            `${outcome.rescheduled ? " rescheduled" : ""}${outcome.followUpId ? ` followUp=${outcome.followUpId}` : ""}`
        );
      }
    })
    .catch((error) =>
      console.error(`HOSPITAL_REMINDER_OUTCOME_FAILED call=${savedRecord.id}`, error instanceof Error ? error.message : error)
    );

  recordWebhookReceipt(attemptId, fingerprint, event.status, savedRecord.tenantId ?? deliveryTenantId);

  return {
    ...base,
    callId: savedRecord.id,
    record: savedRecord,
    followUpId,
    suppressed,
  };
}
