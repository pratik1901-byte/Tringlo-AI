// ============================================================
// Dialo AI — Customer Memory Schema
// ============================================================
//
// What Dialo learned about one customer, as structured facts rather than as
// transcripts.
//
// The distinction matters. A transcript is evidence; a memory is a claim
// derived from it. Keeping them apart is what makes correction possible: when
// someone says "no, I meant my cousin", there is a specific claim to retract,
// which there would not be if the long-term store were a pile of past
// conversations pasted into the prompt.
//
// Every item records where it came from and how sure Dialo is, so nothing is
// ever presented to the agent as more certain than the conversation supports.
// ============================================================

/**
 * Categories, kept few on purpose.
 *
 * Each one exists because it changes whether a fact is worth telling the agent
 * during a given call, which is what the relevance layer selects on. A finer
 * taxonomy would not change any decision.
 */
export type MemoryCategory =
  /** Who they are: role, company, location. */
  | "profile"
  /** How they want to be dealt with: language, timing, channel. */
  | "preferences"
  /** What they are trying to achieve. */
  | "needs"
  /** What is going wrong for them today. */
  | "pain_points"
  /** Why they said no, so it is not walked into again. */
  | "objections"
  /** Personal context they volunteered: family, studies, circumstances. */
  | "personal_context"
  /** Their business context: team size, tooling, budget cycle. */
  | "business_context"
  /** What either side promised to do. */
  | "commitments";

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "profile",
  "preferences",
  "needs",
  "pain_points",
  "objections",
  "personal_context",
  "business_context",
  "commitments",
];

/** Personal life is withheld when Dialo is not confident who it is talking to. */
export const SENSITIVE_CATEGORIES: MemoryCategory[] = ["personal_context"];

export type MemoryStatus =
  /** Believed true, and eligible to be given to the agent. */
  | "active"
  /** The customer said this is wrong. Kept for provenance, never sent. */
  | "corrected"
  /** Superseded by a newer value of the same key. */
  | "superseded"
  /** The customer asked Dialo to forget it. Never sent, and purgeable. */
  | "forgotten";

export interface MemoryItem {
  id: string;
  /** Owning business. Memory never crosses a tenant boundary. */
  tenantId: string;
  /** Stable customer identity from lib/customers/identity. */
  customerId: string;

  category: MemoryCategory;
  /** Stable snake_case slug, e.g. `has_younger_sister`. The identity of a fact. */
  key: string;
  /** Human-readable value: "true", "2 people", "prefers Kannada". */
  value: string;
  /**
   * What the agent may say, in the customer's own framing.
   *
   * Stored because "has_younger_sister=true" is not something anyone should
   * read aloud, and reconstructing a natural phrase from a slug at call time
   * produces exactly the robotic delivery §11 forbids.
   */
  phrase: string;

  /** 0–1. Below CONFIDENCE_FLOOR a memory is never given to the agent. */
  confidence: number;
  status: MemoryStatus;

  /** The call this was learned from, and the one that last confirmed it. */
  sourceCallId: string | null;
  lastConfirmedCallId: string | null;
  /** Set when a later call corrected this item, for traceability. */
  correctedByCallId: string | null;

  firstObservedAt: string;
  lastConfirmedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A customer's profile: identity plus the running summary of recent calls.
 *
 * Summaries live here rather than as memory items because they are a rolling
 * narrative, not durable facts, and they age out. A fact from eight months ago
 * may still be true; a call summary from eight months ago is history.
 */
export interface CustomerProfile {
  id: string;
  tenantId: string;

  /** Ten-digit national number — the lookup key. */
  phoneNational: string;
  phoneE164: string | null;

  /** Every name seen for this number, most recent first. */
  names: string[];
  /**
   * Set when a clearly different name appears for the same number.
   *
   * While true, personal context is withheld from call context: Dialo is not
   * confident enough about who is answering to repeat private details.
   */
  identityAmbiguous: boolean;

  /** Lead rows that resolved to this person, for tracing back. */
  leadIds: string[];

  recentSummaries: CallSummary[];

  createdAt: string;
  updatedAt: string;
}

/** The condensed record of one conversation. */
export interface CallSummary {
  callId: string;
  at: string;
  /** Provider-reported seconds; null when it reported none. */
  durationSeconds: number | null;
  /** The agent's own summary of the call. Null when it produced none. */
  summary: string | null;
  interest: string | null;
  objection: string | null;
  nextStep: string | null;
  /** True when this call was itself a scheduled callback. */
  wasFollowUp: boolean;
}

/** Nothing below this is given to the agent, or shown as settled fact. */
export const CONFIDENCE_FLOOR = 0.5;

/** How many call summaries to keep. Older ones stop being conversationally useful. */
export const MAX_RECENT_SUMMARIES = 5;

/** A fact the extractor produced, before it has been merged into the store. */
export interface ExtractedFact {
  category: MemoryCategory;
  key: string;
  value: string;
  phrase: string;
  confidence: number;
  /**
   * True when the customer explicitly contradicted something, as opposed to
   * simply adding new information. Only an explicit correction may overturn an
   * existing memory; otherwise two compatible facts both stand.
   */
  isCorrection?: boolean;
  /** The key being corrected, when it differs from this fact's own key. */
  corrects?: string;
}
