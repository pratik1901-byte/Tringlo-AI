// ============================================================
// POST /api/campaigns/:id/sync
// ============================================================
//
// "Refresh results": pulls every attempt Sarvam recorded for this campaign —
// outcome, transcript, recording — into Tringlo now, instead of waiting for the
// background sync. Read-only towards Sarvam; places no calls.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { syncCampaign } from "@/lib/campaigns/service";
import { syncCampaignResults } from "@/lib/campaigns/sync";
import { getCampaignRun } from "@/lib/db";
import { rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const campaign = getCampaignRun(auth.tenantId, id);
  if (!campaign) return NextResponse.json({ error: { message: "No such campaign." } }, { status: 404 });

  const limit = rateLimit(`campaign-sync:${auth.tenantId}:${id}`, 6, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: { message: "Results were refreshed a moment ago. Try again shortly." } }, { status: 429 });
  }

  const current = await syncCampaign(campaign, true);
  const result = await syncCampaignResults(current);
  if (!result.ok) {
    return NextResponse.json({ error: { message: result.error ?? "Could not read Sarvam's call records." } }, { status: 502 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
