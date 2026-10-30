// ============================================================
// Tringlo AI — What an inbound call was about, as the agent reported it
// ============================================================
//
// Read from the agent's output variables only. When the agent did not report
// a reason or a resolution, the answer is null — never a guess. The inbound
// agent in Sarvam should declare these output variables:
//
//   call_reason        one of INBOUND_INTENTS (or close to it)
//   resolution_status  resolved | escalated | unresolved
//
// Common alternative names are accepted so an agent built slightly
// differently still reports correctly.
// ============================================================

import { INBOUND_INTENTS, type ResolutionStatus } from "./types";

/** Where the inbound agent records a caller's name. Deliberately not
 *  customer_name: that is an input, and on an unknown caller it can carry the
 *  agent's demo default back out. */
const CALLER_NAME_KEYS = ["caller_name", "callers_name", "caller_full_name"];

/** The name an unknown caller gave the agent, raw (checked by the caller). */
export function inboundCallerName(vars: Record<string, unknown> | null | undefined): string | null {
  if (!vars) return null;
  for (const key of CALLER_NAME_KEYS) {
    const value = vars[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

const REASON_KEYS = ["call_reason", "reason_for_call", "inbound_intent", "intent", "query_category", "call_category"];
const RESOLUTION_KEYS = ["resolution_status", "resolution", "issue_resolved", "resolved"];

const ALIASES: Record<string, string> = {
  product: "product_question",
  product_info: "product_question",
  product_information: "product_question",
  sales: "sales_enquiry",
  sales_inquiry: "sales_enquiry",
  enquiry: "sales_enquiry",
  price: "pricing",
  order: "order_support",
  order_status: "order_support",
  support: "order_support",
  account: "account_help",
  technical: "technical_issue",
  tech_support: "technical_issue",
  payment: "billing",
  refund: "billing",
  callback: "callback_request",
  human: "human_request",
  agent_request: "human_request",
  speak_to_human: "human_request",
};

function first(vars: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!vars) return null;
  for (const key of keys) {
    const value = vars[key];
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "string" && value.trim() && !/^(na|n\/a|none|null|unknown|-)$/i.test(value.trim())) return value.trim();
  }
  return null;
}

/** The reason, normalised to a known category when it is one; null when unreported. */
export function inboundIntent(vars: Record<string, unknown> | null | undefined): string | null {
  const raw = first(vars, REASON_KEYS);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s/-]+/g, "_").replace(/[^a-z_]/g, "");
  if ((INBOUND_INTENTS as readonly string[]).includes(key)) return key;
  if (ALIASES[key]) return ALIASES[key];
  // The agent's own label, kept as reported — not forced into a category.
  return raw.slice(0, 60);
}

export function inboundResolution(vars: Record<string, unknown> | null | undefined): ResolutionStatus | null {
  const raw = first(vars, RESOLUTION_KEYS)?.toLowerCase();
  if (!raw) return null;
  if (["resolved", "true", "yes", "solved", "answered"].includes(raw)) return "resolved";
  if (["escalated", "transferred", "handoff", "human_handoff"].includes(raw)) return "escalated";
  if (["unresolved", "false", "no", "open", "pending"].includes(raw)) return "unresolved";
  return null;
}
