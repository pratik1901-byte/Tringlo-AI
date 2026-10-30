// ============================================================
// GET /api/campaigns/:id
// ============================================================
//
// One campaign: its settings, its status (refreshed from Sarvam at most every
// ten seconds), progress computed from real call records, each lead's latest
// outcome, and recent attempts. Another workspace's campaign is a 404.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { campaignAttempts, campaignStats, syncCampaign } from "@/lib/campaigns/service";
import { syncCampaignResults } from "@/lib/campaigns/sync";
import { getCampaignRun } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const stored = getCampaignRun(auth.tenantId, id);
  if (!stored) return NextResponse.json({ error: { message: "No such campaign." } }, { status: 404 });

  const campaign = await syncCampaign(stored);

  // Results older than a minute are refreshed in the background; the page
  // polls, so they appear on the next refresh without delaying this one.
  const lastPull = campaign.lastResultsSyncAt ? new Date(campaign.lastResultsSyncAt).getTime() : 0;
  if (campaign.providerCampaignId && Date.now() - lastPull > 60_000) {
    void syncCampaignResults(campaign).catch(() => undefined);
  }
  const attempts = campaignAttempts(campaign);
  const latestByLead = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) if (!latestByLead.has(attempt.leadId)) latestByLead.set(attempt.leadId, attempt);

  return NextResponse.json(
    {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        providerStatus: campaign.providerStatus,
        cohortName: campaign.cohortName,
        cohortStatus: campaign.cohortStatus,
        cohortResult: campaign.cohortResult,
        cohortMode: campaign.cohortMode,
        appVersion: campaign.appVersion,
        attemptsPerSecond: campaign.attemptsPerSecond,
        retry: campaign.retry,
        schedule: campaign.schedule,
        failureReason: campaign.failureReason,
        createdAt: campaign.createdAt,
        launchedAt: campaign.launchedAt,
        lastSyncedAt: campaign.lastSyncedAt,
        lastResultsSyncAt: campaign.lastResultsSyncAt ?? null,
        lastResultsSyncError: campaign.lastResultsSyncError ?? null,
      },
      stats: campaignStats(campaign, attempts),
      leads: campaign.members.map((member) => {
        const latest = latestByLead.get(member.leadId);
        return {
          leadId: member.leadId,
          name: member.name,
          phone: member.phone,
          hadMemory: member.hadMemory,
          attempts: attempts.filter((attempt) => attempt.leadId === member.leadId).length,
          latest: latest
            ? {
                callId: latest.id,
                status: latest.status,
                outcome: latest.aiResult?.status ?? null,
                nextActionStatus: latest.nextActionStatus ?? null,
                endedAt: latest.endedAt,
              }
            : null,
        };
      }),
      // Every call in the campaign, newest first — one row per attempt.
      calls: attempts.slice(0, 1000).map((attempt) => ({
        callId: attempt.id,
        leadId: attempt.leadId,
        name: attempt.lead?.name ?? null,
        status: attempt.status,
        outcome: attempt.aiResult?.status ?? null,
        interestLevel: attempt.interestLevel ?? null,
        retryAttempt: attempt.retryAttempt ?? 0,
        nextActionStatus: attempt.nextActionStatus ?? null,
        durationSeconds: attempt.duration,
        failureReason: attempt.failureReason ?? null,
        startedAt: attempt.startedAt,
        endedAt: attempt.endedAt,
        summary: attempt.aiSummary,
        followUpRequested: attempt.followUpRequired ?? false,
        hasTranscript: Boolean(attempt.transcriptTurns?.length),
        hasRecording: Boolean(attempt.status === "connected" && attempt.providerInteractionId),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
