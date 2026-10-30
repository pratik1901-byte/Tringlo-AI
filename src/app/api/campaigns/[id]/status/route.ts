// ============================================================
// POST /api/campaigns/:id/status
// ============================================================
//
// Pause, resume or cancel a campaign — through Sarvam's
// PUT …/campaigns/{campaign_id}/status with { action }. The resulting status
// is whatever Sarvam reports back, never assumed.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { controlCampaign } from "@/lib/campaigns/service";
import { getCampaignRun } from "@/lib/db";

const ACTIONS = ["pause", "resume", "cancel"] as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const campaign = getCampaignRun(auth.tenantId, id);
  if (!campaign) return NextResponse.json({ error: { message: "No such campaign." } }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const action = ACTIONS.find((candidate) => candidate === body?.action);
  if (!action) return NextResponse.json({ error: { message: "action must be pause, resume or cancel." } }, { status: 400 });

  const result = await controlCampaign(campaign, action);
  if (!result.ok) {
    return NextResponse.json(
      { error: { message: result.error ?? "Sarvam refused the change." }, status: result.campaign.status },
      { status: 409, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json({ status: result.campaign.status }, { headers: { "Cache-Control": "no-store" } });
}
