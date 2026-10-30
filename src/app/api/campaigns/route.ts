// ============================================================
// /api/campaigns
// ============================================================
//
// GET  — the workspace's campaigns with progress from real call records.
// POST — launch one: validates the sheet and settings on the server, then
//        creates the campaign and its cohort at Sarvam.
//
// The browser never talks to Sarvam and never sees provider credentials.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { campaignStats, launchCampaign, type LaunchInput } from "@/lib/campaigns/service";
import { WEEKDAYS, type Weekday } from "@/lib/campaigns/types";
import { getCampaignRuns } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const campaigns = getCampaignRuns(auth.tenantId).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    providerStatus: campaign.providerStatus,
    createdAt: campaign.createdAt,
    launchedAt: campaign.launchedAt,
    schedule: campaign.schedule,
    failureReason: campaign.failureReason,
    stats: campaignStats(campaign),
  }));

  return NextResponse.json({ campaigns }, { headers: noStore });
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(clientKey(request, "campaign-launch"), 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: { message: "Too many launches. Try again later." } }, { status: 429, headers: noStore });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "Expected a JSON body." } }, { status: 400, headers: noStore });
  }

  const schedule = (body.schedule ?? {}) as Record<string, unknown>;
  const retry = (body.retry ?? {}) as Record<string, unknown>;
  const csv = typeof body.csv === "string" ? body.csv : "";
  if (csv.length > 5_000_000) {
    return NextResponse.json({ error: { message: "The sheet is larger than 5 MB." } }, { status: 413, headers: noStore });
  }

  const input: LaunchInput = {
    name: String(body.name ?? ""),
    cohortName: String(body.cohortName ?? ""),
    csv,
    attemptsPerSecond: num(body.attemptsPerSecond, 1),
    skipInvalidRows: body.skipInvalidRows === true,
    schedule: {
      start: String(schedule.start ?? ""),
      end: String(schedule.end ?? ""),
      timezone: String(schedule.timezone ?? ""),
      startTime: String(schedule.startTime ?? ""),
      endTime: String(schedule.endTime ?? ""),
      days: (Array.isArray(schedule.days) ? schedule.days : []).filter((day): day is Weekday =>
        WEEKDAYS.includes(day as Weekday)
      ),
    },
    retry: {
      maxRetries: num(retry.maxRetries, 0),
      intervalMinutes: num(retry.intervalMinutes, 30),
      onBusy: retry.onBusy === true,
      onNoAnswer: retry.onNoAnswer === true,
      onFailed: retry.onFailed === true,
      onShortDuration: retry.onShortDuration === true,
      shortDurationSeconds: num(retry.shortDurationSeconds, 25),
    },
  };

  let result: Awaited<ReturnType<typeof launchCampaign>>;
  try {
    result = await launchCampaign(auth.tenantId, auth.user.id, input);
  } catch (error) {
    // Unexpected: say what happened instead of a bare 500.
    console.error("CAMPAIGN_LAUNCH_CRASHED", error instanceof Error ? error.stack ?? error.message : error);
    return NextResponse.json(
      { error: { message: `The campaign could not be launched: ${error instanceof Error ? error.message : "unexpected error"}.`, problems: [] } },
      { status: 500, headers: noStore }
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      {
        error: { message: result.problems?.[0] ?? "The campaign could not be launched.", problems: result.problems ?? [] },
        campaignId: result.campaign?.id ?? null,
      },
      { status: result.campaign ? 502 : 400, headers: noStore }
    );
  }

  return NextResponse.json({ campaign: { id: result.campaign!.id, status: result.campaign!.status } }, { status: 201, headers: noStore });
}
