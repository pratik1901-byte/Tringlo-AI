// ============================================================
// Sarvam Voice Agents — Business Context Mapping
// ============================================================
//
// Turns the Agent Configuration saved on the Dialo website into the agent
// variables Sarvam will actually accept.
//
// The problem this solves: the agent used to receive `product_name` and nothing
// describing it. Told only "KhushiBot", the model filled the gap itself — asking
// whether it was for business or personal use and then asserting it was
// business-only, contradicting a product configured as a children's learning
// companion. An agent that is not told what it is selling will invent it.
//
// Sarvam validates agent_variables against the names the app declares and
// rejects the whole request if it sees an unknown one. At the time of writing the
// configured app declares none of `company_description`, `product_description`,
// `sales_objectives`, `industry`, `agent_persona`, `agent_name`, `faqs` or
// `customer_segment`. So each piece of context has a preferred variable and a
// fallback carrier that the app does declare. Declared input variable values are
// placed in the model's context either way, so the fallback still informs the
// agent; it is just less tidy.
//
// Declare the preferred names in the Sarvam app and list them in
// SARVAM_AGENT_VARIABLES, and this module switches to them automatically.
// ============================================================

import type { AgentConfig } from "@/lib/types";

export interface BusinessContext {
  companyName: string;
  companyDescription: string;
  industry: string;
  productName: string;
  productDescription: string;
  salesObjective: string;
  targetAudience: string;
  qualifyingCriteria: string;
  disqualifyingCriteria: string;
  painPoints: string;
  agentName: string;
  agentPersona: string;
  faqs: FaqEntry[];
}

