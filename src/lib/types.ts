// ============================================================
// Tringlo AI — Core Type Definitions
// ============================================================

// --- Call States ---
// `queued` / `scheduled` / `suppressed` describe a lead that has not been dialled.
// `initiating` / `calling` are the only two in-flight states: they mean "request sent
// to Sarvam" and "waiting for a provider event" respectively. They are NEVER advanced
// by elapsed time — only a Sarvam webhook moves a call to a terminal state.
// `connected` / `no_answer` / `busy` / `failed` / `cancelled` are terminal provider states.
export type CallStatus =
  | "queued"
  | "scheduled"
  | "suppressed"
  | "initiating"
  | "calling"
  | "connected"
  | "no_answer"
  | "busy"
  | "failed"
  | "cancelled"
  | "provider_error";

/** Provider-confirmed terminal states. Nothing else ends a call. */
export const TERMINAL_CALL_STATUSES: CallStatus[] = [
  "connected",
  "no_answer",
  "busy",
  "failed",
  "cancelled",
  "provider_error",
];

export function isTerminalCallStatus(status?: string | null): boolean {
  return Boolean(status && TERMINAL_CALL_STATUSES.includes(status as CallStatus));
}

export function isInFlightCallStatus(status?: string | null): boolean {
  return status === "initiating" || status === "calling";
}

// --- Interest Levels ---
export type InterestLevel = "high" | "medium" | "low" | "none";

// --- Rejection Reasons ---
export type RejectionReason =
  | "price"
  | "existing_supplier"
  | "no_requirement"
  | "product_mismatch"
  | "bad_timing"
  | "other";

// --- Follow-up Status ---
export type FollowUpStatus =
  /** The customer asked for a callback but gave no usable time. */
  | "needs_scheduling"
  /** An agreed time is set and the worker will place the call when it arrives. */
  | "scheduled"
  /** A worker has claimed this row and is placing the call. */
  | "triggering"
  /** The outbound call is in flight; its webhook will close this out. */
  | "calling"
  /** The callback connected. */
  | "completed"
  /** The callback did not reach anyone; a retry may be queued. */
  | "no_answer"
  | "busy"
  /** The attempt failed and will not be retried again. */
  | "failed"
  /** Waiting for its retry time. */
  | "retry_pending"
  | "cancelled";

/** Statuses a worker may pick up, given their due time has arrived. */
export const SCHEDULABLE_FOLLOW_UP_STATUSES: FollowUpStatus[] = [
  "scheduled",
  "retry_pending",
  // Included on purpose: a row left mid-flight by a crashed worker must be
  // recoverable once its lock expires, or the callback is stranded forever.
  "triggering",
];

/** Nothing more will happen to a follow-up in one of these. */
export const TERMINAL_FOLLOW_UP_STATUSES: FollowUpStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

// --- Structured AI Result ---
// Every field is nullable: a field is only populated when Sarvam actually returned it.
export interface AICallResult {
  status:
    | "interested"
    | "not_interested"
    | "follow_up"
    | "human_handoff"
    | "do_not_call"
    | "uncertain";
  interest_level: InterestLevel | null;
  callback_required: boolean;
  callback_datetime: string | null;
  reason_not_interested: string | null;
  customer_requirements: string[];
  human_handoff_required: boolean;
  opt_out: boolean;
  /** 0-100, or null when Sarvam did not report a confidence. Never inferred. */
  confidence: number | null;
}

// --- Lead ---
export interface Lead {
  id: string;
  name: string;
  /**
   * Owning business. Optional because rows written before tenancy existed have
   * none; those are read as belonging to the legacy tenant. See lib/auth/guard.
   */
  tenantId?: string | null;
  phone: string;
  email?: string;
  company?: string;
  notes?: string;
  campaign?: string;
  callingDate: string;
  callingTime: string;
  timezone: string;
  createdAt: string;
  status: CallStatus;
  suppressed: boolean;
  /** How the lead came to exist. Absent for leads created before this existed. */
  source?: "upload" | "manual" | "campaign" | "inbound";
  /** Why the lead was suppressed (e.g. Sarvam reported do_not_call). */
  suppressedReason?: string | null;
  suppressedAt?: string | null;
  lastAttemptId?: string | null;
}

