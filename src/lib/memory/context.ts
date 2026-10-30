// ============================================================
// Tringlo AI — Call Context From Memory
// ============================================================
//
// Chooses the few things worth telling Priya before she dials, and writes them
// as a sentence she can speak from.
//
// The hard constraint is size. Everything known about a customer could be
// pasted in, and it would be worse: a long list of facts invites the agent to
// recite them, which is exactly the "I remember 17 facts about you" failure
// §11 names. The budget here is a handful of items, chosen for this call.
//
// Relevance is decided by what the call is for. A callback about pricing wants
// the previous objection and the agreed next step; it does not want the
// customer's sibling. Personal context is included only on a genuine follow-up
// with the same person, where referring back to it reads as continuity rather
// than surveillance.
// ============================================================

import type { CallSummary, CustomerProfile, MemoryCategory, MemoryItem } from "./types";
import { CONFIDENCE_FLOOR, SENSITIVE_CATEGORIES } from "./types";

/** Facts the customer should never be asked twice. */
const ASK_ONCE_CATEGORIES: MemoryCategory[] = [
  "needs",
  "business_context",
  "profile",
  "decision_process",
  "pain_points",
  "interests",
  "preferences",
];

/** Few enough that the agent mentions at most one or two in passing. */
const MAX_MEMORY_ITEMS = 6;
const MAX_PERSONAL_ITEMS = 2;

export interface ContextRequest {
  /**
   * True when this call is a scheduled callback rather than a first attempt.
   * A manual call to someone Tringlo has already spoken with is treated as a
   * continuation too; this flag additionally means "the call they asked for".
   */
  isFollowUp: boolean;
  /**
   * What the call is about, when known — the campaign or the agreed next step.
   * Used to weight which memories are worth carrying.
   */
  topic?: string | null;
}

export interface CallContext {
  /** One or two sentences of prior interaction, for `previous_interaction`. */
  previousInteraction: string;
  /** The condensed history, for `priorTouchpointSummary`. */
  priorTouchpointSummary: string;
  /** Set when an earlier call recorded a reason for saying no. */
  previousObjection: string | null;
  previousInterest: string | null;
  /** What was agreed or promised last time. */
  previousCommitment: string | null;
  /** The next step agreed on the most recent call. */
  previousNextStep: string | null;
  /** The agent's summary of the most recent call. */
  lastCallSummary: string | null;
  /** Why this call is happening, when it is a callback the customer asked for. */
  followUpReason: string | null;
  /** The chosen memories as one compact line, for `customer_memory_context`. */
  customerMemoryContext: string;
  /** The customer's stable id, when Tringlo knows them. */
  customerId: string | null;
  /** The items actually chosen, so the decision is inspectable and testable. */
  usedItems: MemoryItem[];
  /** True when there is genuinely nothing to say — a first, cold call. */
  isEmpty: boolean;
}

/**
 * Categories worth carrying, weighted for this call.
 *
 * Objections and commitments matter almost always: walking back into a settled
 * objection is the most expensive mistake a callback can make.
 */
function weightFor(category: MemoryCategory, request: ContextRequest): number {
  switch (category) {
    case "objections":
      return 1.0;
    case "commitments":
      return request.isFollowUp ? 1.0 : 0.6;
    case "needs":
      return 0.9;
    case "pain_points":
      return 0.8;
    case "preferences":
      return 0.8;
    case "business_context":
      return 0.6;
    case "profile":
      return 0.5;
    case "personal_context":
      // Only on a follow-up, and never at the top of the list.
      return request.isFollowUp ? 0.4 : 0;
    case "interests":
      return 0.9;
    case "decision_process":
      return 0.9;
    case "follow_up":
      // Why they asked for this call is the first thing a callback needs.
      return request.isFollowUp ? 1.1 : 0.5;
    case "open_questions":
      return 0.85;
  }
}

/** A crude topical check: does this memory share vocabulary with the call's subject? */
function topicallyRelevant(item: MemoryItem, topic: string | null | undefined): boolean {
  if (!topic) return false;
  const words = topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  if (words.length === 0) return false;

  const haystack = `${item.key} ${item.value} ${item.phrase}`.toLowerCase();
  return words.some((word) => haystack.includes(word));
}

/**
 * Picks the memories to carry into one call.
 *
 * `identityAmbiguous` is the safety gate: when two different names have been
 * seen on one number, personal context is dropped entirely. Repeating a
 * stranger's family details to whoever picks up is the worst outcome this
 * system can produce, and it is cheap to avoid.
 */
