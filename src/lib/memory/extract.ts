// ============================================================
// Tringlo AI — Memory Extraction
// ============================================================
//
// Turns one finished call into a small set of candidate facts.
//
// Three sources, each held to the same rule — every fact must trace to
// something that was actually said or actually reported:
//
//   1. `customer_facts`, an output variable the Sarvam agent fills in after the
//      call: a JSON list of facts the customer stated, each with the customer's
//      own words as a quote. The model that heard the whole conversation is the
//      best reader of it, but a model will also invent, so a fact is kept only
//      when its quote is found in what the customer said in the transcript.
//      An ungrounded fact is dropped, however plausible.
//
//   2. The agent's other output variables — objection, requirement, budget,
//      timeline, callback. Reported fields, not free text, so trusted, but
//      filtered for the "none" / "not mentioned" filler agents write into
//      empty fields.
//
//   3. The transcript itself, read with conservative patterns for the facts
//      that matter most and are cheapest to get wrong: family, corrections,
//      who else decides, and when to call back. This is the floor that still
//      works when the agent does not provide `customer_facts`.
//
// What this deliberately does not do is let a model summarise the customer
// into free-form impressions. "Seems price-sensitive" and "likely the decision
// maker" read exactly like facts once stored, and are not. Nothing inferred,
// nothing about health, religion, caste, politics or identity documents, and
// nothing the agent said rather than the customer.
// ============================================================

import { isInstructionText } from "@/lib/providers/sarvam/instruction-text";
import type { CallRecord } from "@/lib/types";
import type { ExtractedFact, MemoryCategory } from "./types";

/** Hard ceilings, so one talkative call cannot flood the store. */
const MAX_FACTS_PER_CALL = 20;
const MAX_VALUE_LENGTH = 160;
const MAX_EVIDENCE_LENGTH = 300;

// ------------------------------------------------------------
// The customer's side of the transcript
// ------------------------------------------------------------

/** A statement is only taken from the customer, never from the agent. */
export function customerUtterances(record: CallRecord): string[] {
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
      .map((turn) =>
        String((turn as { text?: string; content?: string }).text ?? (turn as { content?: string }).content ?? "")
      )
      .filter((text) => text.trim().length > 0);
  }

  // With no turn structure there is no way to tell who said what, and
  // attributing the agent's words to the customer would be worse than
  // extracting nothing.
  return [];
}

/** Lowercase, punctuation-free, single-spaced — for comparing words, not characters. */
function normaliseText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds the customer utterance a quote came from.
 *
 * Exact containment first. Transcription and the extracting model rarely agree
 * to the letter — a dropped "um", a contraction expanded — so a quote also
 * counts when nearly all of its words appear in one utterance, or in two
 * consecutive ones where the customer was cut off mid-sentence. A quote too
 * short to mean anything never counts.
 */
export function groundQuote(quote: string, utterances: string[]): string | null {
  const q = normaliseText(quote);
  const words = q.split(" ").filter(Boolean);
  if (words.length < 2) return null;

  const candidates: string[] = [...utterances];
  for (let index = 0; index + 1 < utterances.length; index++) {
    candidates.push(`${utterances[index]} ${utterances[index + 1]}`);
  }

  for (const candidate of candidates) {
    if (normaliseText(candidate).includes(q)) return candidate;
  }

  // Fuzzy: at least 80% of the quote's distinct words, and at least three.
  const distinct = [...new Set(words)];
  if (distinct.length < 3) return null;

  let best: { text: string; coverage: number } | null = null;
  for (const candidate of candidates) {
    const have = new Set(normaliseText(candidate).split(" "));
    const coverage = distinct.filter((word) => have.has(word)).length / distinct.length;
    if (coverage >= 0.8 && (!best || coverage > best.coverage)) {
      best = { text: candidate, coverage };
    }
  }
  return best?.text ?? null;
}

// ------------------------------------------------------------
// Filtering what should never be stored
// ------------------------------------------------------------

/**
 * Filler an agent writes into a field it had nothing for.
 *
 * Stored, these become memories like "previously raised: none", which the
 * agent then dutifully brings up on the next call.
 */
