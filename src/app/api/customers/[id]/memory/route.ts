// ============================================================
// /api/customers/:id/memory
// ============================================================
//
// Every memory held about one customer, with its provenance: the call it came
// from, the customer's own words it rests on, and what happened to it since —
// confirmed, superseded, corrected or suppressed.
//
// This is the audit view. The context route shows what the agent would be
// told; this shows everything, including what it is no longer told and why.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { getCustomerProfile, getMemoryItems } from "@/lib/db";

const STATUS_ORDER = { active: 0, superseded: 1, corrected: 2, forgotten: 3 } as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!getCustomerProfile(auth.tenantId, id)) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No such customer." } },
      { status: 404 }
    );
  }

  const memories = getMemoryItems(auth.tenantId, id)
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.category.localeCompare(b.category) ||
        b.lastConfirmedAt.localeCompare(a.lastConfirmedAt)
    )
    .map((item) => ({
      id: item.id,
      category: item.category,
      key: item.key,
      value: item.value,
      fact: item.phrase,
      evidence: item.evidence ?? null,
      confidence: item.confidence,
      status: item.status,
      sourceCallId: item.sourceCallId,
      lastConfirmedCallId: item.lastConfirmedCallId,
      correctedByCallId: item.correctedByCallId,
      firstObservedAt: item.firstObservedAt,
      lastConfirmedAt: item.lastConfirmedAt,
      updatedAt: item.updatedAt,
    }));

  return NextResponse.json({ memories }, { headers: { "Cache-Control": "no-store" } });
}
