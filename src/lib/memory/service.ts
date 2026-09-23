// ============================================================
// Dialo AI — Memory Service
// ============================================================
//
// The two operations the rest of Dialo uses:
//
//   recordCallInMemory()  — after a call ends, learn from it
//   getContextForCall()   — before a call starts, recall what matters
//
// Everything is tenant-scoped. The tenant comes from the call record or the
// lead, never from a caller-supplied value, so there is no path by which one
// business's context can be requested for another's customer.
// ============================================================

import {
  findCustomerProfileByPhone,
  getCustomerProfile,
  getLead,
  getLegacyTenantId,
  getMemoryItems,
  saveCustomerProfile,
  saveMemoryItems,
} from "@/lib/db";
import {
  customerKey,
  isPlaceholderName,
  namesLikelyMatch,
  normalisePhone,
} from "@/lib/customers/identity";
import type { CallRecord, Lead } from "@/lib/types";
import { buildCallContext, type CallContext, type ContextRequest } from "./context";
import { extractFactsFromCall } from "./extract";
import { mergeFacts } from "./merge";
import { MAX_RECENT_SUMMARIES, type CallSummary, type CustomerProfile } from "./types";

/**
 * The tenant that owns a record.
 *
 * Rows written before tenancy existed carry none and belong to the legacy
 * tenant, the same rule the API uses for scoping.
 */
function tenantOf(record: { tenantId?: string | null }): string | null {
  return record.tenantId ?? getLegacyTenantId();
}

/**
 * Finds or creates the profile for a lead.
 *
 * Returns null when the phone number cannot be normalised at all: an identity
 * that cannot be looked up again is worse than none, because it silently
 * accumulates memory nobody will ever retrieve.
 */
export function resolveCustomer(
  tenantId: string,
  lead: Pick<Lead, "id" | "name" | "phone">
): CustomerProfile | null {
  const phone = normalisePhone(lead.phone);
  if (!phone.national) return null;

  const id = customerKey(tenantId, lead.phone);
  if (!id) return null;

  const now = new Date().toISOString();
  const existing =
    getCustomerProfile(tenantId, id) ?? findCustomerProfileByPhone(tenantId, phone.national);

  if (!existing) {
    const created: CustomerProfile = {
      id,
      tenantId,
      phoneNational: phone.national,
      phoneE164: phone.e164,
      names: isPlaceholderName(lead.name) ? [] : [lead.name.trim()],
      identityAmbiguous: false,
      leadIds: [lead.id],
      recentSummaries: [],
      createdAt: now,
      updatedAt: now,
    };
    return saveCustomerProfile(created);
  }

  const updated: CustomerProfile = { ...existing };
  let touched = false;

  if (!updated.leadIds.includes(lead.id)) {
    updated.leadIds = [...updated.leadIds, lead.id];
    touched = true;
  }

  const name = (lead.name ?? "").trim();
  if (!isPlaceholderName(name)) {
    const known = updated.names;

    if (known.length === 0) {
      updated.names = [name];
      touched = true;
    } else if (!known.some((candidate) => namesLikelyMatch(candidate, name))) {
      // A genuinely different name on the same number. Dialo cannot tell which
      // person is answering, so personal context is withheld from then on
      // rather than risk telling one person about another's family.
      updated.names = [name, ...known].slice(0, 5);
      updated.identityAmbiguous = true;
      touched = true;
      console.log(
        `MEMORY_IDENTITY_AMBIGUOUS customer=${updated.id} names=${updated.names.length}`
      );
    } else if (known[0] !== name) {
      updated.names = [name, ...known.filter((candidate) => candidate !== name)].slice(0, 5);
      touched = true;
    }
  }

  if (!touched) return existing;

  updated.updatedAt = now;
  return saveCustomerProfile(updated);
}

export interface RecordOutcome {
  customerId: string | null;
  created: number;
  confirmed: number;
  corrected: number;
  superseded: number;
  /** Why nothing was recorded, when nothing was. */
  skipped?: string;
}

/**
 * Learns from a finished call.
 *
 * Called from the webhook reducer once the call record has been saved. It is
 * safe to call twice with the same record: repeated facts confirm rather than
 * duplicate, and the summary list is keyed by call id — which is what makes a
 * redelivered webhook harmless.
 */
export function recordCallInMemory(record: CallRecord): RecordOutcome {
  const empty: RecordOutcome = {
    customerId: null,
    created: 0,
    confirmed: 0,
    corrected: 0,
    superseded: 0,
  };

  if (record.status !== "connected") {
    return { ...empty, skipped: "call did not connect" };
  }

  const tenantId = tenantOf(record) ?? tenantOf(record.lead ?? {});
  if (!tenantId) return { ...empty, skipped: "no tenant" };

  const lead = getLead(record.leadId) ?? record.lead;
  if (!lead?.phone) return { ...empty, skipped: "no phone number" };

  const profile = resolveCustomer(tenantId, lead);
  if (!profile) return { ...empty, skipped: "phone number could not be normalised" };

  const at = record.endedAt ?? new Date().toISOString();

  // ---- the rolling summary, replaced in place if this call is already there
  const summary: CallSummary = {
    callId: record.id,
    at,
    durationSeconds: record.duration ?? null,
    summary: record.aiSummary ?? null,
    interest: record.interestLevel ?? null,
    objection: record.objection ?? null,
    nextStep: record.chosenNextStep ?? null,
    // The scheduler is the only thing that places a callback.
    wasFollowUp: record.origin === "scheduler",
  };

  const summaries = [
    summary,
    ...profile.recentSummaries.filter((entry) => entry.callId !== record.id),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_RECENT_SUMMARIES);

  saveCustomerProfile({ ...profile, recentSummaries: summaries, updatedAt: at });

  // ---- the durable facts
  const facts = extractFactsFromCall(record);
  if (facts.length === 0) {
    return { ...empty, customerId: profile.id, skipped: "nothing worth remembering" };
  }

  const outcome = mergeFacts(getMemoryItems(tenantId, profile.id), facts, {
    tenantId,
    customerId: profile.id,
    callId: record.id,
    at,
  });

  saveMemoryItems(outcome.items);

  console.log(
    `MEMORY_UPDATED call=${record.id} customer=${profile.id} ` +
      `created=${outcome.created} confirmed=${outcome.confirmed} ` +
      `corrected=${outcome.corrected} superseded=${outcome.superseded}`
  );

  return {
    customerId: profile.id,
    created: outcome.created,
    confirmed: outcome.confirmed,
    corrected: outcome.corrected,
    superseded: outcome.superseded,
  };
}

/**
 * Recalls what is worth knowing before dialling.
 *
 * Returns an empty context for a customer with no history, which is what makes
 * a genuine first call sound like a first call.
 */
export function getContextForCall(
  tenantId: string,
  lead: Pick<Lead, "id" | "name" | "phone">,
  request: ContextRequest
): CallContext {
  const phone = normalisePhone(lead.phone);
  const id = customerKey(tenantId, lead.phone);

  const profile =
    (id ? getCustomerProfile(tenantId, id) : undefined) ??
    (phone.national ? findCustomerProfileByPhone(tenantId, phone.national) : undefined) ??
    null;

  if (!profile) {
    return buildCallContext(null, [], request);
  }

  return buildCallContext(profile, getMemoryItems(tenantId, profile.id), request);
}