export interface FaqEntry {
  question: string;
  answer: string;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parses the "Q: ... / A: ..." block the agent form stores.
 * Malformed entries are skipped rather than guessed at.
 */
export function parseFaqs(raw: string): FaqEntry[] {
  const entries: FaqEntry[] = [];
  let question = "";
  let answer = "";

  const push = () => {
    if (question && answer) entries.push({ question, answer });
    question = "";
    answer = "";
  };

  for (const line of clean(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^q\s*:/i.test(trimmed)) {
      push();
      question = trimmed.replace(/^q\s*:/i, "").trim();
    } else if (/^a\s*:/i.test(trimmed)) {
      answer = trimmed.replace(/^a\s*:/i, "").trim();
    } else if (answer && trimmed) {
      answer += ` ${trimmed}`;
    }
  }
  push();

  return entries;
}

/**
 * Reads the website configuration into a normalised shape.
 *
 * `objectives` and `salesObjective` are both accepted because the form has
 * historically written the first while the mapper read the second, which meant
 * the sales objective never reached a call.
 */
export function buildBusinessContext(config?: Partial<AgentConfig>): BusinessContext {
  return {
    companyName: clean(config?.companyName),
    companyDescription: clean(config?.companyDescription),
    industry: clean(config?.industry),
    productName: clean(config?.productName) || clean(config?.productsServices),
    productDescription:
      clean(config?.productDescription) ||
      [clean(config?.features), clean(config?.benefits)].filter(Boolean).join(" "),
    salesObjective: clean(config?.salesObjective) || clean(config?.objectives),
    targetAudience: clean(config?.targetAudience),
    qualifyingCriteria: clean(config?.qualifyingCriteria),
    disqualifyingCriteria: clean(config?.disqualifyingCriteria),
    painPoints: clean(config?.typicalPainPoints),
    agentName: clean(config?.agentName),
    agentPersona: clean(config?.agentPersona) || clean(config?.systemPrompt),
    faqs: parseFaqs(clean(config?.faqs)),
  };
}

/** The context fields a call needs before the agent can speak credibly about the product. */
export const REQUIRED_CONTEXT_FIELDS = [
  "companyName",
  "companyDescription",
  "productName",
  "productDescription",
  "salesObjective",
] as const;

export type RequiredContextField = (typeof REQUIRED_CONTEXT_FIELDS)[number];

/**
 * Reports which context fields are populated, as booleans only.
 *
 * Logged before every call so an agent that improvised can be traced to the
 * field that was empty — without putting customer or company text in the logs.
 */
export function contextPresence(context: BusinessContext): Record<RequiredContextField, boolean> {
  return {
    companyName: context.companyName.length > 0,
    companyDescription: context.companyDescription.length > 0,
    productName: context.productName.length > 0,
    productDescription: context.productDescription.length > 0,
    salesObjective: context.salesObjective.length > 0,
  };
}

export function missingContextFields(context: BusinessContext): RequiredContextField[] {
  const presence = contextPresence(context);
  return REQUIRED_CONTEXT_FIELDS.filter((field) => !presence[field]);
}

// ------------------------------------------------------------
// Mapping to agent variables
// ------------------------------------------------------------

/**
 * Where each piece of context goes.
 *
 * `preferred` is the variable name that describes the value honestly. `fallback`
 * is a name the current app declares, used until the preferred one exists.
 */
interface ContextRoute {
  preferred: string;
  fallback: string | null;
  value: (context: BusinessContext) => string;
}

const ROUTES: ContextRoute[] = [
  {
    preferred: "industry",
    fallback: "industryVertical",
    value: (c) => c.industry,
  },
  {
    preferred: "sales_objectives",
    fallback: "proposedNextStepDefault",
    value: (c) => c.salesObjective,
  },
  {
    // The product description is the single most important value here, so it
    // rides on the closest declared product field rather than being dropped.
    preferred: "product_description",
    fallback: "productCategory",
    value: (c) =>
      c.productDescription && c.productName
        ? `${c.productName}: ${c.productDescription}`
        : c.productDescription || c.productName,
  },
  {
    // Who the product is for, as configured. Left empty when the business has
    // not said, rather than assuming a segment.
    preferred: "customer_segment",
    fallback: "qualifyingSegments",
    value: (c) => [c.targetAudience, c.qualifyingCriteria].filter(Boolean).join(" "),
  },
  {
    // Only rules the business actually configured. Nothing is inferred here —
    // this is where an assumption like "personal use is not a fit" would come
    // from, and it must come from the customer, not from Dialo.
    preferred: "disqualifying_criteria",
    fallback: "disqualifyingSignals",
    value: (c) => c.disqualifyingCriteria,
  },
  {
    preferred: "typical_pain_points",
    fallback: "typicalCustomerPainPoints",
    value: (c) => c.painPoints,
  },
  {
    preferred: "agent_persona",
    fallback: null,
    value: (c) => c.agentPersona,
  },
  {
    preferred: "company_description",
    fallback: null,
    value: (c) => c.companyDescription,
  },
];

const FAQ_LIMIT = 6;

/**
 * A compact brief covering everything the agent must not get wrong.
 *
 * Sections are labelled so the model reads it as business context rather than as
 * notes about the person being called, and it carries an explicit instruction
 * not to contradict or extend the description — the specific failure that
 * produced the "business use only" claim.
 */
export function buildContextBrief(context: BusinessContext, leadNotes: string): string {
  const sections: string[] = [];

  if (context.companyName) {
    sections.push(
      `ABOUT ${context.companyName.toUpperCase()}: ${
        context.companyDescription || "No company description configured."
      }`
    );
  }

  if (context.productName) {
    sections.push(
      `WHAT ${context.productName.toUpperCase()} IS: ${
        context.productDescription ||
        "No product description configured. Do not describe what it does — offer to have a colleague follow up."
      }`
    );
  }

  if (context.targetAudience) {
    sections.push(`WHO IT IS FOR: ${context.targetAudience}`);
  }

  if (context.qualifyingCriteria) {
    sections.push(`A GOOD FIT IS: ${context.qualifyingCriteria}`);
  }

  if (context.disqualifyingCriteria) {
    sections.push(`NOT A FIT IF: ${context.disqualifyingCriteria}`);
  }

  if (context.salesObjective) {
    sections.push(`GOAL OF THIS CALL: ${context.salesObjective}`);
  }

  if (context.faqs.length > 0) {
    const faqs = context.faqs
      .slice(0, FAQ_LIMIT)
      .map((faq) => `- ${faq.question} ${faq.answer}`)
      .join("\n");
    sections.push(`ANSWERS YOU MAY GIVE:\n${faqs}`);
  }

  sections.push(
    "USING THIS: the description above is the truth about the product. Do not contradict it, " +
      "narrow it, or add uses and restrictions it does not state. If the customer asks something " +
      "it does not cover, say you will have a colleague confirm rather than guessing."
  );

  if (leadNotes) {
    sections.push(`ABOUT THIS PERSON: ${leadNotes}`);
  }

  return sections.join("\n\n");
}

export interface MappedContext {
  variables: Record<string, string>;
  /** Preferred names the app has not declared, so context took a fallback route. */
  usingFallbackFor: string[];
  /** Context that could not be routed at all, because it has no declared carrier. */
  unroutable: string[];
}

/**
 * Routes the business context onto variable names the app will accept.
 */
export function mapContextToVariables(
  context: BusinessContext,
  declared: Set<string>,
  leadNotes: string
): MappedContext {
  const variables: Record<string, string> = {};
  const usingFallbackFor: string[] = [];
  const unroutable: string[] = [];

  for (const route of ROUTES) {
    const value = route.value(context);
    if (!value) continue;

    if (declared.has(route.preferred)) {
      variables[route.preferred] = value;
    } else if (route.fallback && declared.has(route.fallback)) {
      variables[route.fallback] = value;
      usingFallbackFor.push(route.preferred);
    } else {
      unroutable.push(route.preferred);
    }
  }

  // The brief repeats the same facts in prose. It is what reaches the model when
  // the preferred variables do not exist, and it is where the FAQs and the
  // do-not-contradict instruction live.
  const brief = buildContextBrief(context, leadNotes);
  if (declared.has("business_context")) {
    variables.business_context = brief;
  } else if (declared.has("lead_notes")) {
    variables.lead_notes = brief;
  } else {
    unroutable.push("business_context");
  }

  if (context.agentName) {
    if (declared.has("agent_name")) variables.agent_name = context.agentName;
    else if (declared.has("userName")) variables.userName = context.agentName;
  }

  return { variables, usingFallbackFor, unroutable };
}
