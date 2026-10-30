// ============================================================
// Tringlo AI — Reconciling a Call Against the Provider
// ============================================================
//
// Settles a call from Sarvam's own attempt record when the webhook has not
// arrived.
//
// Two real failures this fixes:
//
//   - A customer declines the call, and the panel keeps saying "waiting for
//     provider" for minutes because the webhook only lands when Sarvam closes
//     the attempt.
//   - A webhook lost while the public URL was down leaves a call in `calling`
//     for ever. Thirteen calls were sitting in exactly that state.
//
// The webhook stays authoritative: it alone carries the transcript, summary and
// agent variables. This only fills in the outcome, marks where it came from, and
// never touches a call the webhook has already settled.
// ============================================================

import { resolveCallAgent } from "@/lib/providers/config";
import { syncLeadStatus } from "@/lib/calls/lead-status";
import { getCallRecord, updateCallRecord } from "@/lib/db";
import { getProviderAttemptStatus, isAttemptPollingConfigured } from "@/lib/providers/sarvam/attempts";
import { prefetchRecordingLater } from "@/lib/recordings";
import type { CallRecord } from "@/lib/types";
import { isTerminalCallStatus } from "@/lib/types";

/** Give the webhook a head start; it carries far more than a status. */
export const RECONCILE_AFTER_MS = 10_000;

export interface ReconcileResult {
  changed: boolean;
  status?: string;
  detail: string;
}

export function isInFlight(record: CallRecord): boolean {
  return record.status === "calling" || record.status === "initiating";
}

/** True once a call has been in flight long enough to be worth asking about. */
export function isWorthReconciling(record: CallRecord, now = Date.now()): boolean {
  if (!isInFlight(record) || !record.providerAttemptId) return false;
  const placedAt = new Date(record.requestedAt || record.startedAt || 0).getTime();
  return placedAt > 0 && now - placedAt >= RECONCILE_AFTER_MS;
}

/**
 * Asks Sarvam what became of one in-flight call and records the answer.
 *
 * A `connected` result is applied too, so the UI stops waiting — but the
 * transcript, summary and outcome still come from the webhook, which may arrive
 * later and will overwrite this with the fuller picture.
 */
export async function reconcileCallWithProvider(callId: string): Promise<ReconcileResult> {
  if (!isAttemptPollingConfigured()) {
    return { changed: false, detail: "Provider polling is not configured." };
  }

  const record = getCallRecord(callId);
  if (!record) return { changed: false, detail: "No such call." };
  if (isTerminalCallStatus(record.status)) {
    return { changed: false, detail: "Already settled." };
  }
  if (!record.providerAttemptId) {
    return { changed: false, detail: "Call has no provider attempt id." };
  }

  const agent = resolveCallAgent(record);
  if (!agent) return { changed: false, detail: "This workspace has no voice provider configured." };

  const provider = await getProviderAttemptStatus(
    agent,
    record.providerAttemptId,
    record.requestedAt ?? record.startedAt
  );

  if (!provider) return { changed: false, detail: "Sarvam has no record of this attempt yet." };
  if (!provider.status) return { changed: false, detail: "The attempt is still running." };

  const connected = provider.status === "connected";

  updateCallRecord(record.id, {
    status: provider.status,
    duration: provider.duration,
    startedAt: provider.startedAt ?? record.startedAt,
    endedAt: provider.endedAt ?? new Date().toISOString(),
    connectedAt: connected ? provider.startedAt ?? record.startedAt : null,
    providerInteractionId: provider.interactionId ?? record.providerInteractionId ?? null,
    connectivityStatus: provider.status,
    failureReason: provider.failureReason,
    lastContactedAt: provider.endedAt ?? new Date().toISOString(),
    // Recorded so nothing later mistakes this for a webhook-settled call: the
    // conversation fields are still empty and the webhook may yet fill them.
    providerStatus: `analytics:${provider.status}`,
  });

  // The lead has to hear about it too. This path used to update only the call,
  // which left leads saying "calling" for calls that had long since finished.
  syncLeadStatus(record.leadId);

  if (connected && provider.interactionId) {
    // Fetched from the agent this call ran on, which may not be the one the
    // workspace uses today.
    prefetchRecordingLater(provider.interactionId, agent);
  }

  console.log(
    `CALL_RECONCILED call=${record.id} attempt=${record.providerAttemptId} status=${provider.status} source=analytics`
  );

  return {
    changed: true,
    status: provider.status,
    detail: `Sarvam reports ${provider.status}${provider.endedBy ? ` (${provider.endedBy})` : ""}.`,
  };
}