const FILLER =
  /^(?:none|no|nil|null|nothing|na|n\/a|n\.a\.?|unknown|unclear|undefined|not\s+(?:mentioned|discussed|applicable|available|specified|provided|known|stated|clear|given|shared|asked|raised|captured|determined)|no\s+(?:objections?|pain\s*points?|competitors?|budget|timeline|requirements?|next\s+steps?|response|answer|information|info|details?)(?:\s+(?:mentioned|raised|given|stated|shared|discussed|identified))?|didn'?t\s+(?:mention|say|share)|-+|\.+|\?+)\.?$/i;

export function meaningful(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;
  if (FILLER.test(text)) return null;
  if (isInstructionText(text)) return null;
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH - 1).trimEnd()}…` : text;
}

/**
 * Things Tringlo does not keep, even when said outright.
 *
 * Health, faith, caste, politics and sexuality are not what a sales call is
 * for, and repeating them back is never welcome. Identity documents, account
 * numbers and one-time codes are a liability to hold at all.
 */
const SENSITIVE =
  /\b(?:health|medical|illness|disease|diagnos\w*|hospital\w*|surgery|pregnan\w*|disabilit\w*|mental|depress\w*|religio\w*|caste|politic\w*|vote[sd]?|sexual\w*|gay|lesbian|aadhaa?r|pan\s*(?:card|number)|passport|bank\s*account|account\s*number|ifsc|card\s*number|cvv|otp|password|pin\s*(?:code|number))\b/i;

/** Impressions rather than statements. A model's guess must not become a fact. */
const INFERENCE =
  /\b(?:seems?|seemed|appears?|probably|likely|maybe|perhaps|might\s+be|sounds?\s+like|mood|personality|tone|frustrated|annoyed|angry|happy)\b/i;

/** Text that tries to steer the agent rather than describe the customer. */
const INSTRUCTION = /\b(?:ignore|disregard)\b.*\b(?:instructions?|prompt|rules)\b|\bsystem\s+prompt\b/i;

function storable(...texts: Array<string | null | undefined>): boolean {
  return texts.every(
    (text) => !text || (!SENSITIVE.test(text) && !INFERENCE.test(text) && !INSTRUCTION.test(text))
  );
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

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

// ------------------------------------------------------------
// Source 1: the agent's grounded `customer_facts`
// ------------------------------------------------------------

/** The names an agent might reasonably use for a category, mapped to ours. */
const CATEGORY_ALIASES: Record<string, MemoryCategory> = {
  profile: "profile",
  role: "profile",
  personal: "personal_context",
  personal_context: "personal_context",
  family: "personal_context",
  preference: "preferences",
  preferences: "preferences",
  communication: "preferences",
  communication_preference: "preferences",
  communication_preferences: "preferences",
  language: "preferences",
  need: "needs",
  needs: "needs",
  requirement: "needs",
  requirements: "needs",
  pain_point: "pain_points",
  pain_points: "pain_points",
  problem: "pain_points",
  objection: "objections",
  objections: "objections",
  concern: "objections",
  interest: "interests",
  interests: "interests",
  product_interest: "interests",
  product_interests: "interests",
  business: "business_context",
  business_context: "business_context",
  budget: "business_context",
  timeline: "business_context",
  competitor: "business_context",
  competitors: "business_context",
  decision: "decision_process",
  decision_process: "decision_process",
  decision_maker: "decision_process",
  commitment: "commitments",
  commitments: "commitments",
  callback: "follow_up",
  follow_up: "follow_up",
  followup: "follow_up",
  question: "open_questions",
  questions: "open_questions",
  open_question: "open_questions",
  open_questions: "open_questions",
  unresolved: "open_questions",
  unresolved_issue: "open_questions",
};

interface RawFact {
  category?: unknown;
  key?: unknown;
  value?: unknown;
  phrase?: unknown;
  quote?: unknown;
  corrects?: unknown;
  replaces?: unknown;
  is_correction?: unknown;
  denied?: unknown;
}

/**
 * Reads the `customer_facts` variable.
 *
 * It is a String variable holding JSON, and agents wrap JSON in code fences or
 * prose often enough that the list is dug out rather than parsed as-is. A
 * value that is not a list of objects yields nothing, never an error.
 */
export function parseCustomerFacts(raw: unknown): RawFact[] {
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object") as RawFact[];
  if (typeof raw !== "string") return [];

  const text = raw.replace(/```(?:json)?/gi, "").trim();
  if (!text) return [];

  const attempts = [text];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) attempts.push(text.slice(start, end + 1));

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { facts?: unknown }).facts)
          ? (parsed as { facts: unknown[] }).facts
          : null;
      if (list) return list.filter((item) => item && typeof item === "object") as RawFact[];
    } catch {
      // try the next shape
    }
  }
  return [];
}

