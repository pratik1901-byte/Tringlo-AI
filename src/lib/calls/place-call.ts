// ============================================================
// Tringlo AI — Placing a Call
// ============================================================
//
// One path to the provider, shared by the Call Now button and the follow-up
// scheduler.
//
// Keeping them together is the point: the do-not-call check, the duplicate
// guard, the webhook-reachability check and the call record all behave
// identically whether a person pressed a button or a callback came due. An
// autonomous caller that skipped one of those checks is how a suppressed lead
// gets dialled at 3am.
// ============================================================

import {
  findLeadByPhone,
  getAgentConfig,
  getCallRecordsForLead,
  getLead,
  getLeads,
  getWebhookBaseUrl,
  saveCallRecord,
  saveLead,
} from "@/lib/db";
import { getContextForCall } from "@/lib/memory/service";
import { ownedByTenant } from "@/lib/auth/guard";
import { buildAgentKnowledgeContext } from "@/lib/rag";
import { tryResolveOutbound } from "@/lib/providers/config";
import { NOT_CONFIGURED } from "@/lib/providers/types";
import { SarvamClientError, sarvamVoiceService } from "@/lib/providers/sarvam";
import { checkWebhookReachable, reachabilityCheckDisabled } from "@/lib/calls/webhook-reachability";
import type { AgentConfig, CallRecord, Lead } from "@/lib/types";

/** A trigger with no webhook after this is no longer considered in flight. */
export const IN_FLIGHT_WINDOW_MS = 5 * 60 * 1000;

export type PlaceCallFailure =
  | "invalid_request"
  | "invalid_phone_number"
  | "missing_company_name"
  | "call_blocked_dnd"
  | "duplicate_call_prevented"
  | "webhook_unreachable"
  | "provider_error"
  | "outbound_blocked"
  | "provider_not_configured"
  | "lead_not_found";

export interface PlaceCallSuccess {
  ok: true;
  callId: string;
  attemptId: string;
  leadId: string;
  knowledgeSources: Array<{ document_type: string; title: string; section: string }>;
}

export interface PlaceCallFailed {
  ok: false;
  reason: PlaceCallFailure;
  message: string;
  /** HTTP status when this is answering a request. */
  status: number;
  details?: Record<string, unknown>;
}

export type PlaceCallResult = PlaceCallSuccess | PlaceCallFailed;

/**
 * Hard stop on every outbound call.
 *
 * Set TRINGLO_BLOCK_OUTBOUND_CALLS=true and no call can reach the provider, whatever
 * else is configured. This exists because test isolation used to depend on
 * pointing the webhook URL somewhere unreachable — and once the URL moved into
 * the database, that indirect trick stopped working and test runs dialled real
 * customers twice. Refusing to call is now something a run states outright
 * rather than something it achieves as a side effect.
 */
export function outboundCallsBlocked(): boolean {
  return process.env.TRINGLO_BLOCK_OUTBOUND_CALLS === "true";
}

/** The registered URL wins; the caller's value is the fallback. */
export function effectiveWebhookBaseUrl(fallback?: string): string {
  return getWebhookBaseUrl() ?? fallback ?? "http://localhost:3000";
}

export interface PlaceCallInput {
  leadId?: string;
  leadName?: string;
  leadPhone?: string;
  leadCompany?: string;
  leadNotes?: string;
  campaignId?: string;
  campaignName?: string;
  /** Overrides the stored configuration. Omitted by the scheduler, which has no browser. */
  agentConfig?: Partial<AgentConfig>;
  webhookBaseUrl: string;
  /**
   * Recorded on the call, so a scheduled callback is distinguishable from a
   * manual dial — and a public demo from either.
   */
  origin: "manual" | "scheduler" | "demo";
  /**
   * The workspace placing the call. Required from the browser, where it comes
   * from the session; the scheduler omits it and the lead's own workspace is
   * used. Leads are only ever looked up inside this workspace.
   */
  tenantId?: string;
}

function fail(
  reason: PlaceCallFailure,
  message: string,
  status: number,
  details?: Record<string, unknown>
): PlaceCallFailed {
  return { ok: false, reason, message, status, details };
}

/**
 * Places one outbound call, after every guard has passed.
 */
