// ============================================================
// Sarvam Voice Agents — Variable Mapping
// ============================================================
//
// Two directions, kept strictly apart:
//
//   Tringlo -> Sarvam   input variables: who we are calling, on whose behalf, and
//                     the approved company knowledge the agent may speak from.
//   Sarvam -> Tringlo   output variables: what the agent learned on the call.
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
 * and no call is placed. So Tringlo sends only names the workspace's own agent
 * declares, listed on its provider configuration.
 *
 * There is no list that is right for every agent. A sales agent declares
 * product and pipeline fields; a hospital agent declares almost none of them.
 * So an unlisted workspace falls back to CORE_VARIABLES — the few an agent
 * needs to address a person at all — and never to another agent's schema.
 */
/**
 * Every name an agent might use for the person being called.
 *
 * All of them carry the same value, taken from the lead on this call in this
 * workspace. They are sent only when the app declares them — Sarvam refuses a
 * whole request over one undeclared variable — so an app that declares none of
 * these still works on `customer_name` alone.
 *
 * `userName` is on this list deliberately: it is the customer, not the agent.
 */
export const CUSTOMER_NAME_ALIASES = ["userName", "user_name", "customerName"] as const;

/**
 * The schema of the original outbound sales agent.
 *
 * Kept as a named preset an administrator can choose — it is what TenWeb and
 * the workspaces built alongside it declare — and written onto those
 * workspaces by migration, so they keep sending exactly what they send today.
 * It is no longer an implicit default: a healthcare agent is not a sales agent.
 */
