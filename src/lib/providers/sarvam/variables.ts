// ============================================================
// Sarvam Voice Agents — Variable Mapping
// ============================================================
//
// Two directions, kept strictly apart:
//
//   Dialo -> Sarvam   input variables: who we are calling, on whose behalf, and
//                     the approved company knowledge the agent may speak from.
//   Sarvam -> Dialo   output variables: what the agent learned on the call.
//                     Parsed in webhooks.ts, never seeded here.
//
// Seeding an output variable on the way out would make a pre-filled value
// indistinguishable from a real result on the way back, so this module strips
// every known output key before the payload leaves.
// ============================================================

import type { AgentConfig, Lead } from "@/lib/types";
import type { SarvamAgentVariables } from "./types";
import {
  buildBusinessContext,
  mapContextToVariables,
  missingContextFields,
  type BusinessContext,
} from "./context";

/**
 * The agent variables the configured Sarvam app declares.
 *
 * Sarvam validates this strictly: sending a name the app does not declare fails
 * the whole request with
 *   422 Invalid Parameter — Agent variables '{'x'}' not found in agent variables of app '...'
 * and no call is placed. So Dialo sends only names on this list and drops the rest
 * rather than letting one unknown field block a real call.
 *
 * Override with SARVAM_AGENT_VARIABLES (comma separated) after declaring the new
 * fields in the Sarvam app, so the two stay in step.
 */
const DEFAULT_DECLARED_VARIABLES = [
  "customer_name",
  "phone_number",
  "company_name",
  "companyName",
  "seller_company_name",
  "product_name",
  "campaign_name",
  "campaignId",
  "lead_notes",
  "previous_interaction",
  "priorTouchpointSummary",
  "industryVertical",
  "role",
  "companySize",
  "productCategory",
  "typicalCustomerPainPoints",
  "qualifyingSegments",
  "disqualifyingSignals",
  "proposedNextStepDefault",
  "preferredCallbackWindow",
  "smeAvailableForFollowup",
  "customerCareNumber",
  "dndRegistrationLine",
  "salesRepName",
  "salesRepPhone",
  "partnerName",
  "userName",
  "gender",
  "crmDealStage",
  "crm_stage",
] as const;

export function declaredVariableNames(): Set<string> {
  const configured = process.env.SARVAM_AGENT_VARIABLES?.trim();
  if (configured) {
    return new Set(
      configured
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    );
  }
  return new Set<string>(DEFAULT_DECLARED_VARIABLES);
}

/** Internal routing values. Present for workflow logic, not for the agent to say. */
export const INTERNAL_VARIABLE_KEYS = ["campaignId", "crmDealStage", "crm_stage"] as const;

/**
 * Variables the Voice Agent populates. Never send these.
 * This list is the guard: anything named here is deleted from the outbound payload.
 */
export const CONVERSATION_OUTPUT_KEYS = [
  "call_outcome",
  "call_disposition",
  "disposition",
  "call_summary",
  "summary",
  "pain_points",
  "pain_points_mentioned",
  "current_state_of_solving",
  "customer_requirement",
  "competitor_mentioned",
  "success_metrics",
  "decision_process",
  "authority_level",
  "budget_indication",
  "timeline_to_decide",
  "objection",
  "rejection_reason",
  "interest_level",
  "interest_confidence",
  "follow_up_required",
  "follow_up_date",
  "follow_up_time",
  "follow_up_timezone",
  "next_action",
  "next_step_date_time",
  "chosen_next_step",
  "human_handoff_required",
  "do_not_call",
  "alt_contact_number",
  "discovery_fit_score_estimate",
] as const;

export interface BuildAgentVariablesParams {
  lead: Partial<Lead>;
  agentConfig?: Partial<AgentConfig>;
  normalizedPhone: string;
  /** The seller's company — dynamic per tenant, never hardcoded. */
  companyName: string;
  productName?: string;
  campaignName?: string;
  campaignId?: string;
  /** Approved company/product knowledge retrieved by the scoped RAG index. */
  ragContext?: string;
  previousInteraction?: string;
  customVariables?: Record<string, unknown>;
}

/**
 * Drops empty values, so the agent sees an absent variable rather than a blank
 * one, and drops names the Sarvam app has not declared, which would otherwise
 * make the whole request fail.
 */
