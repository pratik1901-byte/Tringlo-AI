import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCallRecord, getCallRecordByAttemptId, getReachabilityHistory } from "@/lib/db";
import { isWorthReconciling, reconcileCallWithProvider } from "@/lib/calls/reconcile";

/**
 * GET /api/calls/[id]
 *
 * Live state for one call, read from the database — the same rows the webhook
 * writes. Because state is persisted rather than held in memory, a browser
 * refresh or a server restart mid-call does not lose the result.
 *
 * `id` accepts either Dialo's call id or the Sarvam attempt_id.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/calls/[id]">) {
  const { id } = await ctx.params;

  const record = getCallRecord(id) || getCallRecordByAttemptId(id);

  if (!record) {
    return NextResponse.json(
      { error: "No call found with that id.", callId: id },
      { status: 404 }
    );
  }

  // A call still in flight is checked against Sarvam's own attempt record, so
  // a declined call stops showing as in progress instead of waiting for a
  // webhook that only lands when Sarvam closes the attempt.
  let settled = record;
  if (isWorthReconciling(record)) {
    const outcome = await reconcileCallWithProvider(record.id);
    if (outcome.changed) settled = getCallRecord(record.id) ?? record;
  }

  // The history is what makes a bare carrier failure diagnosable: one failure
  // means little, a number that has never once connected means a great deal.
  return NextResponse.json({
    record: settled,
    reachability: getReachabilityHistory(settled.leadId),
  });
}
