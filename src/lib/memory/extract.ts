// ============================================================
// Dialo AI — Memory Extraction
// ============================================================
//
// Turns one finished call into a small set of candidate facts.
//
// Two sources, in order of trust:
//
//   1. The agent's own output variables. Priya already reports the objection,
//      the requirement, the timeline, the budget signal. These are the most
//      reliable thing in the payload because the model produced them from the
//      whole conversation, and they are what the call record already stores.
//
//   2. The transcript, read for explicit statements the customer made about
//      themselves, using conservative patterns.
//
// What this deliberately does not do is ask a language model to summarise the
// customer into free-form "memories". That reliably produces confident
// inventions — "seems price-sensitive", "likely a decision maker" — which are
// indistinguishable from things the customer actually said once stored. Every
// fact here traces to a specific utterance or a specific agent output.
//
// The brief's rule is the test: the customer says "I have a little sister", so
// `has_younger_sister` is stored and nothing else is. No inferred favourite
// colour, no inferred seniority, no inferred mood.
// ============================================================

import type { CallRecord } from "@/lib/types";
import type { ExtractedFact, MemoryCategory } from "./types";

/** A statement is only taken from the customer, never from the agent. */
function customerUtterances(record: CallRecord): string[] {
  const turns = record.transcriptTurns;

  if (Array.isArray(turns) && turns.length > 0) {
    return turns
      .filter((turn) => {
        const speaker = String(
          (turn as { speaker?: string; role?: string }).speaker ??
            (turn as { role?: string }).role ??
            ""
        ).toLowerCase();
        // Anything that is not clearly the agent is treated as the customer;
        // providers label the human side inconsistently.
        return !["agent", "assistant", "bot", "ai", "system"].includes(speaker);
      })
      .map((turn) => String((turn as { text?: string; content?: string }).text ?? (turn as { content?: string }).content ?? ""))
      .filter((text) => text.trim().length > 0);
  }

  // With no turn structure there is no way to tell who said what, and
  // attributing the agent's words to the customer would be worse than
  // extracting nothing.
  return [];
}

/**
 * Patterns for family and household context.
 *
 * Each requires a first-person possessive, so "my sister" counts and "do you
 * have a sister?" or "my colleague's sister" do not. This is the category the
 * brief's example exercises, and the one where a false positive is most
 * embarrassing to repeat back on a later call.
 */
