"use client";

import Link from "next/link";
import { use, useState } from "react";
import { ArrowLeft, AudioLines, FileText, Loader2, Pause, Play, RefreshCw, XCircle } from "lucide-react";

import { CallResultPanel } from "@/components/campaigns/call-result-panel";
import { STATUS_LABEL, STATUS_TONE, type CampaignStatsView, type CampaignStatus } from "@/components/campaigns/shared";
import { ErrorState, PageHeader, SkeletonBlock, Tag } from "@/components/ui/data-display";
import { useAuthStore } from "@/lib/store";
import { useApi } from "@/lib/use-dialo-data";
import { cn } from "@/lib/utils";

interface Detail {
  campaign: {
    id: string;
    name: string;
    status: CampaignStatus;
    providerStatus: string | null;
    cohortName: string;
    cohortStatus: string | null;
    cohortResult: { total: number; valid: number; rejected: number } | null;
    cohortMode: "upload" | "stream";
    appVersion: number;
    attemptsPerSecond: number;
    retry: { maxRetries: number; intervalMinutes: number; onBusy: boolean; onNoAnswer: boolean; onFailed: boolean; onShortDuration: boolean; shortDurationSeconds: number };
    schedule: { start: string; end: string; timezone: string; startTime: string; endTime: string; days: string[] };
    failureReason: string | null;
    createdAt: string;
    launchedAt: string | null;
    lastSyncedAt: string | null;
    lastResultsSyncAt: string | null;
    lastResultsSyncError: string | null;
  };
  stats: CampaignStatsView;
  leads: Array<{
    leadId: string;
    name: string;
    phone: string;
    hadMemory: boolean;
    attempts: number;
    latest: { callId: string; status: string; outcome: string | null; nextActionStatus: string | null; endedAt: string | null } | null;
  }>;
  calls: Array<{
    callId: string;
    leadId: string;
    name: string | null;
    status: string;
    outcome: string | null;
    interestLevel: string | null;
    retryAttempt: number;
    nextActionStatus: string | null;
    durationSeconds: number | null;
    failureReason: string | null;
    startedAt: string | null;
    endedAt: string | null;
    summary: string | null;
    followUpRequested: boolean;
    hasTranscript: boolean;
    hasRecording: boolean;
  }>;
}