function compact(variables: SarvamAgentVariables): SarvamAgentVariables {
  const declared = declaredVariableNames();
  const result: SarvamAgentVariables = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (!declared.has(key)) {
      dropped.push(key);
      continue;
    }
    result[key] = value;
  }

  if (dropped.length > 0) {
    console.warn(
      `[Sarvam] Not sending ${dropped.join(", ")} — the app does not declare these agent variables. Declare them in the Sarvam app and list them in SARVAM_AGENT_VARIABLES to pass them through.`
    );
  }

  return result;
}

export interface BuiltAgentVariables {
  variables: SarvamAgentVariables;
  context: BusinessContext;
  /** Required context fields the business has not filled in yet. */
  missingContext: string[];
  /** Preferred variable names the Sarvam app does not declare. */
  usingFallbackFor: string[];
  unroutable: string[];
}

/**
 * Builds the `agent_variables` bag for an outbound trigger request.
 *
 * Identity and lead fields are mapped directly. The business context — what the
 * company is, what the product does, who it is for, what counts as a fit — is
 * routed through `context.ts`, which knows which names the app will accept.
 */
export function buildSarvamAgentVariables(
  params: BuildAgentVariablesParams
): BuiltAgentVariables {
  const {
    lead,
    agentConfig,
    normalizedPhone,
    companyName,
    productName = "",
    campaignName = "",
    campaignId = "",
    previousInteraction = "",
    customVariables = {},
  } = params;

  const context = buildBusinessContext(agentConfig);
  const declared = declaredVariableNames();

  const leadNotes = [
    lead.company?.trim() ? `Works at ${lead.company.trim()}.` : "",
    lead.notes?.trim() || "",
  ]
    .filter(Boolean)
    .join(" ");

  const mapped = mapContextToVariables(context, declared, leadNotes);

  const variables: SarvamAgentVariables = {
    // --- Identity ---
    customer_name: lead.name?.trim() || "",
    phone_number: normalizedPhone,
    company_name: companyName.trim(),
    companyName: companyName.trim(),
    seller_company_name: companyName.trim(),
    product_name: productName.trim() || context.productName,

    // --- Campaign & prior contact ---
    campaign_name: campaignName.trim(),
    campaignId: campaignId || lead.campaign || "",
    previous_interaction: previousInteraction.trim(),
    priorTouchpointSummary: previousInteraction.trim() || leadNotes,

    // --- Business context, on whichever names the app accepts ---
    ...mapped.variables,

    ...customVariables,
  };

  // Guard: an output variable must never travel outbound.
  for (const key of CONVERSATION_OUTPUT_KEYS) {
    delete variables[key];
  }

  return {
    variables: compact(variables),
    context,
    missingContext: missingContextFields(context),
    usingFallbackFor: mapped.usingFallbackFor,
    unroutable: mapped.unroutable,
  };
}

export interface VariableValidation {
  valid: boolean;
  missing: string[];
  error?: string;
}

/**
 * Checks the variables without which the agent cannot run a coherent call.
 * Also rejects unsubstituted template placeholders such as `<customer_name>`,
 * which otherwise reach the customer as spoken text.
 */
export function validateRequiredSarvamVariables(params: {
  customerName?: string;
  companyName?: string;
  productName?: string;
  phoneNumber?: string;
}): VariableValidation {
  const missing: string[] = [];
  if (!params.customerName?.trim()) missing.push("customer_name");
  if (!params.companyName?.trim()) missing.push("company_name");
  if (!params.phoneNumber?.trim()) missing.push("phone_number");

  if (missing.length > 0) {
    return {
      valid: false,
      missing,
      error: `Required Sarvam agent variable(s) missing: ${missing.join(", ")}`,
    };
  }

  const placeholder = [
    params.customerName,
    params.companyName,
    params.productName,
    params.phoneNumber,
  ].find((value) => typeof value === "string" && /^<.*>$/.test(value.trim()));

  if (placeholder) {
    return {
      valid: false,
      missing: ["literal_placeholder"],
      error: `Unsubstituted template placeholder "${placeholder}" would be spoken to the customer.`,
    };
  }

  return { valid: true, missing: [] };
}
