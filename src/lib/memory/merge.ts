// ============================================================
// Tringlo AI — Memory Merge
// ============================================================
//
// Folds the facts from one call into what is already known.
//
// The rules, in the order they matter:
//
//   1. New information adds. Learning about a cousin does not cast doubt on a
//      sister. Unrelated keys never touch each other — the brief is explicit
//      that "I also have a cousin" must leave the sister fact standing.
//
//   2. Repetition confirms. The same fact heard again moves `lastConfirmedAt`
//      and raises confidence, rather than creating a second row.
//
//   3. Only an explicit correction overturns. "I don't have a sister, I meant
//      my cousin" retires the sister memory. A later call that simply fails to
//      mention the sister does not, because absence is not denial.
//
//   4. A changed value of the same key supersedes rather than deletes. The old
//      row stays with `status: superseded`, so the history of what was believed
//      and when remains answerable.
//
//   5. The same call twice changes nothing. A redelivered webhook must not
//      confirm a fact against itself and inflate its confidence, so anything
//      already confirmed by this call id is left alone.
//
// Nothing is ever destroyed here. Retired memories keep the call id that
// retired them, which is what makes §6's provenance question answerable.
// ============================================================

import type { ExtractedFact, MemoryItem } from "./types";

/** How many confirming call ids a memory keeps. */
const MAX_CALL_IDS = 20;

function withCall(ids: string[] | undefined, callId: string): string[] {
  return [...(ids ?? []).filter((id) => id !== callId), callId].slice(-MAX_CALL_IDS);
}

/** Confidence gained each time a fact is independently repeated. */
const CONFIRMATION_BOOST = 0.05;
const MAX_CONFIDENCE = 0.98;

export interface MergeOutcome {
  items: MemoryItem[];
  created: number;
  confirmed: number;
  corrected: number;
  superseded: number;
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function newId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Merges one call's facts into a customer's existing memory.
 *
 * Returns every item that changed, for the caller to persist. Items that were
 * untouched are not returned, so a call about billing does not rewrite
 * timestamps across a customer's whole history.
 */
export function mergeFacts(
  existing: MemoryItem[],
  facts: ExtractedFact[],
  context: { tenantId: string; customerId: string; callId: string; at: string }
): MergeOutcome {
  const { tenantId, customerId, callId, at } = context;

  const changed = new Map<string, MemoryItem>();
  const outcome: MergeOutcome = {
    items: [],
    created: 0,
    confirmed: 0,
    corrected: 0,
    superseded: 0,
  };

  // Working copy so several facts in one call see each other's effects.
  const working = existing.map((item) => ({ ...item }));

  // The active row for a key if there is one; otherwise the most recently
  // superseded, so a value that comes back is recognised as a return.
  const liveMatch = (key: string) =>
    working.find((item) => item.key === key && item.status === "active") ??
    working
      .filter((item) => item.key === key && item.status === "superseded")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  const record = (item: MemoryItem) => {
    changed.set(item.id, item);
    const index = working.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) working[index] = item;
    else working.push(item);
  };