export const SALES_AGENT_VARIABLES = [
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

/**
 * Memory variables Tringlo fills in when the app declares them.
 *
 * Everything they carry is also folded into `previous_interaction`, which the
 * app does declare, so an app without them loses nothing — which is why they
 * are dropped quietly rather than warned about on every call. Declare any of
 * them in the Sarvam app (and in SARVAM_AGENT_VARIABLES) to give the prompt
 * the individual fields.
 */
export const OPTIONAL_MEMORY_VARIABLES = [
  "customer_id",
  "customer_memory_context",
  "previous_interaction_summary",
  "last_call_summary",
  "previous_interest",
  "previous_objection",
  "previous_commitment",
  "previous_next_step",
  "follow_up_reason",
] as const;

/**
 * The variables the workspace's agent declares in Sarvam. Sarvam rejects
 * anything it has not declared, so Tringlo sends only these.
 *
 * Names are kept exactly as written: `customer_name`, `customerName` and
 * `userName` are three different variables, and Sarvam treats them so.
 *
 * An empty list means exactly that — no custom variables are sent. There is no
 * built-in list to fall back to, because there is no name every agent
 * declares: an agent for a hospital, a school or a recruiter declares whatever
 * its own prompt uses, and Tringlo refuses a whole call by guessing. The
 * number being dialled is a transport field and does not pass through here.
 */
export function declaredVariableNames(declared?: string[] | null): Set<string> {
  return new Set((declared ?? []).map((name) => name.trim()).filter(Boolean));
}

/** True when the workspace has told Tringlo what its agent declares. */
export function hasDeclaredVariables(declared?: string[] | null): boolean {
  return (declared ?? []).some((name) => name.trim());
}

/**
 * The candidate names that carry a workspace's BUSINESS identity and context —
 * who the agent works for and what it sells — as opposed to per-call facts
 * like the customer's name or the number being dialled.
 *
 * It is this set that decides whether an agent is told about its own business.
 * An agent that declares `customer_name` but none of these is handed who it is
 * calling and nothing about what it is calling to say, so it speaks entirely
 * from whatever prompt it was given on the provider's side.
 */
export const BUSINESS_CONTEXT_VARIABLES = [
  "company_name",
  "companyName",
  "seller_company_name",
  "product_name",
  "productCategory",
  "typicalCustomerPainPoints",
  "qualifyingSegments",
  "disqualifyingSignals",
  "industryVertical",
  "proposedNextStepDefault",
  "salesObjective",
  "sales_objective",
  "business_context",
  "companyDescription",
  "productDescription",
] as const;

export interface BusinessContextReach {
  /** Whether any business-context variable will actually reach the agent. */
  reaches: boolean;
  /** How the business context travels: declared names, a mapping, or nothing. */
  via: "declared" | "mapping" | "none";
  /** The business-context variable names this agent declares, if any. */
  declaredBusinessVariables: string[];
  /** Total variables this agent is configured to receive. */
  declaredCount: number;
  hasMappings: boolean;
}

/**
 * Whether a workspace's business information can reach its agent at all.
 *
 * This is the question behind "why does the agent talk about the wrong
 * business": if nothing carries the company and product across, the agent
 * runs on its own provider-side prompt and Tringlo's configuration never
 * touches it. The answer is read from the agent's declared variables and its
 * mappings — names and counts only, never a value — so it is safe to show and
 * safe to log.
 */
export function businessContextReach(
  declared?: string[] | null,
  mappings?: Array<{ name?: string }> | null
): BusinessContextReach {
  const names = declaredVariableNames(declared);
  const declaredBusinessVariables = BUSINESS_CONTEXT_VARIABLES.filter((name) => names.has(name));
  const mapped = (mappings ?? []).map((m) => (m.name ?? "").trim()).filter(Boolean);
  const hasMappings = mapped.length > 0;

  if (hasMappings) {
    return { reaches: true, via: "mapping", declaredBusinessVariables, declaredCount: names.size, hasMappings };
  }
  if (declaredBusinessVariables.length > 0) {
    return { reaches: true, via: "declared", declaredBusinessVariables, declaredCount: names.size, hasMappings };
  }
  return { reaches: false, via: "none", declaredBusinessVariables: [], declaredCount: names.size, hasMappings };
}

/**
 * The variable names Sarvam says the agent does not declare, read out of its
 * 422. The message names them:
 *
 *   Agent variables '{'productCategory', 'lead_notes'}' not found in agent
 *   variables of app 'Amrita---We-4517816a-a47a'
 *
 * Reading them turns a provider rejection into a list an administrator can act
 * on. Only names are taken — never a value, and never the message wholesale.
 */
export function undeclaredVariablesFrom(message: unknown): string[] {
  const text = typeof message === "string" ? message : "";
  const section = /agent variables\s*'?\{([^}]*)\}'?\s*not found/i.exec(text);
  if (!section) return [];
  const names = section[1].match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return [...new Set(names)];
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
  // The name the person gave during the call, when it differs from what
  // we had. An output, so it is never sent outbound.
  "stated_customer_name",
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
  /** The variables the workspace's agent declares; empty means the core few. */
  declaredVariables?: string[] | null;
}

/**
 * Drops empty values, so the agent sees an absent variable rather than a blank
 * one, and drops names the Sarvam app has not declared, which would otherwise
 * make the whole request fail.
 */
function compact(variables: SarvamAgentVariables, declared: Set<string>): SarvamAgentVariables {
  const result: SarvamAgentVariables = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    // An empty value is normally not worth sending. A name is the exception:
    // omitting it leaves whatever default the Sarvam agent carries, and those
    // defaults are demo names, so "unknown" has to be said out loud.
    const isName = key === "customer_name" || (CUSTOMER_NAME_ALIASES as readonly string[]).includes(key);
    if (typeof value === "string" && value.trim() === "" && !isName) continue;
    if (!declared.has(key)) {
      if (!(OPTIONAL_MEMORY_VARIABLES as readonly string[]).includes(key)) dropped.push(key);
      continue;
    }
    result[key] = value;
  }

  // Nothing declared is a configuration, not a fault: the agent takes no
  // custom variables, and listing what was not sent would be noise on every
  // call. Only a partial list is worth reporting.
  if (dropped.length > 0 && declared.size > 0) {
    console.warn(
      `[Sarvam] Not sending ${dropped.join(", ")} — this workspace's agent does not declare them. Declare them on the Sarvam agent and add them to the workspace's agent variables to pass them through.`
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
    declaredVariables,
  } = params;

  const context = buildBusinessContext(agentConfig);
  const declared = declaredVariableNames(declaredVariables);

  const leadNotes = [
    lead.company?.trim() ? `Works at ${lead.company.trim()}.` : "",
    lead.notes?.trim() || "",
  ]
    .filter(Boolean)
    .join(" ");

  const mapped = mapContextToVariables(context, declared, leadNotes);

  // One authoritative customer name, sent on every alias the app declares.
  //
  // An alias left unsent keeps whatever default the Sarvam agent carries, and
  // those defaults are demo names: on 9 October 2026 an agent addressed a
  // customer as "Manan" from its own `user_name` default while Tringlo had
  // correctly sent `customer_name: "Pratik"`. An unknown name stays empty —
  // never a sample name, and never inferred from the phone number.
  const customerName = lead.name?.trim() || "";
  const customerNameAliases = Object.fromEntries(
    CUSTOMER_NAME_ALIASES.filter((alias) => declared.has(alias)).map((alias) => [alias, customerName])
  );

  // Candidate values, every one of them offered rather than imposed: `compact`
  // keeps only the names this agent actually declares, so an agent that
  // declares none of them receives none of them.
  //
  // The number being dialled is deliberately absent as a value of its own: it
  // travels in the provider's `user_config.user_phone_number`. It appears here
  // only because some agents also declare a `phone_number` variable their own
  // prompt reads from, and then only if they declare it.
  const variables: SarvamAgentVariables = {
    // --- Who is being called, on whichever names this agent uses ---
    customer_name: customerName,
    ...customerNameAliases,
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
    variables: compact(variables, declared),
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
 * Checks the values that are actually about to be sent.
 *
 * This used to demand customer_name, company_name and phone_number of every
 * call, which was Tringlo's own requirement rather than any provider's: an
 * agent that declares none of them was refused a call it would have handled
 * perfectly well. What is left is the one check that protects a customer on
 * the line — an unsubstituted placeholder like `<customer_name>`, which would
 * otherwise be read out loud.
 *
 * Whether a particular variable is required is a question about one agent's
 * configuration, and is answered by `missingRequiredMappings`.
 */
export function validateOutgoingVariables(variables: SarvamAgentVariables): VariableValidation {
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === "string" && /^<.*>$/.test(value.trim())) {
      return {
        valid: false,
        missing: [name],
        error: `Unsubstituted template placeholder "${value}" would be spoken to the customer.`,
      };
    }
  }
  return { valid: true, missing: [] };
}
