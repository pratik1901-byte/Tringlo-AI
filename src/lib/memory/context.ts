// ============================================================
// Dialo AI — Call Context From Memory
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

/** Few enough that the agent mentions at most one or two in passing. */
const MAX_MEMORY_ITEMS = 6;
const MAX_PERSONAL_ITEMS = 2;

export interface ContextRequest {
  /** True when this call is a scheduled callback rather than a first attempt. */
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
    .sort((a, b) => b.score - a.score);

  const chosen: MemoryItem[] = [];
  let personal = 0;

  for (const { item } of scored) {
    if (chosen.length >= MAX_MEMORY_ITEMS) break;
    if (SENSITIVE_CATEGORIES.includes(item.category)) {
      if (personal >= MAX_PERSONAL_ITEMS) continue;
      personal++;
    }
    chosen.push(item);
  }

  return chosen;
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
    usedItems: [],
    isEmpty: true,
  };

  if (!profile) return empty;

  const chosen = selectMemories(items, request, {
    identityAmbiguous: profile.identityAmbiguous,
  });
  const last = lastMeaningfulSummary(profile.recentSummaries);

  if (chosen.length === 0 && !last) return empty;

  // ---- the conversational line ------------------------------------------
  const parts: string[] = [];

  if (last) {
    const when = describeWhen(last.at);
    const what = last.summary?.trim();
    parts.push(
      what
        ? `You spoke with this customer ${when}. In that call: ${trimTo(what, 220)}`
        : `You spoke with this customer ${when}.`
    );
    if (last.nextStep?.trim()) {
      parts.push(`The agreed next step was: ${trimTo(last.nextStep.trim(), 120)}.`);
    }
  }

  if (chosen.length > 0) {
    const phrases = chosen.map((item) => item.phrase.trim()).filter(Boolean);
    if (phrases.length > 0) {
      parts.push(
        `Things they have told us before: ${phrases.join("; ")}. ` +
          `Refer to any of this only if it comes up naturally — do not list it back to them.`
      );
    }
  }

  const previousInteraction = trimTo(parts.join(" "), 900);

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

  const interest = profile.recentSummaries.find((entry) => entry.interest)?.interest ?? null;

  return {
    previousInteraction,
    priorTouchpointSummary: trimTo(history, 600),
    previousObjection: objection,
    previousInterest: interest,
    usedItems: chosen,
    isEmpty: previousInteraction.length === 0,
  };
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