  for (const fact of facts) {
    // ---- an explicit correction retires what it contradicts --------------
    if (fact.isCorrection) {
      const target = fact.corrects ?? fact.key;
      // The denial itself is also an active row for this key; it must never
      // retire itself when the same call is processed again.
      const current = working.find(
        (item) => item.key === target && item.status === "active" && item.value !== "false"
      );

      if (current) {
        record({
          ...current,
          status: "corrected",
          correctedByCallId: callId,
          updatedAt: at,
        });
        outcome.corrected++;
      }

      // The denial is itself worth remembering, so the same ground is not
      // covered again on the next call.
      const denial = working.find(
        (item) => item.key === target && item.value === "false" && item.status === "active"
      );

      if (!denial) {
        record({
          id: newId(),
          tenantId,
          customerId,
          category: fact.category,
          key: target,
          value: "false",
          phrase: fact.phrase,
          evidence: fact.evidence ?? null,
          confidence: fact.confidence,
          status: "active",
          sourceCallId: callId,
          lastConfirmedCallId: callId,
          callIds: [callId],
          correctedByCallId: null,
          firstObservedAt: at,
          lastConfirmedAt: at,
          createdAt: at,
          updatedAt: at,
        });
        outcome.created++;
      }
      continue;
    }

    // ---- a suppressed memory stays suppressed -----------------------------
    //
    // Someone deleted this from the customer's record. Hearing the same thing
    // again is not consent to bring it back.
    if (
      working.some(
        (item) => item.key === fact.key && item.status === "forgotten" && sameText(item.value, fact.value)
      )
    ) {
      continue;
    }

    // ---- a stated replacement retires what it replaces ---------------------
    //
    // Only rows with a different value: the replacement itself, seen again on
    // a redelivery, is not something to retire.
    for (const key of fact.replaces ?? []) {
      for (const item of working.filter(
        (candidate) =>
          candidate.key === key &&
          candidate.status === "active" &&
          !(key === fact.key && sameText(candidate.value, fact.value))
      )) {
        record({ ...item, status: "corrected", correctedByCallId: callId, updatedAt: at });
        outcome.corrected++;
      }
    }

    // ---- an existing memory for this key ---------------------------------
    const current = liveMatch(fact.key);

    if (!current) {
      record({
        id: newId(),
        tenantId,
        customerId,
        category: fact.category,
        key: fact.key,
        value: fact.value,
        phrase: fact.phrase,
        evidence: fact.evidence ?? null,
        confidence: fact.confidence,
        status: "active",
        sourceCallId: callId,
        lastConfirmedCallId: callId,
        callIds: [callId],
        correctedByCallId: null,
        firstObservedAt: at,
        lastConfirmedAt: at,
        createdAt: at,
        updatedAt: at,
      });
      outcome.created++;
      continue;
    }

    // A memory the customer has already denied is not revived by a pattern
    // match on a later call; only an explicit restatement should do that, and
    // that would arrive as a correction of the denial.
    if (current.status === "corrected") continue;

    const sameValue = sameText(current.value, fact.value);

    // Already learned or confirmed from this very call: a redelivery.
    if (
      (current.lastConfirmedCallId === callId || current.callIds?.includes(callId)) &&
      (sameValue || current.status === "active")
    ) {
      continue;
    }

    if (sameValue) {
      record({
        ...current,
        status: "active",
        confidence: Math.min(MAX_CONFIDENCE, current.confidence + CONFIRMATION_BOOST),
        lastConfirmedCallId: callId,
        callIds: withCall(current.callIds, callId),
        lastConfirmedAt: at,
        updatedAt: at,
        // A repeat of something previously superseded means it is current again.
        phrase: fact.phrase || current.phrase,
        evidence: fact.evidence ?? current.evidence ?? null,
      });
      outcome.confirmed++;
      continue;
    }

    // ---- same key, different value: the newer value takes over -----------
    //
    // This is a replacement, not a contradiction to adjudicate: a budget or a
    // timeline genuinely changes between calls. The old value is kept as
    // superseded so the change is traceable.
    if (current.status === "active") {
      record({ ...current, status: "superseded", updatedAt: at });
      outcome.superseded++;
    }

    record({
      id: newId(),
      tenantId,
      customerId,
      category: fact.category,
      key: fact.key,
      value: fact.value,
      phrase: fact.phrase,
      evidence: fact.evidence ?? null,
      confidence: fact.confidence,
      status: "active",
      sourceCallId: callId,
      lastConfirmedCallId: callId,
      callIds: [callId],
      correctedByCallId: null,
      firstObservedAt: current.firstObservedAt,
      lastConfirmedAt: at,
      createdAt: at,
      updatedAt: at,
    });
    outcome.created++;
  }

  outcome.items = [...changed.values()];
  return outcome;
}
