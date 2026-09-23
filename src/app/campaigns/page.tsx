"use client";

import { useMemo, useState } from "react";
import { Megaphone, Pause, Phone, Play, Plus, X } from "lucide-react";

import type { Campaign, Lead } from "@/lib/types";
import { useAgentConfigStore, useCampaignsStore } from "@/lib/store";
import { useCallRecords, useLeads } from "@/lib/use-dialo-data";
import { useModalEntrance, useReveal } from "@/lib/animation";
import { isConnected, isInterested } from "@/lib/metrics";
import { EMPTY, formatDate, formatPercent } from "@/lib/format";
import { EmptyState, ErrorState, PageHeader, Tag } from "@/components/ui/data-display";
import { RealCallModal } from "@/components/call/RealCallModal";

interface CampaignStats {
  totalLeads: number;
  calledLeads: number;
  connectedLeads: number;
  interestedLeads: number;
}

export default function CampaignsPage() {
  const { campaigns, addCampaign, updateCampaign } = useCampaignsStore();
  const { leads, error: leadsError, refresh: refreshLeads } = useLeads();
  const { records, refresh: refreshRecords } = useCallRecords();
  const { config: agentConfig } = useAgentConfigStore();

  const [isCreating, setIsCreating] = useState(false);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  /**
   * Campaign progress is derived from the call records themselves rather than
   * from counters incremented in the browser, so a refresh or a second tab can
   * never drift from what actually happened on the phone.
   */
  const statsByCampaign = useMemo(() => {
    const stats = new Map<string, CampaignStats>();

    for (const campaign of campaigns) {
      const campaignLeads = leads.filter((lead) => lead.campaign === campaign.id);
      const leadIds = new Set(campaignLeads.map((lead) => lead.id));
      const campaignRecords = records.filter((record) => leadIds.has(record.leadId));

      stats.set(campaign.id, {
        totalLeads: campaignLeads.length,
        calledLeads: new Set(campaignRecords.map((record) => record.leadId)).size,
        connectedLeads: new Set(
          campaignRecords.filter(isConnected).map((record) => record.leadId)
        ).size,
        interestedLeads: new Set(
          campaignRecords.filter(isInterested).map((record) => record.leadId)
        ).size,
      });
    }

    return stats;
  }, [campaigns, leads, records]);

  const listRef = useReveal<HTMLDivElement>({
    selector: "[data-campaign]",
    deps: [campaigns.length],
    enabled: campaigns.length > 0,
  });

  const callNextLead = (campaign: Campaign) => {
    const next = leads.find(
      (lead) => lead.campaign === campaign.id && lead.status === "queued" && !lead.suppressed
    );
    if (!next) return;
    setActiveLead(next);
    if (campaign.status !== "active") updateCampaign(campaign.id, { status: "active" });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        description="Group leads and work through them one call at a time"
        actions={
          <button
            onClick={() => setIsCreating(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New campaign
          </button>
        }
      />

      {leadsError && <ErrorState message={leadsError} onRetry={refreshLeads} />}

      {campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Create a campaign to group your leads. Progress and interest rate are computed from the calls Sarvam actually completes."
          action={
            <button
              onClick={() => setIsCreating(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Create campaign
            </button>
          }
        />
      ) : (
        <div ref={listRef} className="space-y-3">
          {campaigns.map((campaign) => {
            const stats = statsByCampaign.get(campaign.id) ?? {
              totalLeads: 0,
              calledLeads: 0,
              connectedLeads: 0,
              interestedLeads: 0,
            };
            const progress =
              stats.totalLeads > 0 ? (stats.calledLeads / stats.totalLeads) * 100 : 0;
            const interestRate =
              stats.connectedLeads > 0
                ? (stats.interestedLeads / stats.connectedLeads) * 100
                : null;
            const hasNextLead = leads.some(
              (lead) =>
                lead.campaign === campaign.id && lead.status === "queued" && !lead.suppressed
            );

            return (
              <article
                key={campaign.id}
                data-campaign
                className="rounded-lg border bg-card p-5 transition-colors hover:border-foreground/15"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h2 className="font-heading text-base font-semibold tracking-tight">
                        {campaign.name}
                      </h2>
                      <Tag
                        tone={
                          campaign.status === "active"
                            ? "positive"
                            : campaign.status === "paused"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {campaign.status}
                      </Tag>
                    </div>
                    {campaign.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{campaign.description}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(campaign.createdAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => callNextLead(campaign)}
                      disabled={!hasNextLead}
                      title={
                        hasNextLead
                          ? "Call the next queued lead in this campaign"
                          : "No queued leads assigned to this campaign"
                      }
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent disabled:hover:text-accent-foreground"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Call next
                    </button>
                    <button
                      onClick={() =>
                        updateCampaign(campaign.id, {
                          status: campaign.status === "active" ? "paused" : "active",
                        })
                      }
                      aria-label={campaign.status === "active" ? "Pause campaign" : "Resume campaign"}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {campaign.status === "active" ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Leads" value={stats.totalLeads} />
                  <Stat label="Called" value={stats.calledLeads} />
                  <Stat label="Answered" value={stats.connectedLeads} />
                  <Stat
                    label="Interest rate"
                    display={interestRate === null ? EMPTY : formatPercent(interestRate, 0)}
                  />
                </dl>

                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {stats.totalLeads === 0
                      ? "No leads assigned to this campaign yet"
                      : `${stats.calledLeads} of ${stats.totalLeads} leads called`}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {isCreating && (
        <CreateCampaignDialog
          onClose={() => setIsCreating(false)}
          onCreate={(name, description) => {
            addCampaign({
              id: `camp_${Date.now()}`,
              name,
              description,
              status: "draft",
              // Counts live on the call records, not here — these stay at zero and
              // the UI reads the derived numbers instead.
              totalLeads: 0,
              calledLeads: 0,
              interestedLeads: 0,
              createdAt: new Date().toISOString(),
            });
            setIsCreating(false);
          }}
        />
      )}

      {activeLead && (
        <RealCallModal
          lead={activeLead}
          agentConfig={agentConfig}
          onClose={() => {
            setActiveLead(null);
            refreshLeads();
            refreshRecords();
          }}
          onSettled={() => {
            refreshLeads();
            refreshRecords();
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  display,
}: {
  label: string;
  value?: number;
  display?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-heading text-xl font-semibold tabular-nums tracking-tight">
        {display ?? value}
      </dd>
    </div>
  );
}

function CreateCampaignDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
}) {
  const { backdropRef, panelRef } = useModalEntrance();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New campaign"
    >
      <div ref={panelRef} className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-heading text-base font-semibold tracking-tight">New campaign</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          <div>
            <label htmlFor="campaign-name" className="text-xs font-medium text-muted-foreground">
              Name
            </label>
            <input
              id="campaign-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Q4 outbound"
              className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="campaign-desc" className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <textarea
              id="campaign-desc"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this campaign is for"
              className="mt-1.5 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <button
            onClick={onClose}
            className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onCreate(name.trim(), description.trim())}
            className="h-9 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}
