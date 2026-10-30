// ============================================================
// Tringlo AI — Keeping a Lead's Status in Step With Its Calls
// ============================================================
//
// A lead's status is the status of its most recent call. That is the only
// rule, and every path that settles a call goes through it.
//
// It used to be written in one place — the webhook reducer — and nowhere else.
// Calls can also be settled by reconciliation against Sarvam's own records,
// when the webhook is late or lost, and that path updated the call but never
// the lead. Leads were left saying "calling" indefinitely for calls that had
// long since connected.
//
// "Most recent call" rather than "the attempt id stored on the lead" for two
// reasons: leads created before that id was tracked have none, and a late
// webhook for an older call must not overwrite the status of a newer one.
// ============================================================

import { getCallRecordsForLead, getLead, getLeads, updateLead } from "@/lib/db";
import { isInFlightCallStatus, isTerminalCallStatus } from "@/lib/types";
import type { CallRecord } from "@/lib/types";

function requestedAt(record: CallRecord): number {
  const time = new Date(record.requestedAt || record.startedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * Brings one lead's status in line with its latest call.
 *
 * Suppressed leads are left alone: "do not call" outranks any call outcome.
 * A lead whose latest call is still in flight is left as it is, because the
 * outcome is not known yet. Returns true when the lead was changed.
 */
export function syncLeadStatus(leadId: string): boolean {
  const lead = getLead(leadId);
  if (!lead || lead.suppressed) return false;

  const calls = getCallRecordsForLead(leadId);
  if (calls.length === 0) return false;

  const latest = calls.reduce((newest, call) =>
    requestedAt(call) > requestedAt(newest) ? call : newest
  );

  if (!isTerminalCallStatus(latest.status)) return false;
  if (lead.status === latest.status && lead.lastAttemptId === latest.providerAttemptId) {
    return false;
  }

  updateLead(leadId, {
    status: latest.status,
    lastAttemptId: latest.providerAttemptId ?? lead.lastAttemptId ?? null,
  });
  return true;
}

/**
 * Heals every lead still shown as calling whose latest call has settled.
 *
 * Runs on the scheduler tick. It is the backstop for rows written before the
 * rule above existed, and for any settle path added later that forgets to
 * call `syncLeadStatus`. Only in-flight leads are considered, so a status set
 * deliberately — scheduled, queued — is never touched.
 */
export function repairStaleLeadStatuses(): number {
  let repaired = 0;
  for (const lead of getLeads()) {
    if (!isInFlightCallStatus(lead.status)) continue;
    if (syncLeadStatus(lead.id)) repaired++;
  }
  if (repaired > 0) console.log(`LEAD_STATUS_REPAIRED count=${repaired}`);
  return repaired;
}