// --- Call Record ---
// The authoritative record of one dial attempt. Every conversation-derived field is
// null until the Sarvam webhook supplies it. Nothing here is ever inferred locally.
export interface CallRecord {
  id: string;
  leadId: string;
  /**
   * Owning business. Optional because rows written before tenancy existed have
   * none; those are read as belonging to the legacy tenant. See lib/auth/guard.
   */
  tenantId?: string | null;
  lead: Lead;
  status: CallStatus;
  /** Set from Sarvam `start_datetime`; null while only the trigger request has been sent. */
  startedAt: string | null;
  /** Set from Sarvam `end_datetime`. Null until a terminal webhook arrives. */
  endedAt: string | null;
  /** When the outbound request was accepted by Sarvam (local clock, not a call event). */
  requestedAt: string | null;
  connectedAt: string | null;
  /** Seconds, strictly from Sarvam `duration`. Never measured client-side. */
  duration: number | null;
  attempts: number;
  transcript: string | null;
  transcriptTurns: TranscriptTurn[] | null;
  aiSummary: string | null;
  aiResult: AICallResult | null;
  lastContactedAt: string | null;
  nextAction: string | null;
  /**
   * `requested`: the agent reported the caller needed a person.
   * `transferred`: Sarvam's own call record shows the call ended by transfer.
   * `transfer_failed`: a transfer was needed but Sarvam shows it did not happen.
   */
  humanHandoffStatus: "none" | "requested" | "assigned" | "completed" | "transferred" | "transfer_failed";

  // --- Provider correlation ---
  provider: "sarvam";
  /** The voice agent's configured name, used to label transcript turns. */
  agentName?: string | null;
  /** Whether a person pressed Call Now, or the follow-up scheduler placed this. */
  origin?: "manual" | "scheduler" | "campaign" | "demo";
  /**
   * Who started the call. Absent on records written before inbound existed;
   * read through `callDirection()`, which treats absent as outbound.
   */
  direction?: "outbound" | "inbound";
  /** Inbound only: the Sarvam deployment that answered, and the number dialled. */
  providerDeploymentId?: string | null;
  inboundNumber?: string | null;
  /** Inbound only: why they called, as the agent reported it (never guessed). */
  intent?: string | null;
  /** Inbound only: resolved by the agent, escalated to a person, or neither. */
  resolutionStatus?: "resolved" | "escalated" | "unresolved" | null;
  /** The number a transfer went to, when Sarvam confirms one. */
  transferredTo?: string | null;
  /** Set on attempts placed by a Sarvam campaign. */
  campaignId?: string | null;
  providerCampaignId?: string | null;
  providerCohortId?: string | null;
  /** 0 for the first attempt at a lead, 1 for Sarvam's first retry, and so on. */
  retryAttempt?: number | null;
  /**
   * What Sarvam's retry engine will do next for this lead (`retry`,
   * `short_duration_retry`, …), or null when this attempt was final.
   */
  nextActionStatus?: string | null;
  providerCallId?: string;
  /** Sarvam `attempt_id` — the correlation key between Tringlo and the webhook. */
  providerAttemptId?: string;
  /** The Sarvam agent this call ran on, recorded when it was placed. */
  providerAppId?: string | null;
  providerInteractionId?: string | null;
  providerStatus?: string | null;
  connectivityStatus?: string | null;
  completionStatus?: string | null;
  failureReason?: string | null;
  recordingUrl?: string | null;

  // --- Sarvam output variables (verbatim, post-call) ---
  callOutcome?: string | null;
  callDisposition?: string | null;
  interestLevel?: string | null;
  /** 0-100 or null. */
  interestConfidence?: number | null;
  painPoints?: string | null;
  objection?: string | null;
  customerRequirement?: string | null;
  budgetIndication?: string | null;
  timelineToDecide?: string | null;
  authorityLevel?: string | null;
  competitorMentioned?: string | null;
  discoveryFitScore?: string | number | null;
  chosenNextStep?: string | null;
  nextStepDateTime?: string | null;
  followUpRequired?: boolean;
  followUpDate?: string | null;
  followUpTime?: string | null;
  followUpTimezone?: string | null;
  doNotCall?: boolean;
  humanHandoffRequired?: boolean;

