// ============================================================
// Sarvam — telling an instruction apart from an answer
// ============================================================
//
// When a call is too short for the agent to analyse, Sarvam reports some
// output variables with their *extraction prompt* in place of a value:
//
//   call_summary       → "Write a concise 2-3 sentence summary of the call…"
//   budget_indication  → "Capture the budget signal shared: … If not
//                          discussed, return NA."
//
// Taken at face value these became call summaries, "customer memories", and
// worst of all context read to the agent on the next call. Every path that
// reads an output variable checks it here first.
// ============================================================

const IMPERATIVE_START = /^(write|summari[sz]e|capture|extract|describe|list|identify|determine|classify|record|note down|based on)\b/i;

/** How a prompt talks about the call; a real answer talks about the person. */
const ABOUT_THE_TASK = /\b(the (call|conversation|transcript|customer'?s?|prospect'?s?|user'?s?)|shared|discussed|stated)\b/i;

const PROMPT_MARKERS = [
  /\bif not (discussed|mentioned|available|known|stated|shared)\b[^.]*\breturn\b/i,
  /\breturn\s+["']?(na|n\/a|null|none|unknown)["']?\s*[.)]?\s*$/i,
  /\b(2|two)\s*-\s*(3|three) sentence summary\b/i,
];

/** True when a value is the agent's instruction rather than something it found. */
export function isInstructionText(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text) return false;
  if (PROMPT_MARKERS.some((pattern) => pattern.test(text))) return true;
  // "Provide pricing by email" is a real next step; "Capture the budget
  // signal shared…" is a prompt. A command word alone is not enough.
  return IMPERATIVE_START.test(text) && ABOUT_THE_TASK.test(text);
}

/** A copy of an output-variable bag with every instruction-text value removed. */
export function withoutInstructions<T extends Record<string, unknown>>(variables: T | null | undefined): T | null {
  if (!variables) return null;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (isInstructionText(value)) continue;
    kept[key] = value;
  }
  return kept as T;
}
