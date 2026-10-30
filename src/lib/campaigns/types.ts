// ============================================================
// Tringlo AI — Campaigns
// ============================================================
//
// A campaign is a batch of leads handed to Sarvam's campaign scheduler, which
// dials them within an allowed schedule and retries unanswered ones itself.
// Tringlo keeps the record of what was sent and learns every outcome from the
// same webhook pipeline single calls use.
//
// Status is Tringlo's view:
//   scheduled, active, paused, cancelled — Sarvam's own states, mirrored
//   completed — Sarvam's `ended`
//   launching — between "Launch" and Sarvam accepting both campaign and cohort
//   failed    — Tringlo could not create the campaign or its cohort at Sarvam.
//               Never a provider state; it means nothing is dialling.
// ============================================================

export type CampaignStatus =
  | "launching"
  | "scheduled"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

/** The statuses Sarvam reports for a campaign, verbatim. */
export type SarvamCampaignStatus = "scheduled" | "active" | "paused" | "ended" | "cancelled";

export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface CampaignRetry {
  maxRetries: number;
  /** One value, applied between every attempt. */
  intervalMinutes: number;
  onBusy: boolean;
  onNoAnswer: boolean;
  onFailed: boolean;
  onShortDuration: boolean;
  /** A connected call shorter than this counts as short. */
  shortDurationSeconds: number;
}

export interface CampaignSchedule {
  /** ISO 8601 instants. */
  start: string;
  end: string;
  timezone: string;
  /** HH:MM, 24-hour, in `timezone`. */
  startTime: string;
  endTime: string;
  days: Weekday[];
}

export interface CampaignMember {
  leadId: string;
  /** E.164, as sent to Sarvam. */
  phone: string;
  name: string;
  /** Whether customer memory was passed for this lead at launch. */
  hadMemory: boolean;
}

export interface Campaign {
  id: string;
  tenantId: string;
  name: string;
  status: CampaignStatus;
  /** Last status Sarvam reported, verbatim. */
  providerStatus: SarvamCampaignStatus | null;
  providerCampaignId: string | null;

  cohortName: string;
  providerCohortId: string | null;
  cohortStatus: "processing" | "completed" | "failed" | null;
  cohortResult: { total: number; valid: number; rejected: number } | null;
  /** How the leads were handed over: CSV upload or JSON stream. */
  cohortMode: "upload" | "stream";

  /** The Sarvam agent and number it dials from, as configured on the server. */
  appId: string;
  appVersion: number;
  connectionId: string;
  phoneNumbers: string[];
  attemptsPerSecond: number;

  retry: CampaignRetry;
  schedule: CampaignSchedule;
  members: CampaignMember[];

  /** Why the campaign is `failed`, or the last control error. */
  failureReason: string | null;
  /** The webhook URL given to Sarvam, without its token. */
  webhookUrl: string | null;

  createdBy: string;
  createdAt: string;
  updatedAt: string;
  launchedAt: string | null;
  lastSyncedAt: string | null;
  /** Last time results were pulled from Sarvam's call records, and any error. */
  lastResultsSyncAt?: string | null;
  lastResultsSyncError?: string | null;
}

/** Sarvam's status → Tringlo's. */
export function fromProviderStatus(status: string | null | undefined): CampaignStatus | null {
  switch (status) {
    case "scheduled":
    case "active":
    case "paused":
    case "cancelled":
      return status;
    case "ended":
      return "completed";
    default:
      return null;
  }
}