function keysFrom(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return list.map((entry) => slug(String(entry))).filter(Boolean);
}

function factsFromCustomerFacts(record: CallRecord, utterances: string[]): ExtractedFact[] {
  const raw = record.outputVariables?.customer_facts;
  if (raw === undefined || raw === null) return [];

  const found: ExtractedFact[] = [];
  let rejected = 0;

  for (const item of parseCustomerFacts(raw)) {
    const category = CATEGORY_ALIASES[slug(String(item.category ?? ""))];
    const value = meaningful(item.value);
    const quote = typeof item.quote === "string" ? item.quote.trim() : "";
    const key = slug(String(item.key ?? "")) || (value ? slug(value) : "");

    if (!category || !value || !key || !quote) {
      rejected++;
      continue;
    }

    const evidence = groundQuote(quote, utterances);
    if (!evidence) {
      // The agent reported something the customer cannot be shown to have said.
      rejected++;
      continue;
    }

    const phrase = meaningful(item.phrase) ?? value;
    if (!storable(key, value, phrase, quote)) {
      rejected++;
      continue;
    }

    const trimmedEvidence = evidence.trim().slice(0, MAX_EVIDENCE_LENGTH);
    const denied = item.denied === true || (item.is_correction === true && /^(?:false|no)$/i.test(value));

    if (denied) {
      // "I don't have a sister": a denial of every key listed, and of its own.
      const targets = [...new Set([key, ...keysFrom(item.corrects), ...keysFrom(item.replaces)])];
      for (const target of targets) {
        found.push(
          fact(category, target, "false", phrase, 0.85, {
            isCorrection: true,
            corrects: target,
            evidence: trimmedEvidence,
          })
        );
      }
      continue;
    }

    const replaces = [...keysFrom(item.corrects), ...keysFrom(item.replaces)];
    found.push(
      fact(category, key, value, phrase, 0.8, {
        evidence: trimmedEvidence,
        // A correction that states the right answer ("not my sister — my
        // cousin") retires what it replaces instead of standing beside it.
        ...(replaces.length > 0 || item.is_correction === true
          ? { replaces: replaces.length > 0 ? replaces : [key] }
          : {}),
      })
    );
  }

  if (rejected > 0) {
    console.log(`MEMORY_FACTS_REJECTED call=${record.id} count=${rejected}`);
  }
  return found;
}

// ------------------------------------------------------------
// Source 2: the agent's structured output
// ------------------------------------------------------------

