// ============================================================
// Dialo AI — Memory Merge
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
// Nothing is ever destroyed here. Retired memories keep the call id that
// retired them, which is what makes §6's provenance question answerable.
// ============================================================

import type { ExtractedFact, MemoryItem } from "./types";

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

  const liveMatch = (key: string) =>
    working.find(
      (item) =>
        item.key === key && (item.status === "active" || item.status === "superseded")
    );

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
      const current = working.find(
        (item) => item.key === target && item.status === "active"
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
          confidence: fact.confidence,
          status: "active",
          sourceCallId: callId,
          lastConfirmedCallId: callId,
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
        confidence: fact.confidence,
        status: "active",
        sourceCallId: callId,
        lastConfirmedCallId: callId,
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

    const sameValue = current.value.trim().toLowerCase() === fact.value.trim().toLowerCase();

    if (sameValue) {
      record({
        ...current,
        status: "active",
        confidence: Math.min(MAX_CONFIDENCE, current.confidence + CONFIRMATION_BOOST),
        lastConfirmedCallId: callId,
        lastConfirmedAt: at,
        updatedAt: at,
        // A repeat of something previously superseded means it is current again.
        phrase: fact.phrase || current.phrase,
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
      confidence: fact.confidence,
      status: "active",
      sourceCallId: callId,
      lastConfirmedCallId: callId,
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
