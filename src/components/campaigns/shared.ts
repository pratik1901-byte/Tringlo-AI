// Shared between the campaign list and the campaign dashboard.

export type CampaignStatus = "launching" | "scheduled" | "active" | "paused" | "completed" | "cancelled" | "failed";

export interface CampaignStatsView {
  totalLeads: number;
  queued: number;
  /** Sarvam reports attempts after they end, so "ringing now" is unknown. */
  calling: null;
  connected: number;
  noAnswer: number;
  busy: number;
  failed: number;
  retrying: number;
  interested: number;
  notInterested: number;
  followUp: number;
  humanHandoff: number;
  finished: number;
  remaining: number;
  attempts: number;
  progress: number;
  connectionRate: number | null;
}

export const STATUS_TONE: Record<CampaignStatus, "neutral" | "pending" | "positive" | "warning" | "negative"> = {
  launching: "pending",
  scheduled: "pending",
  active: "positive",
  paused: "warning",
  completed: "neutral",
  cancelled: "neutral",
  failed: "negative",
};

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  launching: "Launching",
  scheduled: "Scheduled",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};