/** "2026-09-27" + "17:00" → "27 Sep at 17:00". */
function describeCallback(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date && !time) return null;
  let day = date ?? "";
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T12:00:00Z`);
    day = parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  }
  return [day, time ? `at ${time}` : ""].filter(Boolean).join(" ");
}

/**
 * Reads the agent's structured output.
 *
 * High confidence, because these are fields Priya was asked to fill in rather
 * than anything guessed here — but only stored when they say something.
 */
function factsFromAgentOutput(record: CallRecord): ExtractedFact[] {
  const found: ExtractedFact[] = [];
  const add = (
    category: MemoryCategory,
    key: string,
    raw: unknown,
    phrase: (value: string) => string,
    confidence: number
  ) => {
    const value = meaningful(raw);
    if (!value || !storable(value)) return;
    found.push(fact(category, key, value, phrase(value), confidence));
  };

  add("objections", "last_objection", record.objection, (v) => `previously raised: ${v}`, 0.85);
  add("needs", "stated_requirement", record.customerRequirement, (v) => `is looking for ${v}`, 0.85);
  add("pain_points", "stated_pain_point", record.painPoints, (v) => v, 0.8);
  add("business_context", "budget_indication", record.budgetIndication, (v) => `budget: ${v}`, 0.75);
  add("business_context", "decision_timeline", record.timelineToDecide, (v) => `decision timeline: ${v}`, 0.75);
  add("profile", "authority_level", record.authorityLevel, (v) => `role in the decision: ${v}`, 0.75);
  add("business_context", "competitor_mentioned", record.competitorMentioned, (v) => `mentioned ${v}`, 0.8);
  add("commitments", "agreed_next_step", record.chosenNextStep, (v) => `agreed next step: ${v}`, 0.85);
  // Reported by the agent but not kept as its own column on the call.
  add(
    "decision_process",
    "decision_process",
    record.outputVariables?.decision_process,
    (v) => `how they decide: ${v}`,
    0.8
  );

  // The callback they asked for. Stored as a fact rather than read from the
  // follow-up queue, so the next call knows it is the one they asked for.
  if (record.followUpRequired) {
    const when = describeCallback(record.followUpDate, record.followUpTime);
    if (when) {
      found.push(
        fact("follow_up", "requested_callback", when, `asked to be called back ${when}`, 0.9)
      );
    }
  }

  return found;
}

// ------------------------------------------------------------
// Source 3: the transcript, read conservatively
// ------------------------------------------------------------

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
      /\bmy\s+(?:little|younger|small|kid)\s+sister\b|\bi\s+(?:also\s+)?have\s+(?:a|an|one|two|\d+)?\s*(?:little|younger|small|kid)\s+sisters?\b/i,
    negative:
      /\b(?:don'?t|do not|dont|never)\s+have\s+(?:a\s+)?(?:little|younger|small)?\s*sister\b|\bno\s+sister\b/i,
  },
  {
    key: "has_sister",
    value: "true",
    phrase: "has a sister",
    positive: /\bmy\s+sister\b|\bi\s+(?:also\s+)?have\s+(?:a|an|one|two|\d+)?\s*sisters?\b/i,
    negative: /\b(?:don'?t|do not|dont|never)\s+have\s+(?:a\s+)?sister\b|\bno\s+sister\b/i,
  },
  {
    key: "has_brother",
    value: "true",
    phrase: "has a brother",
    positive:
      /\bmy\s+(?:little|younger|elder|big|older)?\s*brother\b|\bi\s+(?:also\s+)?have\s+(?:a|an|one|two|\d+)?\s*(?:little|younger|elder|big|older)?\s*brothers?\b/i,
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
      /\bmy\s+(?:kids?|children|son|daughter)\b|\bi\s+(?:also\s+)?have\s+(?:a|an|one|two|\d+)?\s*(?:kids?|children|sons?|daughters?)\b/i,
    negative: /\b(?:don'?t|do not|dont|never)\s+have\s+(?:any\s+)?(?:kids?|children)\b/i,
  },
];

/**
 * Corrections, which are the only thing allowed to overturn a stored memory.
 *
 * `corrects` lists every key the denial retracts, not just the obvious one.
 * "I don't have a sister" has to retract `has_younger_sister` as well, because
 * a younger sister is a sister — retracting only the exact key would leave the
 * more specific claim standing and Tringlo would go on believing it.
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

/** "I'll discuss it with my brother" — someone else is part of the decision. */
const DECISION_PATTERN =
  /\b(?:discuss|talk|check|consult|speak|confirm|decide)\s+(?:it\s+|this\s+|that\s+)?(?:with|to)\s+my\s+(brother|sister|wife|husband|father|dad|mother|mom|mum|parents|family|partner|business\s+partner|co-?founder|boss|manager|team|son|daughter|cousin|uncle|accountant|ca)\b/i;

/** "Call me tomorrow at 5" — when they asked to hear back. */
const CALLBACK_PATTERN =
  /\bcall\s+(?:me\s+)?(?:back\s+)?((?:tomorrow|today|tonight|later|next\s+week|on\s+\w+day|\w+day|in\s+the\s+(?:morning|afternoon|evening)|after\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?:\s+(?:at|around|after|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|o'?clock)?)?(?:\s+(?:morning|afternoon|evening))?)/i;

/** "The best time to call me is in the evening" — a standing preference. */
const TIME_PREFERENCE_PATTERN =
  /\b(?:best|better|prefer(?:red)?|only|usually)\s+(?:time\s+)?(?:to\s+)?(?:call|reach|contact)\s+(?:me\s+)?(?:is\s+)?(?:only\s+)?((?:in\s+the\s+)?(?:morning|afternoon|evening|night)s?|after\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|before\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|on\s+weekends?|on\s+weekdays?)/i;

/** Reads the customer's own words, conservatively. */
function factsFromTranscript(utterances: string[]): ExtractedFact[] {
  const found: ExtractedFact[] = [];
  if (utterances.length === 0) return found;

  const seen = new Set<string>();
  const evidence = (text: string) => text.trim().slice(0, MAX_EVIDENCE_LENGTH);

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
            evidence: evidence(utterance),
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
        fact("personal_context", relation.key, relation.value, relation.phrase, 0.8, {
          evidence: evidence(utterance),
        })
      );
    }

    const language = LANGUAGE_PATTERN.exec(utterance);
    if (language && !seen.has("preferred_language")) {
      seen.add("preferred_language");
      const name = language[1].toLowerCase();
      found.push(
        fact("preferences", "preferred_language", name, `prefers to speak in ${name}`, 0.85, {
          evidence: evidence(utterance),
        })
      );
    }

    const decision = DECISION_PATTERN.exec(utterance);
    if (decision && !seen.has("consults_before_deciding")) {
      seen.add("consults_before_deciding");
      const who = decision[1].toLowerCase().replace(/\s+/g, " ");
      found.push(
        fact(
          "decision_process",
          "consults_before_deciding",
          who,
          `wants to discuss it with their ${who} before deciding`,
          0.85,
          { evidence: evidence(utterance) }
        )
      );
    }

    const timing = TIME_PREFERENCE_PATTERN.exec(utterance);
    if (timing && !seen.has("preferred_call_time")) {
      seen.add("preferred_call_time");
      const when = timing[1].toLowerCase().replace(/\s+/g, " ");
      found.push(
        fact("preferences", "preferred_call_time", when, `prefers calls ${when}`, 0.8, {
          evidence: evidence(utterance),
        })
      );
    } else {
      const callback = CALLBACK_PATTERN.exec(utterance);
      if (callback && !seen.has("requested_callback")) {
        seen.add("requested_callback");
        const when = callback[1].toLowerCase().replace(/\s+/g, " ").trim();
        found.push(
          fact("follow_up", "requested_callback", when, `asked to be called back ${when}`, 0.75, {
            evidence: evidence(utterance),
          })
        );
      }
    }
  }

  return found;
}

// ------------------------------------------------------------
// Putting it together
// ------------------------------------------------------------

/**
 * Everything learnable from one call.
 *
 * Returns nothing for a call that did not connect: there was no conversation,
 * so there is nothing the customer said.
 */
export function extractFactsFromCall(record: CallRecord): ExtractedFact[] {
  if (record.status !== "connected") return [];

  const utterances = customerUtterances(record);

  // Order is precedence: when two sources produce the same key, the first
  // wins. Grounded agent facts carry the customer's words; structured output
  // is next; the pattern reader is the fallback.
  //
  // The one exception is the callback: the agent's resolved date ("27 Sep at
  // 17:00") beats the customer's relative words ("tomorrow at 5"), which stop
  // meaning anything the day after.
  const reported = factsFromAgentOutput(record);
  const all = [
    ...reported.filter((item) => item.key === "requested_callback"),
    ...factsFromCustomerFacts(record, utterances),
    ...reported,
    ...factsFromTranscript(utterances),
  ];

  const facts: ExtractedFact[] = [];
  const taken = new Set<string>();
  for (const item of all) {
    const identity = item.isCorrection ? `!${item.corrects ?? item.key}` : item.key;
    if (taken.has(identity)) continue;
    taken.add(identity);
    facts.push(item);
  }

  // A denial and a positive claim about the same key cannot both stand from a
  // single call; the denial is the more deliberate statement.
  const denied = new Set(
    facts.filter((item) => item.isCorrection).map((item) => item.corrects ?? item.key)
  );

  return facts
    .filter((item) => item.isCorrection || !denied.has(item.key))
    .slice(0, MAX_FACTS_PER_CALL);
}
