// ============================================================
// Sarvam Voice Agents — Type Definitions
// ============================================================
// Shapes here mirror the Sarvam Instant Outbound API and its
// completion webhook exactly. Optionality is deliberate: every
// conversation-derived field is absent until the call connects.
// ============================================================

/** Values Sarvam sends in the webhook `status` / `connectivity_status` fields. */
export type SarvamCallStatus =
  | "connected"
  | "no_answer"
  | "busy"
  | "failed"
  | "cancelled";

export interface SarvamConnectionConfig {
  connection_id?: string;
  agent_phone_number?: string;
}

/**
 * Variables handed to the Sarvam Voice Agent runtime.
 *
 * Only INPUT variables belong in an outbound trigger request. Output variables
 * (call_summary, interest_level, ...) are produced BY the agent and must never be
 * seeded — a seeded output variable is indistinguishable from a real result.
 */
export interface SarvamAgentVariables {
  // --- Core identity ---
  customer_name?: string;
  phone_number?: string;
  company_name?: string;
  product_name?: string;

  // --- Aliases some agent prompts use ---
  companyName?: string;
  seller_company_name?: string;

  // --- Campaign & lead context ---
  campaign_name?: string;
  campaignId?: string;
  lead_notes?: string;
  previous_interaction?: string;
  priorTouchpointSummary?: string;
  lead_company?: string;

  // --- Profiling ---
  industryVertical?: string;
  role?: string;
  companySize?: string;
  productCategory?: string;

  // --- Approved company/product knowledge (RAG) ---
  approved_knowledge?: string;
  product_description?: string;
  pricing_information?: string;
  faqs?: string;

  // --- Operational context ---
  customerCareNumber?: string;
  dndRegistrationLine?: string;
  salesRepName?: string;
  salesRepPhone?: string;
  proposedNextStepDefault?: string;
  preferredCallbackWindow?: string;

  // --- Internal / workflow (never spoken) ---
  crmDealStage?: string;
  crm_stage?: string;

  [key: string]: unknown;
}

export interface SarvamAppOverrides {
  initial_bot_message?: string;
  initial_state_name?: string;
}

export interface SarvamAppConfig {
  app_id: string;
  app_version?: number;
  app_type?: string;
  connection_config?: SarvamConnectionConfig;
  agent_variables?: SarvamAgentVariables;
  app_overrides?: SarvamAppOverrides;
}

export interface SarvamUserConfig {
  user_phone_number: string;
}

/** Echoed back verbatim on the webhook as `webhook_config.metadata`. */
export interface SarvamWebhookMetadata {
  lead_id: string;
  callId: string;
  /** The Tringlo workspace the call belongs to. Tracing only, never routing. */
  workspace_id?: string;
  company_id?: string;
  agent_id?: string;
}

export interface SarvamWebhookConfig {
  url: string;
  metadata?: SarvamWebhookMetadata;
}

/**
 * POST /api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds
 */
export interface SarvamOutboundPayload {
  app_config: SarvamAppConfig;
  user_config: SarvamUserConfig;
  webhook_config?: SarvamWebhookConfig;
}

export interface SarvamOutboundResponse {
  attempt_id: string;
  status?: string;
  message?: string;
  rawResponse?: unknown;
}

/**
 * Output variables the Voice Agent fills in during the call. Values arrive as
 * strings even when they are conceptually booleans or numbers, so every consumer
 * must coerce defensively rather than trusting the declared type.
 */
export interface SarvamOutputVariables {
  call_outcome?: string;
  call_disposition?: string;
  disposition?: string;
  call_summary?: string;
  summary?: string;
  interest_level?: string;
  interest_confidence?: number | string;
  pain_points?: string;
  pain_points_mentioned?: string;
  current_state_of_solving?: string;
  customer_requirement?: string | string[];
  competitor_mentioned?: string;
  success_metrics?: string;
  decision_process?: string;
  authority_level?: string;
  budget_indication?: string;
  timeline_to_decide?: string;
  objection?: string;
  rejection_reason?: string;
  discovery_fit_score_estimate?: string | number;
  next_action?: string;
  chosen_next_step?: string;
  next_step_date_time?: string;
  follow_up_required?: boolean | string;
  follow_up_date?: string;
  follow_up_time?: string;
  follow_up_timezone?: string;
  human_handoff_required?: boolean | string;
  do_not_call?: boolean | string;
  alt_contact_number?: string;
  [key: string]: unknown;
}

export interface SarvamTranscriptTurn {
  role?: string;
  text?: string;
  en_text?: string;
  start_time?: number;
  end_time?: number;
}

export interface SarvamChannelInfo {
  channel_type?: string;
  channel_provider?: string;
  agent_phone_number?: string;
  to_number?: string;
}

/** Completion webhook delivered by Sarvam once the attempt reaches a terminal state. */
export interface SarvamWebhookPayload {
  attempt_id: string;
  app_id?: string;
  app_version?: number;
  status?: string;
  connectivity_status?: string;
  completion_status?: string;
  channel_info?: SarvamChannelInfo;
  duration?: number | null;
  interaction_id?: string | null;
  failure_reason?: string | null;
  recording_url?: string | null;
  user_phone_number?: string;
  agent_phone_number?: string;
  retry_attempt?: number;
  start_datetime?: string | null;
  end_datetime?: string | null;
  final_agent_variables?: SarvamOutputVariables | null;
  output_agent_variables?: SarvamOutputVariables | null;
  interaction_transcript?: SarvamTranscriptTurn[] | null;
  metadata?: Record<string, unknown>;
  webhook_config?: { metadata?: Record<string, unknown> };

  // --- Inbound deployment completions only ---
  deployment_id?: string;

  // --- Campaign attempts only ---
  campaign_id?: string;
  cohort_id?: string;
  /** The Tringlo lead id, sent as user_identifier with the cohort. */
  user_identifier?: string;
  /** `retry`, `short_duration_retry`, … or null when this attempt was final. */
  next_action_status?: string | null;
  executed_at?: string | null;
  initial_agent_variables?: Record<string, unknown> | null;
}

export interface SarvamConfigStatus {
  status:
    | "ready"
    | "missing_api_key"
    | "missing_agent"
    | "missing_workspace"
    | "missing_telephony"
    | "missing_phone_number"
    | "missing_public_url"
    | "provider_error";
  details: string;
  hasApiKey: boolean;
  hasOrgId: boolean;
  hasWorkspaceId: boolean;
  hasAgentId: boolean;
  hasConnectionId: boolean;
  hasPhoneNumber: boolean;
  hasPublicUrl: boolean;
  missing: string[];
}