export async function placeCall(input: PlaceCallInput): Promise<PlaceCallResult> {
  // Checked first, before anything can reach the provider.
  if (outboundCallsBlocked()) {
    console.warn("[Tringlo] Outbound calls are blocked by TRINGLO_BLOCK_OUTBOUND_CALLS.");
    return fail(
      "outbound_blocked",
      "Outbound calling is disabled on this server (TRINGLO_BLOCK_OUTBOUND_CALLS).",
      503
    );
  }

  const phone = input.leadPhone?.trim();
  if (!phone) {
    return fail("invalid_request", "A lead phone number is required to place a call.", 400);
  }

  if (!sarvamVoiceService.isValidPhoneNumber(phone)) {
    return fail(
      "invalid_phone_number",
      `Invalid phone number "${phone}". At least 10 digits are required.`,
      400
    );
  }

  // The workspace this call belongs to. From the session when a person placed
  // it; from the lead itself when the scheduler did.
  const requestedLead = input.leadId ? getLead(input.leadId) : undefined;
  const tenantId = input.tenantId ?? requestedLead?.tenantId ?? null;

  if (!tenantId) {
    return fail("invalid_request", "This call belongs to no workspace, so it was not placed.", 400);
  }

  // Which Sarvam agent speaks for this workspace. A workspace that has not been
  // configured cannot place a call, and never borrows another's agent.
  const provider = tryResolveOutbound(tenantId);
  if (!provider.ok) {
    return fail("provider_not_configured", provider.problems[0] ?? NOT_CONFIGURED, 422, {
      problems: provider.problems,
    });
  }

  // The stored configuration is authoritative; a request may override it with
  // the Agent page's unsaved edits for a manual test call. But a BLANK override
  // must never wipe a stored value: the browser's agent-config store is empty
  // right after a page or server reload, and spreading it over the stored
  // config would erase a saved company name and refuse the call — "even though
  // I have a company name". So an override only takes effect where it actually
  // carries a value; an empty string, null or undefined leaves the stored
  // value standing.
  const stored = getAgentConfig(tenantId);
  const agentConfig: Partial<AgentConfig> = { ...stored };
  for (const [key, value] of Object.entries(input.agentConfig ?? {})) {
    const blank = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
    if (!blank) (agentConfig as Record<string, unknown>)[key] = value;
  }

  const companyName = (agentConfig.companyName || "").trim();
  if (!companyName) {
    return fail(
      "missing_company_name",
      "No company name is configured for this workspace. Set it on the AI Agent page — the agent introduces itself with it on every call.",
      400
    );
  }

  // A lead id from another workspace is treated as not existing — the same
  // answer the API gives for any other tenant's record.
  if (requestedLead && tenantId && !ownedByTenant(requestedLead, tenantId)) {
    return fail("invalid_request", "No such lead.", 404);
  }

  // Matching by phone stays inside the workspace. Across workspaces the same
  // number is a different customer, with its own do-not-call status.
  const storedLead =
    requestedLead ||
    (tenantId
      ? getLeads().find(
          (lead) =>
            ownedByTenant(lead, tenantId) &&
            lead.phone.replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10)
        )
      : findLeadByPhone(phone));

  if (storedLead?.suppressed) {
    return fail(
      "call_blocked_dnd",
      "This lead is on the do-not-call list. No call was placed.",
      403,
      { reason: storedLead.suppressedReason ?? null }
    );
  }

  const leadId =
    storedLead?.id || input.leadId || `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const inFlight = getCallRecordsForLead(leadId).find((record) => {
    if (record.status !== "initiating" && record.status !== "calling") return false;
    return new Date(record.requestedAt || 0).getTime() > Date.now() - IN_FLIGHT_WINDOW_MS;
  });

  if (inFlight) {
    return fail(
      "duplicate_call_prevented",
      "A call to this lead is already in progress. Wait for it to complete.",
      409,
      { callId: inFlight.id, attemptId: inFlight.providerAttemptId ?? null }
    );
  }

  // Refuse to dial when the result cannot get back. The call would connect and a
  // real person would take it, but its outcome would be lost.
  const webhookBaseUrl = effectiveWebhookBaseUrl(input.webhookBaseUrl);

  if (!reachabilityCheckDisabled()) {
    const reachability = await checkWebhookReachable(webhookBaseUrl);
    if (!reachability.reachable) {
      return fail("webhook_unreachable", reachability.detail, 503, {
        webhookUrl: reachability.url,
      });
    }
  }

  const now = new Date().toISOString();
  const lead: Lead = storedLead ?? {
    id: leadId,
    tenantId,
    name: (input.leadName || "").trim() || "Customer",
    phone,
    company: input.leadCompany,
    notes: input.leadNotes,
    callingDate: now.split("T")[0],
    callingTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    timezone: "Asia/Kolkata",
    createdAt: now,
    status: "queued",
    suppressed: false,
  };

  const knowledge = buildAgentKnowledgeContext(tenantId, agentConfig, [
    lead.company || "",
    lead.notes || "",
  ]);

  // What Priya should already know about this person.
  //
  // This used to be the last connected call's summary verbatim. Customer
  // memory replaces it: durable facts the customer stated, plus a condensed
  // history, chosen for this particular call rather than pasted wholesale.
  // An unknown customer yields an empty context, which is what keeps a genuine
  // first call sounding like one.
  // The workspace was resolved when the lead was; memory is looked up there.
  const memoryTenantId = lead.tenantId ?? tenantId;
  const memoryContext = memoryTenantId
    ? getContextForCall(memoryTenantId, lead, {
        isFollowUp: input.origin === "scheduler",
        topic: input.campaignName ?? agentConfig.salesObjective ?? null,
      })
    : null;

  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const result = await sarvamVoiceService.startOutboundCall({
      provider: provider.value,
      tenantId,
      leadId,
      leadName: lead.name,
      leadPhone: phone,
      leadCompany: lead.company,
      leadNotes: lead.notes,
      companyName,
      productName: agentConfig.productName || agentConfig.productsServices,
      agentName: agentConfig.agentName,
      agentConfig,
      campaignId: input.campaignId,
      campaignName: input.campaignName,
      previousInteraction: memoryContext?.previousInteraction ?? "",
      // The same memory as separate fields, for an app that declares them.
      // Only sent when there is something to say.
      customVariables: memoryContext && !memoryContext.isEmpty
        ? {
            customer_id: memoryContext.customerId ?? "",
            customer_memory_context: memoryContext.customerMemoryContext,
            previous_interaction_summary: memoryContext.priorTouchpointSummary,
            last_call_summary: memoryContext.lastCallSummary ?? "",
            previous_interest: memoryContext.previousInterest ?? "",
            previous_objection: memoryContext.previousObjection ?? "",
            previous_commitment: memoryContext.previousCommitment ?? "",
            previous_next_step: memoryContext.previousNextStep ?? "",
            follow_up_reason: memoryContext.followUpReason ?? "",
          }
        : undefined,
      ragContext: knowledge.compactContext,
      webhookBaseUrl,
      callId,
    });

    if (memoryContext && !memoryContext.isEmpty) {
      console.log(
        `MEMORY_CONTEXT_SENT call=${callId} items=${memoryContext.usedItems.length} ` +
          `followUp=${input.origin === "scheduler"} chars=${memoryContext.previousInteraction.length}`
      );
    }

    saveLead({ ...lead, status: "calling", lastAttemptId: result.attemptId });

    const record: CallRecord = {
      id: callId,
      tenantId: lead.tenantId ?? tenantId,
      leadId,
      lead: { ...lead, status: "calling" },
      status: "calling",
      startedAt: null,
      endedAt: null,
      requestedAt: now,
      connectedAt: null,
      duration: null,
      attempts: getCallRecordsForLead(leadId).length + 1,
      transcript: null,
      transcriptTurns: null,
      aiSummary: null,
      aiResult: null,
      lastContactedAt: null,
      nextAction: null,
      humanHandoffStatus: "none",
      provider: "sarvam",
      agentName: agentConfig.agentName?.trim() || null,
      origin: input.origin,
      providerCallId: callId,
      providerAppId: provider.value.outbound.appId,
      providerAttemptId: result.attemptId,
      providerStatus: "accepted",
      inputVariables: result.inputVariables,
      outputVariables: null,
    };
    saveCallRecord(record);

    console.log(
      `[Tringlo] Outbound triggered (${input.origin}) — callId: ${callId}, attemptId: ${result.attemptId}, knowledge sources: ${knowledge.sourcesUsed.length}`
    );

    return {
      ok: true,
      callId,
      attemptId: result.attemptId,
      leadId,
      knowledgeSources: knowledge.sourcesUsed,
    };
  } catch (error: unknown) {
    if (error instanceof SarvamClientError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return fail("provider_error", error.message, status, { type: error.type });
    }
    return fail(
      "provider_error",
      error instanceof Error ? error.message : "Unknown error placing the call.",
      500
    );
  }
}