  /** Input variables actually sent to Sarvam, for audit. */
  inputVariables?: Record<string, unknown> | null;
  /** `final_agent_variables` / `output_agent_variables` exactly as received. */
  outputVariables?: Record<string, unknown> | null;
  /** When the interested-lead email went out, so a redelivered webhook cannot send it twice. */
  interestAlertSentAt?: string | null;
  /**
   * When this call was learned from, and a hash of exactly what was learned
   * from. A redelivered webhook with the same content is skipped outright; a
   * later webhook that adds a transcript or variables is learned from again.
   */
  memoryRecordedAt?: string | null;
  memoryFingerprint?: string | null;
}

// --- Transcript ---
export interface TranscriptTurn {
  role: "agent" | "user" | "system";
  text: string;
  startTime?: number | null;
  endTime?: number | null;
}

// --- Follow-Up ---
export interface FollowUp {
  id: string;
  leadId: string;
  /**
   * Owning business. Optional because rows written before tenancy existed have
   * none; those are read as belonging to the legacy tenant. See lib/auth/guard.
   */
  tenantId?: string | null;
  lead: Lead;
  previousResponse: string | null;
  interest: InterestLevel | null;
  /** Raw callback string Sarvam returned, kept for audit even when unparseable. */
  requestedCallback: string | null;
  /** ISO datetime, or null when Sarvam asked for a callback without a usable time. */
  scheduledTime: string | null;
  timezone: string | null;
  status: FollowUpStatus;
  nextAction: string | null;
  /** Where the follow-up came from: a real call outcome, or a manual entry. */
  source: "sarvam_call" | "manual";
  /** The call attempt that produced this follow-up. */
  attemptId?: string | null;
  callId?: string | null;

  // --- Autonomous execution ---
  /** How the requested time was understood, shown beside the raw wording. */
  interpretation?: string | null;
  /** How many times the scheduler has tried to place this callback. */
  executionAttempts?: number;
  /** Set while a worker holds this row, so two ticks cannot both dial. */
  lockedAt?: string | null;
  /** The call the scheduler placed for this follow-up. */
  executedCallId?: string | null;
  executedAttemptId?: string | null;
  executedAt?: string | null;
  /** Why the scheduler could not place the call, when it could not. */
  lastError?: string | null;
  /** When the follow-up was cancelled, and by whom. */
  cancelledAt?: string | null;
  cancelledBy?: "admin" | "dnd" | null;
  /** When a retry becomes eligible. Null when no retry is queued. */
  nextAttemptAt?: string | null;
  lastAttemptAt?: string | null;
  /** The provider interaction for the callback that was placed. */
  interactionId?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

// --- Agent Config ---
// The business context the voice agent speaks from. Everything here is
// per-tenant: no company, product or agent name is hardcoded anywhere in Tringlo.
export interface AgentConfig {
  companyName: string;
  industry: string;
  companyDescription: string;
  productName: string;
  productDescription: string;

  /** Who the product is for, in the business's own words. */
  targetAudience: string;
  /** What makes someone a good fit. Only what the business configured. */
  qualifyingCriteria: string;
  /**
   * What rules the lead out. Empty by default on purpose — an assumption like
   * "personal use is not a fit" must come from the business, never from Tringlo.
   */
  disqualifyingCriteria: string;
  /** Problems this product typically solves. */
  typicalPainPoints: string;