const RELATION_PATTERNS: Array<{
  key: string;
  value: string;
  phrase: string;
  positive: RegExp;
  negative: RegExp;
}> = [
  {
    key: "has_younger_sister",
    value: "true",
    phrase: "has a younger sister",
    positive:
      /\bmy\s+(?:little|younger|small|kid)\s+sister\b|\bi\s+have\s+(?:a|an|one|two|\d+)?\s*(?:little|younger|small|kid)\s+sisters?\b/i,
    negative:
      /\b(?:don'?t|do not|dont|never)\s+have\s+(?:a\s+)?(?:little|younger|small)?\s*sister\b|\bno\s+sister\b/i,
  },
  {
    key: "has_sister",
    value: "true",
    phrase: "has a sister",
    positive: /\bmy\s+sister\b|\bi\s+have\s+(?:a|an|one|two|\d+)?\s*sisters?\b/i,
    negative: /\b(?:don'?t|do not|dont|never)\s+have\s+(?:a\s+)?sister\b|\bno\s+sister\b/i,
  },
  {
    key: "has_brother",
    value: "true",
    phrase: "has a brother",
    positive:
      /\bmy\s+(?:little|younger|elder|big|older)?\s*brother\b|\bi\s+have\s+(?:a|an|one|two|\d+)?\s*(?:little|younger|elder|big|older)?\s*brothers?\b/i,
    negative: /\b(?:don'?t|do not|dont|never)\s+have\s+(?:a\s+)?brother\b|\bno\s+brother\b/i,
  },
  {
    key: "has_cousin",
    value: "true",
    phrase: "has a cousin",
    positive: /\bmy\s+cousin\b|\bi\s+(?:also\s+)?have\s+(?:a|an|one|two|\d+)?\s*cousins?\b/i,
    negative: /\b(?:don'?t|do not|dont|never)\s+have\s+(?:a\s+)?cousin\b|\bno\s+cousin\b/i,
  },
  {
    key: "has_children",
    value: "true",
    phrase: "has children",
    positive:
      /\bmy\s+(?:kids?|children|son|daughter)\b|\bi\s+have\s+(?:a|an|one|two|\d+)?\s*(?:kids?|children|sons?|daughters?)\b/i,
    negative: /\b(?:don'?t|do not|dont|never)\s+have\s+(?:any\s+)?(?:kids?|children)\b/i,
  },
];

/**
 * Corrections, which are the only thing allowed to overturn a stored memory.
 *
 * `corrects` lists every key the denial retracts, not just the obvious one.
 * "I don't have a sister" has to retract `has_younger_sister` as well, because
 * a younger sister is a sister — retracting only the exact key would leave the
 * more specific claim standing and Dialo would go on believing it.
 */
const CORRECTION_PATTERNS: Array<{ corrects: string[]; pattern: RegExp; phrase: string }> = [
  {
    corrects: ["has_sister", "has_younger_sister"],
    phrase: "does not have a sister",
    pattern:
      /\b(?:i\s+)?(?:don'?t|do not|dont)\s+have\s+(?:a\s+)?sister\b|\bno,?\s*(?:i\s+)?(?:don'?t|dont)\s+have\s+(?:a\s+)?sister\b/i,
  },
  {
    corrects: ["has_younger_sister"],
    phrase: "does not have a younger sister",
    pattern:
      /\b(?:i\s+)?(?:don'?t|do not|dont)\s+have\s+(?:a\s+)?(?:little|younger|small)\s+sister\b/i,
  },
  {
    corrects: ["has_brother"],
    phrase: "does not have a brother",
    pattern: /\b(?:i\s+)?(?:don'?t|do not|dont)\s+have\s+(?:a\s+)?brother\b/i,
  },
  {
    corrects: ["has_children"],
    phrase: "does not have children",
    pattern: /\b(?:i\s+)?(?:don'?t|do not|dont)\s+have\s+(?:any\s+)?(?:kids?|children)\b/i,
  },
];

/** Language preference, stated outright. */
const LANGUAGE_PATTERN =
  /\b(?:speak|talk|call\s+me)\s+(?:in\s+)?(hindi|english|kannada|tamil|telugu|marathi|bengali|gujarati|punjabi|malayalam)\b/i;

function fact(
  category: MemoryCategory,
  key: string,
  value: string,
  phrase: string,
  confidence: number,
  extra?: Partial<ExtractedFact>
): ExtractedFact {
  return { category, key, value, phrase, confidence, ...extra };
}

/**
 * Reads the agent's structured output.
 *
 * High confidence, because these are fields Priya was asked to fill in rather
 * than anything guessed here — but still only stored when non-empty.
 */
function factsFromAgentOutput(record: CallRecord): ExtractedFact[] {
  const found: ExtractedFact[] = [];
  const clean = (value: unknown) =>
    typeof value === "string" && value.trim().length > 1 ? value.trim() : null;

  const objection = clean(record.objection);
  if (objection) {
    found.push(
      fact(
        "objections",
        "last_objection",
        objection,
        `previously raised: ${objection}`,
        0.85
      )
    );
  }

  const requirement = clean(record.customerRequirement);
  if (requirement) {
    found.push(
      fact("needs", "stated_requirement", requirement, `is looking for ${requirement}`, 0.85)
    );
  }

  const painPoints = clean(record.painPoints);
  if (painPoints) {
    found.push(fact("pain_points", "stated_pain_point", painPoints, painPoints, 0.8));
  }

  const budget = clean(record.budgetIndication);
  if (budget) {
    found.push(
      fact("business_context", "budget_indication", budget, `budget: ${budget}`, 0.75)
    );
  }

  const timeline = clean(record.timelineToDecide);
  if (timeline) {
    found.push(
      fact("business_context", "decision_timeline", timeline, `decides within ${timeline}`, 0.75)
    );
  }

  const authority = clean(record.authorityLevel);
  if (authority) {
    found.push(fact("profile", "authority_level", authority, `role: ${authority}`, 0.75));
  }

  const competitor = clean(record.competitorMentioned);
  if (competitor) {
    found.push(
      fact(
        "business_context",
        "competitor_mentioned",
        competitor,
        `currently considering ${competitor}`,
        0.8
      )
    );
  }

  const nextStep = clean(record.chosenNextStep);
  if (nextStep) {
    found.push(fact("commitments", "agreed_next_step", nextStep, nextStep, 0.85));
  }

  return found;
}

/** Reads the customer's own words, conservatively. */
function factsFromTranscript(record: CallRecord): ExtractedFact[] {
  const found: ExtractedFact[] = [];
  const utterances = customerUtterances(record);
  if (utterances.length === 0) return found;

  const seen = new Set<string>();

  for (const utterance of utterances) {
    // A question is not a statement about oneself. "Do you have a sister?"
    // contains the same words as the claim and means the opposite of one.
    if (/\?\s*$/.test(utterance.trim()) || /^\s*(?:do|does|did|are|is|can|would|will)\b/i.test(utterance)) {
      continue;
    }

    // Corrections are checked first: "I don't have a sister" also contains
    // "my sister" for some phrasings, and the denial must win.
    for (const correction of CORRECTION_PATTERNS) {
      if (!correction.pattern.test(utterance)) continue;

      for (const key of correction.corrects) {
        if (seen.has(`!${key}`)) continue;
        seen.add(`!${key}`);
        found.push(
          fact("personal_context", key, "false", correction.phrase, 0.9, {
            isCorrection: true,
            corrects: key,
          })
        );
      }
    }

    for (const relation of RELATION_PATTERNS) {
      if (seen.has(`!${relation.key}`) || seen.has(relation.key)) continue;
      if (relation.negative.test(utterance)) continue;
      if (!relation.positive.test(utterance)) continue;

      seen.add(relation.key);
      found.push(
        fact("personal_context", relation.key, relation.value, relation.phrase, 0.8)
      );
    }

    const language = LANGUAGE_PATTERN.exec(utterance);
    if (language && !seen.has("preferred_language")) {
      seen.add("preferred_language");
      const name = language[1].toLowerCase();
      found.push(
        fact(
          "preferences",
          "preferred_language",
          name,
          `prefers to speak in ${name}`,
          0.85
        )
      );
    }
  }

  return found;
}

/**
 * Everything learnable from one call.
 *
 * Returns nothing for a call that did not connect: there was no conversation,
 * so there is nothing the customer said.
 */
export function extractFactsFromCall(record: CallRecord): ExtractedFact[] {
  if (record.status !== "connected") return [];

  const facts = [...factsFromAgentOutput(record), ...factsFromTranscript(record)];

  // A correction and a positive claim about the same key cannot both stand
  // from a single call; the correction is the later, more deliberate statement.
  const corrected = new Set(
    facts.filter((item) => item.isCorrection).map((item) => item.corrects ?? item.key)
  );

  return facts.filter((item) => item.isCorrection || !corrected.has(item.key));
}
