// ============================================================
// /api/customers/:id/calls
// ============================================================
//
// The customer's full call history: every attempt, connected or not, newest
// first. The memory keeps only the last few summaries; this is the record.
//
// A call belongs to the customer when its lead resolved to them, or when its
// number is theirs — within this workspace only.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { normalisePhone } from "@/lib/customers/identity";
import { getCallRecords, getCustomerProfile } from "@/lib/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const profile = getCustomerProfile(auth.tenantId, id);
  if (!profile) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No such customer." } },
      { status: 404 }
    );
  }

  const calls = scopeToTenant(getCallRecords(), auth.tenantId)
    .filter(
      (call) =>
        profile.leadIds.includes(call.leadId) ||
        normalisePhone(call.lead?.phone).national === profile.phoneNational
    )
    .sort((a, b) =>
      String(b.requestedAt ?? b.startedAt ?? "").localeCompare(String(a.requestedAt ?? a.startedAt ?? ""))
    )
    .map((call) => ({
      id: call.id,
      status: call.status,
      origin: call.origin ?? "manual",
      requestedAt: call.requestedAt,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSeconds: call.duration,
      summary: call.aiSummary,
      interestLevel: call.interestLevel ?? null,
      objection: call.objection ?? null,
      nextStep: call.chosenNextStep ?? call.nextAction ?? null,
      followUpRequested: call.followUpRequired ?? false,
      followUpDate: call.followUpDate ?? null,
      followUpTime: call.followUpTime ?? null,
      learnedFrom: Boolean(call.memoryRecordedAt),
    }));

  return NextResponse.json({ calls }, { headers: { "Cache-Control": "no-store" } });
}