  /** The voice agent's name, used in the opening line and transcript labels. */
  agentName: string;
  /** How the agent should carry itself on the call. */
  agentPersona: string;
  productsServices: string;
  features: string;
  benefits: string;
  pricing: string;
  faqs: string;
  objectives: string;
  salesObjective: string;
  conversationGuidelines: string;
  optionalScript: string;
  tone: "professional" | "friendly" | "casual" | "formal";
  callDurationGuidance: string;
  // Behavioral & Speaking Prompt
  systemPrompt: string;
  // Voice settings
  voiceLanguage: string;
  voiceSpeaker: string;
}

// --- TTS Generation History ---
export interface TTSGeneration {
  id: string;
  text: string;
  languageCode: string;
  speaker: string;
  audioBase64: string;
  createdAt: string;
}

// --- Dashboard Stats ---
export interface DashboardStats {
  callsToday: number;
  totalCalls: number;
  interestedLeads: number;
  notInterestedLeads: number;
  followUps: number;
  interestRate: number;
  contactRate: number;
}

// --- CSV Validation ---
export interface CSVValidationError {
  row: number;
  field: string;
  message: string;
}

export interface CSVParseResult {
  valid: Lead[];
  errors: CSVValidationError[];
  totalRows: number;
}

// --- Calling Window ---
// When autonomous callbacks may be placed. A callback resolved outside this
// window is held rather than dialled, because the customer agreed to a time,
// not to being called at any hour.
export interface CallingWindow {
  /** 24h local time, e.g. "09:00". */
  from: string;
  to: string;
  /** IANA zone the window is expressed in. */
  timezone: string;
}

// --- Company Profile ---
export interface CompanyProfile {
  name: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  description: string;
}

// --- App Settings ---
// Sarvam credentials and the webhook URL are deliberately absent: they live in
// server environment variables and are never held or displayed client-side.
export interface AppSettings {
  businessName: string;
  contactEmail: string;
  phoneNumber: string;
  timezone: string;
  /** Retry attempts per lead, as a numeric string from the form input. */
  maxRetries: string;
  /** Minutes between retries. */
  retryDelay: string;
  callWindowFrom: string;
  callWindowTo: string;
  emailAlerts: boolean;
  smsAlerts: boolean;
  dailySummary: boolean;
}

// --- Tenancy & Identity ---
//
// Every business using Tringlo is a tenant. Leads, calls and follow-ups belong to
// exactly one tenant, and the API scopes every read and write to the tenant of
// the authenticated caller, so one business can never see another's customers.

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * A person who can sign in.
 *
 * `passwordHash` is a scrypt string from lib/auth/passwords. The plaintext is
 * never stored, never logged, and never returned by any API.
 */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "owner" | "member";
  createdAt: string;
  lastLoginAt: string | null;
  /** Set when repeated failed logins have locked the account until a moment. */
  lockedUntil: string | null;
  failedAttempts: number;
}

/**
 * One person's access to one workspace.
 *
 * The account is who you are; the workspace is whose data you are looking at.
 * Keeping them apart is what lets one email own several businesses without a
 * second account, and what makes "which workspace am I in" a server-side fact
 * rather than something the browser asserts.
 *
 * `User.tenantId` still records the workspace an account was created in. It is
 * no longer what grants access: a membership is.
 */
export interface WorkspaceMembership {
  id: string;
  userId: string;
  tenantId: string;
  role: "owner" | "admin" | "member";
  /** A revoked membership is kept, so losing access leaves a trace. */
  status: "active" | "revoked";
  createdAt: string;
  /** The user who granted it, or null when it came from the migration. */
  createdBy: string | null;
  lastAccessedAt: string | null;
}

/** What the client is allowed to know about the signed-in user. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member";
  tenantId: string;
  tenantName: string;
}

/**
 * A live sign-in.
 *
 * Only the SHA-256 of the session token is stored, so a stolen database cannot
 * be replayed as a valid session.
 */
export interface Session {
  id: string;
  tokenHash: string;
  userId: string;
  tenantId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  /** Coarse client label for the sessions list; never a full user-agent string. */
  client: string;
}

/** Outbound unless a record says otherwise — every record before inbound existed was outbound. */
export function callDirection(record: { direction?: "outbound" | "inbound" | null }): "outbound" | "inbound" {
  return record.direction === "inbound" ? "inbound" : "outbound";
}
