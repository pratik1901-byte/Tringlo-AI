// ============================================================
// Tringlo AI — Agent variable mapping
// ============================================================
//
// What a voice agent is told, decided per agent rather than per industry.
//
// An agent declares whatever variables its own prompt reads. One hospital
// agent declares `patient_name` and `appointment_date`; a recruiter's declares
// `candidate_name` and `interview_time`; the sales agent Tringlo started with
// declares thirty. None of those names is special, and none is built in here.
//
// A mapping says three things, and nothing about what the agent is for:
//
//   name      the variable, spelled exactly as the agent declares it
//   source    where its value comes from — a field Tringlo holds, or a literal
//   required  whether a call should be refused when the value is missing
//
// The sources below describe the data Tringlo has, not what it means to a
// business: `lead.name` is the name of the person being called, whether the
// agent calls that a patient, a candidate or a customer. Adding an agent for a
// new industry is a mapping, not a code change.
// ============================================================

/** Where a mapped value comes from. `literal` uses the mapping's own value. */
export const VARIABLE_SOURCES = [
  "lead.name",
  "lead.phone",
  "lead.email",
  "lead.company",
  "lead.notes",
  "workspace.name",
  "workspace.company",
  "workspace.product",
  "workspace.industry",
  "call.campaignName",
  "call.previousInteraction",
  "literal",
] as const;

export type VariableSource = (typeof VARIABLE_SOURCES)[number] | `csv.${string}`;

export interface AgentVariableMapping {
  /** Exactly as the agent declares it. Never case-converted. */
  name: string;
  /** Which value fills it. A `csv.<column>` source reads a campaign sheet. */
  source: VariableSource;
  /** Used by `literal`, and as the value when the source yields nothing. */
  value?: string;
  /** When true, a call is refused — naming this mapping — rather than placed without it. */
  required?: boolean;
}

/** Everything a mapping may draw on. All of it optional: a field Tringlo has not got is absent. */
export interface VariableContext {
  lead?: { name?: string | null; phone?: string | null; email?: string | null; company?: string | null; notes?: string | null };
  workspace?: { name?: string | null; company?: string | null; product?: string | null; industry?: string | null };
  call?: { campaignName?: string | null; previousInteraction?: string | null };
  /** One campaign sheet row, by column name, for `csv.<column>` sources. */
  row?: Record<string, string>;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The value a source yields, or an empty string when Tringlo has not got it. */
export function readSource(source: string, context: VariableContext): string {
  if (source.startsWith("csv.")) return clean(context.row?.[source.slice(4)]);

  switch (source) {
    case "lead.name": return clean(context.lead?.name);
    case "lead.phone": return clean(context.lead?.phone);
    case "lead.email": return clean(context.lead?.email);
    case "lead.company": return clean(context.lead?.company);
    case "lead.notes": return clean(context.lead?.notes);
    case "workspace.name": return clean(context.workspace?.name);
    case "workspace.company": return clean(context.workspace?.company);
    case "workspace.product": return clean(context.workspace?.product);
    case "workspace.industry": return clean(context.workspace?.industry);
    case "call.campaignName": return clean(context.call?.campaignName);
    case "call.previousInteraction": return clean(context.call?.previousInteraction);
    default: return "";
  }
}

export interface ResolvedMappings {
  /** Ready to send, under the exact names the agent declares. */
  variables: Record<string, string>;
  /** Required mappings with nothing to put in them. */
  missingRequired: string[];
  /** Optional mappings left out because there was no value. */
  omitted: string[];
}

/**
 * Turns an agent's mappings into the variables for one call.
 *
 * A mapping with no value and no default is left out rather than sent empty:
 * an absent variable lets the agent's own default stand, while an empty one
 * overwrites it. A required mapping with nothing to put in it is reported, so
 * the caller can refuse the call before the provider does.
 */
export function resolveMappings(
  mappings: AgentVariableMapping[] | null | undefined,
  context: VariableContext
): ResolvedMappings {
  const variables: Record<string, string> = {};
  const missingRequired: string[] = [];
  const omitted: string[] = [];

  for (const mapping of mappings ?? []) {
    const name = clean(mapping.name);
    if (!name) continue;

    const fromSource = mapping.source === "literal" ? "" : readSource(mapping.source, context);
    const value = fromSource || clean(mapping.value);

    if (!value) {
      if (mapping.required) missingRequired.push(name);
      else omitted.push(name);
      continue;
    }
    variables[name] = value;
  }

  return { variables, missingRequired, omitted };
}

/**
 * Reads mappings off stored configuration, dropping anything malformed.
 *
 * Stored JSON is data, not a promise: a mapping without a name, or with a
 * source Tringlo does not know, is discarded rather than trusted into a call.
 */
export function parseMappings(raw: unknown): AgentVariableMapping[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(VARIABLE_SOURCES);
  const mappings: AgentVariableMapping[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = clean(record.name);
    const source = clean(record.source);
    if (!name) continue;
    if (!known.has(source) && !source.startsWith("csv.")) continue;
    mappings.push({
      name,
      source: source as VariableSource,
      ...(clean(record.value) ? { value: clean(record.value) } : {}),
      ...(record.required ? { required: true } : {}),
    });
  }
  return mappings;
}

/** The variable names a set of mappings fills, for checking against the agent. */
export function mappedNames(mappings: AgentVariableMapping[] | null | undefined): string[] {
  return (mappings ?? []).map((mapping) => clean(mapping.name)).filter(Boolean);
}
