// ============================================================
// /api/customers/:id/context
// ============================================================
//
// What Tringlo remembers about one customer.
//
// GET returns it for display. DELETE forgets it, which is what a customer's
// "delete what you hold about me" request resolves to.
//
// Both are authenticated and tenant-scoped. A customer id from another business
// reports 404 rather than 403, so the existence of another tenant's customer is
// not confirmed. The client is given a projected view — category, phrase,
// confidence, when it was learned — and never the raw stored rows, so the
// storage shape stays free to change.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { forgetCustomerMemory, getCustomerProfile, getMemoryItems } from "@/lib/db";
import { buildCallContext } from "@/lib/memory/context";
import { CONFIDENCE_FLOOR } from "@/lib/memory/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  // Scoped by tenant in the lookup itself, not filtered afterwards.
  const profile = getCustomerProfile(auth.tenantId, id);
  if (!profile) {
    return NextResponse.json(
      { error: { code: "not_found", message: "No such customer." } },
      { status: 404 }
    );
  }

  const items = getMemoryItems(auth.tenantId, id);

  // Exactly what the agent would be given if this customer were called now,
  // so what Priya "knows" is never a mystery to the people using Tringlo.
  const next = buildCallContext(profile, items, { isFollowUp: false });

  return NextResponse.json(
    {
      customer: {
        id: profile.id,
        // The name Tringlo would use, plus a flag where it is unsure who this is.
        name: profile.names[0] ?? null,
        phone: profile.phoneE164 ?? profile.phoneNational,
        identityAmbiguous: profile.identityAmbiguous,
        knownSince: profile.createdAt,
      },
      memories: items
        .filter((item) => item.status === "active")
        .sort((a, b) => b.confidence - a.confidence)
        .map((item) => ({
          id: item.id,
          category: item.category,
          fact: item.phrase,
          value: item.value,
          confidence: item.confidence,
          // Surfaced so the UI can mark an uncertain memory as uncertain
          // rather than presenting everything as settled.
          certain: item.confidence >= CONFIDENCE_FLOOR + 0.2,
          evidence: item.evidence ?? null,
          firstObservedAt: item.firstObservedAt,
          lastConfirmedAt: item.lastConfirmedAt,
          sourceCallId: item.sourceCallId,
        })),
      nextCallContext: {
        previousInteraction: next.previousInteraction,
        customerMemoryContext: next.customerMemoryContext,
        lastCallSummary: next.lastCallSummary,
        previousInterest: next.previousInterest,
        previousObjection: next.previousObjection,
        previousCommitment: next.previousCommitment,
        previousNextStep: next.previousNextStep,
        memoriesUsed: next.usedItems.map((item) => item.id),
      },
      // Retired memories, so a person can see what was corrected and when.
      corrected: items
        .filter((item) => item.status === "corrected")
        .map((item) => ({
          id: item.id,
          fact: item.phrase,
          correctedByCallId: item.correctedByCallId,
          updatedAt: item.updatedAt,
        })),
      recentCalls: profile.recentSummaries.map((entry) => ({
        callId: entry.callId,
        at: entry.at,
        durationSeconds: entry.durationSeconds,
        summary: entry.summary,
        interest: entry.interest,
        objection: entry.objection,
        nextStep: entry.nextStep,
        wasFollowUp: entry.wasFollowUp,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Forgets what Tringlo knows about this customer.
 *
 * `?hard=1` erases the rows; the default hides them but keeps provenance.
 * Erasure is the right answer to a deletion request, and hiding is the right
 * answer to "that's wrong", so both exist and the caller chooses.
 */
export async function DELETE(
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

  const hard = new URL(request.url).searchParams.get("hard") === "1";
  const affected = forgetCustomerMemory(auth.tenantId, id, { hard });

  console.log(
    `MEMORY_FORGOTTEN customer=${id} tenant=${auth.tenantId} hard=${hard} items=${affected}`
  );

  return NextResponse.json(
    { ok: true, forgotten: affected, hard },
    { headers: { "Cache-Control": "no-store" } }
  );
}