const CALL_LABEL: Record<string, { label: string; tone: "neutral" | "pending" | "positive" | "warning" | "negative" }> = {
  connected: { label: "Connected", tone: "positive" },
  no_answer: { label: "No answer", tone: "warning" },
  busy: { label: "Busy", tone: "warning" },
  failed: { label: "Failed", tone: "negative" },
  provider_error: { label: "Provider error", tone: "negative" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  calling: { label: "Awaiting result", tone: "pending" },
};

const OUTCOME_LABEL: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  follow_up: "Follow-up",
  human_handoff: "Human handoff",
  do_not_call: "Do not call",
  uncertain: "Unclear",
};

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const detail = useApi<Detail>(`/api/campaigns/${encodeURIComponent(id)}`, 10_000);
  const [pending, setPending] = useState<"pause" | "resume" | "cancel" | null>(null);
  const [confirm, setConfirm] = useState<"pause" | "cancel" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const refreshResults = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}/sync`, { method: "POST" });
      if (response.status === 401) useAuthStore.getState().handleUnauthorized();
      const body = await response.json().catch(() => ({}));
      setSyncNote(
        response.ok
          ? body.applied
            ? `${body.applied} new result${body.applied === 1 ? "" : "s"} added from Sarvam.`
            : "Up to date — Sarvam has no results Tringlo doesn't already show."
          : body?.error?.message ?? "Could not reach Sarvam."
      );
    } catch {
      setSyncNote("Could not reach the server.");
    } finally {
      setSyncing(false);
      await detail.refresh();
    }
  };

  const act = async (action: "pause" | "resume" | "cancel") => {
    setPending(action);
    setActionError(null);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (response.status === 401) useAuthStore.getState().handleUnauthorized();
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setActionError(body?.error?.message ?? "Sarvam refused the change.");
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setPending(null);
      setConfirm(null);
      await detail.refresh();
    }
  };

  if (detail.isLoading) return <SkeletonBlock rows={6} columns={4} />;
  if (!detail.data) {
    return (
      <div className="space-y-4">
        <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Campaigns</Link>
        <ErrorState message={detail.error ?? "Campaign not found."} onRetry={detail.refresh} />
      </div>
    );
  }

  const { campaign, stats, leads, calls } = detail.data;
  const canPause = campaign.status === "active" || campaign.status === "scheduled";
  const canResume = campaign.status === "paused";
  const canCancel = canPause || canResume;

  const tiles: Array<[string, number | string, string?]> = [
    ["Total leads", stats.totalLeads],
    ["Queued", stats.queued, "Not called yet"],
    ["Calling", "—", "Sarvam reports each call when it ends"],
    ["Connected", stats.connected],
    ["No answer", stats.noAnswer],
    ["Busy", stats.busy],
    ["Failed", stats.failed],
    ["Retry scheduled", stats.retrying, "Sarvam will call again"],
    ["Interested", stats.interested],
    ["Not interested", stats.notInterested],
    ["Follow-up", stats.followUp, "Customer asked for a callback"],
    ["Human handoff", stats.humanHandoff],
  ];

  return (
    <div className="space-y-5">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Campaigns
      </Link>

      <PageHeader
        title={campaign.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Tag tone={STATUS_TONE[campaign.status]}>{STATUS_LABEL[campaign.status]}</Tag>
            <span>
              {when(campaign.schedule.start)} – {when(campaign.schedule.end)} · {campaign.schedule.startTime}–{campaign.schedule.endTime} {campaign.schedule.timezone}
            </span>
          </span>
        }
        actions={
          <>
            {canPause && (
              <button onClick={() => setConfirm("pause")} disabled={pending !== null} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm hover:bg-muted disabled:opacity-50">
                <Pause className="h-4 w-4" /> Pause
              </button>
            )}
            {canResume && (
              <button onClick={() => act("resume")} disabled={pending !== null} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {pending === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Resume
              </button>
            )}
            {canCancel && (
              <button onClick={() => setConfirm("cancel")} disabled={pending !== null} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-red-300 px-3.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40">
                <XCircle className="h-4 w-4" /> Cancel
              </button>
            )}
          </>
        }
      />

      {confirm && (
        <div role="alertdialog" aria-labelledby="confirm-title" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p id="confirm-title" className="flex-1 text-sm text-amber-900 dark:text-amber-200">
            {confirm === "cancel"
              ? "Cancel this campaign? Sarvam stops calling and it cannot be restarted. Results so far are kept."
              : "Pause this campaign? No new calls start until you resume. Calls already in progress finish."}
          </p>
          <button onClick={() => setConfirm(null)} className="h-9 rounded-md border bg-background px-3.5 text-sm">Keep running</button>
          <button
            onClick={() => act(confirm)}
            disabled={pending !== null}
            className={cn("inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium text-white disabled:opacity-60", confirm === "cancel" ? "bg-red-600" : "bg-amber-600")}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirm === "cancel" ? "Cancel campaign" : "Pause campaign"}
          </button>
        </div>
      )}

      {actionError && <ErrorState message={actionError} />}
      {campaign.failureReason && <ErrorState message={campaign.failureReason} />}

      <section className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Progress</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {stats.finished} of {stats.totalLeads} leads finished · {stats.remaining} remaining · {stats.attempts} call attempts
            {stats.connectionRate !== null && ` · ${Math.round(stats.connectionRate * 100)}% of reached leads connected`}
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(stats.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Campaign progress">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${stats.progress * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A lead is finished when a call connects, or when Sarvam has no retries left for it.
          {campaign.lastSyncedAt && ` Status checked with Sarvam ${when(campaign.lastSyncedAt)}.`}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
          <button
            onClick={refreshResults}
            disabled={syncing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Fetching results…" : "Refresh results"}
          </button>
          <p className="text-xs text-muted-foreground">
            {syncNote ??
              (campaign.lastResultsSyncError
                ? `Last attempt to read Sarvam's records failed: ${campaign.lastResultsSyncError}`
                : campaign.lastResultsSyncAt
                  ? `Results checked against Sarvam's records ${when(campaign.lastResultsSyncAt)}. This also happens automatically every minute.`
                  : "Results are checked against Sarvam's records automatically every minute.")}
          </p>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-[30px] font-serif leading-none tracking-[-0.01em] [font-variant-numeric:lining-nums_tabular-nums]">{value}</dd>
            {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
          </div>
        ))}
      </dl>

      <section className="rounded-lg border bg-card">
        <div className="flex items-baseline justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Call results</h2>
          <p className="text-xs text-muted-foreground">{calls.length} call{calls.length === 1 ? "" : "s"} · open one for its transcript and recording</p>
        </div>
        {calls.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            No call results yet. Each call appears here when it ends — use Refresh results to check Sarvam now.
          </p>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Outcome</th>
                  <th className="px-3 py-2 font-medium">Length</th>
                  <th className="px-3 py-2 font-medium"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {calls.map((call) => {
                  const status = CALL_LABEL[call.status] ?? { label: call.status, tone: "neutral" as const };
                  return (
                    <tr key={call.callId} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpenCall(call.callId)}>
                      <td className="px-5 py-2.5">
                        <p className="font-medium">{call.name ?? "Lead"}</p>
                        {call.retryAttempt > 0 && <p className="text-[11px] text-muted-foreground">Retry {call.retryAttempt}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{when(call.startedAt ?? call.endedAt)}</td>
                      <td className="px-3 py-2.5">
                        <Tag tone={status.tone}>{status.label}</Tag>
                        {call.nextActionStatus && <p className="mt-1 text-[11px] text-muted-foreground">Sarvam will retry</p>}
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5 text-xs">
                        <p className="font-medium">{call.outcome ? OUTCOME_LABEL[call.outcome] ?? call.outcome : call.status === "connected" ? "Unclear" : "—"}</p>
                        {call.followUpRequested && <p className="text-[11px] text-muted-foreground">Asked for a callback</p>}
                        {call.summary && <p className="mt-0.5 line-clamp-2 text-muted-foreground">{call.summary}</p>}
                        {call.failureReason && <p className="mt-0.5 text-red-600 dark:text-red-400">{call.failureReason}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs tabular-nums">{call.durationSeconds ? `${Math.round(call.durationSeconds)}s` : "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center justify-end gap-2 text-muted-foreground">
                          {call.hasTranscript && <FileText className="h-3.5 w-3.5" aria-label="Has transcript" />}
                          {call.hasRecording && <AudioLines className="h-3.5 w-3.5" aria-label="Has recording" />}
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenCall(call.callId);
                            }}
                            className="rounded-md border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                          >
                            View
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-card">
        <h2 className="border-b px-5 py-3 text-sm font-semibold">Leads</h2>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr><th className="px-5 py-2 font-medium">Lead</th><th className="px-3 py-2 font-medium">Latest result</th><th className="px-3 py-2 font-medium">Outcome</th><th className="px-3 py-2 text-right font-medium">Calls</th></tr>
            </thead>
            <tbody className="divide-y">
              {leads.map((lead) => {
                const call = lead.latest ? CALL_LABEL[lead.latest.status] ?? { label: lead.latest.status, tone: "neutral" as const } : null;
                return (
                  <tr
                    key={lead.leadId}
                    className={cn(lead.latest && "cursor-pointer hover:bg-muted/40")}
                    onClick={() => lead.latest && setOpenCall(lead.latest.callId)}
                  >
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{lead.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{lead.phone}{lead.hadMemory ? " · returning" : ""}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      {call ? <Tag tone={call.tone}>{call.label}</Tag> : <Tag tone="neutral">Queued</Tag>}
                      {lead.latest?.nextActionStatus && <p className="mt-1 text-[11px] text-muted-foreground">Retry scheduled</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{lead.latest?.outcome ? OUTCOME_LABEL[lead.latest.outcome] ?? lead.latest.outcome : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{lead.attempts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5 text-sm">
        <h2 className="text-sm font-semibold">Settings sent to Sarvam</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {[
            ["Cohort", `${campaign.cohortName} (${campaign.cohortMode === "stream" ? "sent as JSON" : "CSV upload"})${campaign.cohortStatus ? ` · ${campaign.cohortStatus}` : ""}`],
            ["Accepted by Sarvam", campaign.cohortResult ? `${campaign.cohortResult.valid} of ${campaign.cohortResult.total} (${campaign.cohortResult.rejected} rejected)` : "Not reported yet"],
            ["Calling days", campaign.schedule.days.map((day) => day.slice(0, 3)).join(", ")],
            ["Calling rate", `${campaign.attemptsPerSecond} per second`],
            ["Retries", campaign.retry.maxRetries === 0 ? "None" : `Up to ${campaign.retry.maxRetries}, every ${campaign.retry.intervalMinutes} min`],
            ["Agent version", `v${campaign.appVersion}`],
            ["Launched", when(campaign.launchedAt)],
            ["Sarvam status", campaign.providerStatus ?? "—"],
          ].map(([term, value]) => (
            <div key={term} className="flex justify-between gap-4 border-b py-1.5">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {openCall && <CallResultPanel callId={openCall} onClose={() => setOpenCall(null)} />}
    </div>
  );
}