export function selectMemories(
  items: MemoryItem[],
  request: ContextRequest,
  options: { identityAmbiguous: boolean }
): MemoryItem[] {
  const eligible = items.filter(
    (item) => item.status === "active" && item.confidence >= CONFIDENCE_FLOOR
  );

  const allowed = options.identityAmbiguous
    ? eligible.filter((item) => !SENSITIVE_CATEGORIES.includes(item.category))
    : eligible;

  const scored = allowed
    .map((item) => {
      let score = weightFor(item.category, request) * item.confidence;
      if (topicallyRelevant(item, request.topic)) score += 0.3;
      // Recently confirmed facts are likelier to still be true.
      const ageDays =
        (Date.now() - new Date(item.lastConfirmedAt).getTime()) / (24 * 60 * 60 * 1000);
      if (Number.isFinite(ageDays) && ageDays > 90) score -= 0.15;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    // Equal scores go to what was said most recently: the cousin mentioned
    // yesterday matters more today than the sister mentioned last month.
    .sort(
      (a, b) =>
        b.score - a.score || b.item.lastConfirmedAt.localeCompare(a.item.lastConfirmedAt)
    );

  // Two facts saying the same thing ("previously raised: price is high" and
  // "finds the price too high") are one fact to the agent — and so is a fact
  // another already implies: "wants to discuss it with their brother" says
  // they have a brother.
  const unique = scored.filter(
    ({ item }, index) =>
      !scored.slice(0, index).some(({ item: earlier }) => overlapping(earlier, item))
  );

  // Personal context is capped, and on a continuation also given its own
  // share of the budget: otherwise a customer with many business facts never
  // hears "how's your sister?", which is most of what makes a callback feel
  // like the same relationship.
  const personalPicks = unique
    .filter(({ item }) => SENSITIVE_CATEGORIES.includes(item.category))
    .slice(0, MAX_PERSONAL_ITEMS);
  const otherPicks = unique
    .filter(({ item }) => !SENSITIVE_CATEGORIES.includes(item.category))
    .slice(0, MAX_MEMORY_ITEMS - personalPicks.length);

  const picked = new Set([...otherPicks, ...personalPicks].map(({ item }) => item.id));
  return unique.filter(({ item }) => picked.has(item.id)).map(({ item }) => item);
}

/** Content words, for spotting two memories that say the same thing. */
function contentWords(item: MemoryItem): Set<string> {
  const stop = new Set(["the", "and", "for", "previously", "raised", "finds", "has", "was", "they", "their", "too", "now", "right", "true", "false"]);
  return new Set(
    `${item.phrase} ${item.value}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !stop.has(word))
  );
}

function overlapping(a: MemoryItem, b: MemoryItem): boolean {
  const left = contentWords(a);
  const right = contentWords(b);
  if (left.size === 0 || right.size === 0) return false;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size) >= 0.5;
}

/** The most recent call worth referring back to. */
function lastMeaningfulSummary(summaries: CallSummary[]): CallSummary | null {
  const ordered = [...summaries].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
  return ordered.find((entry) => entry.summary || entry.nextStep || entry.objection) ?? null;
}

/**
 * Builds the context strings handed to the agent.
 *
 * Written as prose in the third person, because that is what produces "last
 * time we spoke, you mentioned your little sister" rather than a field read
 * aloud. The agent is told these are things to use if they fit, not a script.
 */
export function buildCallContext(
  profile: CustomerProfile | null,
  items: MemoryItem[],
  request: ContextRequest
): CallContext {
  const empty: CallContext = {
    previousInteraction: "",
    priorTouchpointSummary: "",
    previousObjection: null,
    previousInterest: null,
    previousCommitment: null,
    previousNextStep: null,
    lastCallSummary: null,
    followUpReason: null,
    customerMemoryContext: "",
    customerId: null,
    usedItems: [],
    isEmpty: true,
  };

  if (!profile) return empty;

  // Someone Tringlo has already spoken with is a continuation, whoever placed
  // the call; a scheduled callback additionally is the call they asked for.
  const hasHistory = profile.recentSummaries.length > 0;
  const effective: ContextRequest = { ...request, isFollowUp: request.isFollowUp || hasHistory };

  const last = lastMeaningfulSummary(profile.recentSummaries);
  const latestCallId = [...profile.recentSummaries].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  )[0]?.callId;

  // A callback request belongs to the call right after it. Once another
  // conversation has happened, "asked to be called back on the 8th" is
  // history, not context.
  const current = items.filter(
    (item) => item.category !== "follow_up" || item.lastConfirmedCallId === latestCallId
  );

  const chosen = selectMemories(current, effective, {
    identityAmbiguous: profile.identityAmbiguous,
  });

  if (chosen.length === 0 && !last) return { ...empty, customerId: profile.id };

  const active = (key: string) =>
    current.find(
      (item) => item.key === key && item.status === "active" && item.confidence >= CONFIDENCE_FLOOR
    ) ?? null;

  // ---- why this call is happening ---------------------------------------
  const callback = active("requested_callback");
  const decision = profile.identityAmbiguous ? null : active("consults_before_deciding");
  let followUpReason: string | null = null;
  if (request.isFollowUp && (callback || last?.callbackRequested)) {
    const reasons = [
      decision ? `they wanted to ${decision.phrase.replace(/^wants to /, "")}` : null,
      last?.nextStep ? `the agreed next step was ${trimTo(last.nextStep, 100)}` : null,
    ].filter(Boolean);
    followUpReason = trimTo(
      `This is the callback they asked for${reasons.length ? ` — ${reasons.join("; ")}` : ""}.`,
      240
    );
  }

  // ---- the conversational line ------------------------------------------
  const parts: string[] = [];

  if (followUpReason) {
    parts.push(
      `${followUpReason} Open by acknowledging that you are calling back as they asked, not as a new introduction.`
    );
  }

  if (last) {
    const when = describeWhen(last.at);
    const what = last.summary?.trim();
    parts.push(
      what
        ? `${spokeWith(last, when)} In that call: ${trimTo(what, 220)}`
        : spokeWith(last, when)
    );
    if (last.nextStep?.trim()) {
      parts.push(`The agreed next step was: ${trimTo(last.nextStep.trim(), 120)}.`);
    }
  }

  // What they have told us: the chosen memories plus every confident business
  // fact, in one list, never asked about again. A callback request belongs only
  // to the callback itself; on any other call it is stale history.
  const asked = new Set<string>();
  const told = [
    ...chosen,
    ...items.filter(
      (item) =>
        item.status === "active" &&
        item.confidence >= CONFIDENCE_FLOOR &&
        ASK_ONCE_CATEGORIES.includes(item.category)
    ),
  ]
    .filter((item) => item.key !== "requested_callback" || (request.isFollowUp && !followUpReason))
    .filter((item) => {
      if (asked.has(item.id)) return false;
      asked.add(item.id);
      return true;
    })
    .map((item) => item.phrase.trim())
    .filter(Boolean)
    .slice(0, 8);

  const customerMemoryContext = trimTo(told.join("; "), 500);

  if (told.length > 0) {
    parts.push(
      `What they have told us before — do not ask about any of it again, and mention it only if it comes up naturally: ${told.join("; ")}.`
    );
  }

  const previousInteraction = trimTo(parts.join(" "), 1200);

  // ---- the condensed history --------------------------------------------
  const history = profile.recentSummaries
    .slice(0, 3)
    .map((entry) => {
      const when = describeWhen(entry.at);
      const outcome = entry.summary?.trim() || entry.objection?.trim() || "no detail recorded";
      return `${when}: ${trimTo(outcome, 140)}`;
    })
    .join(" | ");

  const objection =
    chosen.find((item) => item.category === "objections")?.value ??
    profile.recentSummaries.find((entry) => entry.objection)?.objection ??
    null;

  const interest =
    chosen.find((item) => item.category === "interests")?.value ??
    profile.recentSummaries.find((entry) => entry.interest)?.interest ??
    null;

  const commitment =
    chosen.find((item) => item.category === "commitments")?.value ??
    last?.nextStep ??
    null;

  return {
    previousInteraction,
    priorTouchpointSummary: trimTo(history, 600),
    previousObjection: objection,
    previousInterest: interest,
    previousCommitment: commitment ? trimTo(commitment, 160) : null,
    previousNextStep: last?.nextStep ? trimTo(last.nextStep, 160) : null,
    lastCallSummary: last?.summary ? trimTo(last.summary, 300) : null,
    followUpReason,
    customerMemoryContext,
    customerId: profile.id,
    usedItems: chosen,
    isEmpty: previousInteraction.length === 0,
  };
}

/** "They called us yesterday." vs "You spoke with this customer yesterday." */
function spokeWith(summary: CallSummary, when: string): string {
  return summary.direction === "inbound"
    ? `They called us ${when}.`
    : `You spoke with this customer ${when}.`;
}

/** Relative time in the way a person would say it. */
function describeWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "previously";

  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function trimTo(value: string, max: number): string {
  const text = value.trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
