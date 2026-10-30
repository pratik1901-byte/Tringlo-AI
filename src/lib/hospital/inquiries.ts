// ============================================================
// Tringlo AI — Inquiries and reception
// ============================================================
//
// The ordinary questions a reception desk answers all day: which department,
// what time do you open, where do I park, how do I book. None of it clinical,
// all of it factual, and all of it the hospital's own words.
//
// The rule that shapes this module: the agent answers from approved text or it
// does not answer. There is no "best effort" path, because the failure mode of
// a best effort here is an agent confidently telling a patient the wrong
// visiting hours, or inventing a price.
//
// So a question that finds no approved answer produces an `UnansweredInquiry`
// — a row in a list the hospital can work through — and the agent says it will
// have the answer confirmed, offering whoever the hospital has nominated. That
// list is the backlog of FAQs nobody has written yet, which is a more useful
// thing to have than a plausible guess.
// ============================================================

import {
  deleteHospitalFaq,
  getHospitalFaqs,
  getUnansweredInquiries,
  getUnansweredInquiry,
  recordFaqUse,
  saveHospitalFaq,
  saveUnansweredInquiry,
} from "@/lib/db";
import type { HospitalFaq } from "./types";
import type { UnansweredInquiry } from "./records";
import { audit, hospitalProfile } from "./service";

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * The categories the panel groups by.
 *
 * Suggestions for the dropdown, not a closed set — a hospital may type its
 * own. Nothing here asserts a fact about any hospital's services.
 */
export const FAQ_CATEGORIES = [
  "Departments and services",
  "Operating hours",
  "Location and directions",
  "Appointment booking",
  "Administrative",
  "Contact and reception",
  "Other",
];

// ------------------------------------------------------------
// Managing the approved answers
// ------------------------------------------------------------

export type FaqResult = { ok: true; faq: HospitalFaq } | { ok: false; problem: string };

export function saveFaq(
  tenantId: string,
  input: { id?: string | null; question: string; answer: string; topic?: string | null; active?: boolean },
  actor: string
): FaqResult {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (!question) return { ok: false, problem: "A FAQ needs a question." };
  if (!answer) return { ok: false, problem: "A FAQ needs the approved answer the agent should give." };

  const existing = input.id ? getHospitalFaqs(tenantId).find((faq) => faq.id === input.id) : undefined;
  if (input.id && !existing) return { ok: false, problem: "No such FAQ." };

  const now = new Date().toISOString();
  const faq = saveHospitalFaq({
    id: existing?.id ?? ID("faq"),
    tenantId,
    question,
    answer,
    topic: input.topic ?? existing?.topic ?? null,
    active: input.active ?? existing?.active ?? true,
    demo: existing?.demo ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
  audit(tenantId, actor, existing ? "faq.updated" : "faq.created", faq.id, question.slice(0, 120));
  return { ok: true, faq };
}

export function setFaqActive(tenantId: string, id: string, active: boolean, actor: string): FaqResult {
  const faq = getHospitalFaqs(tenantId).find((entry) => entry.id === id);
  if (!faq) return { ok: false, problem: "No such FAQ." };
  const next = saveHospitalFaq({ ...faq, active });
  audit(tenantId, actor, active ? "faq.enabled" : "faq.disabled", id, null);
  return { ok: true, faq: next };
}

export function removeFaq(tenantId: string, id: string, actor: string): boolean {
  const faq = getHospitalFaqs(tenantId).find((entry) => entry.id === id);
  if (!faq) return false;
  audit(tenantId, actor, "faq.deleted", id, faq.question.slice(0, 120));
  return deleteHospitalFaq(tenantId, id);
}

export function listFaqs(
  tenantId: string,
  options: { search?: string; category?: string; includeInactive?: boolean } = {}
): HospitalFaq[] {
  const search = (options.search ?? "").trim().toLowerCase();
  return getHospitalFaqs(tenantId)
    .filter((faq) => {
      if (!options.includeInactive && !faq.active) return false;
      if (options.category && (faq.topic ?? "Other") !== options.category) return false;
      if (search && !`${faq.question} ${faq.answer}`.toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a, b) => (a.topic ?? "").localeCompare(b.topic ?? "") || a.question.localeCompare(b.question));
}

// ------------------------------------------------------------
// Answering one
// ------------------------------------------------------------

export interface InquiryAnswer {
  answered: boolean;
  /** The approved answer, word for word. Null when there is none. */
  answer: string | null;
  faqId: string | null;
  question: string | null;
  /** What to say instead, when there is no approved answer. */
  fallback: string | null;
  /** Who the caller should be handed to, when the hospital has said. */
  staffContact: string | null;
  /** The row left behind for staff, when nothing matched. */
  inquiryId: string | null;
}

/**
 * Finds the approved answer to a question, or records that there wasn't one.
 *
 * The matching is deliberately plain — the words of the question against the
 * words of each FAQ. It does not paraphrase and it does not stretch: a near
 * miss returning the wrong approved answer is worse than an honest "I will
 * have that confirmed for you", because the near miss sounds authoritative.
 */
export function answerInquiry(options: {
  tenantId: string;
  question: string;
  callId?: string | null;
  patientLeadId?: string | null;
  demo?: boolean;
}): InquiryAnswer {
  const question = options.question.trim();
  const profile = hospitalProfile(options.tenantId);
  const staffContact = profile.staffContact?.trim() || null;

  const match = question ? bestMatch(getHospitalFaqs(options.tenantId).filter((faq) => faq.active), question) : null;

  if (match) {
    // Counted so the hospital can see which approved answers are being used.
    // Deliberately not through `saveHospitalFaq`, which would move the
    // answer's own last-updated timestamp.
    recordFaqUse(options.tenantId, match.faq.id);
    return {
      answered: true,
      answer: match.faq.answer,
      faqId: match.faq.id,
      question: match.faq.question,
      fallback: null,
      staffContact,
      inquiryId: null,
    };
  }

  const inquiry = saveUnansweredInquiry({
    id: ID("inq"),
    tenantId: options.tenantId,
    at: new Date().toISOString(),
    question: question || "(nothing was recorded)",
    callId: options.callId ?? null,
    patientLeadId: options.patientLeadId ?? null,
    handoff: Boolean(staffContact),
    status: "open",
    resolvedFaqId: null,
    resolvedBy: null,
    resolvedAt: null,
    demo: Boolean(options.demo),
  });

  return {
    answered: false,
    answer: null,
    faqId: null,
    question: null,
    fallback: staffContact
      ? "Tell the caller that this needs to be confirmed by the hospital, and offer to put them through or pass on their number."
      : "Tell the caller that this needs to be confirmed by the hospital, and that a member of staff will come back to them. Do not answer from general knowledge.",
    staffContact,
    inquiryId: inquiry.id,
  };
}

/**
 * The best approved answer for a question, if one is clearly the best.
 *
 * Scored on how much of the FAQ's own wording the question actually uses.
 * A minimum of two matching words of substance, so "hours" alone does not
 * confidently return the FAQ about theatre hours.
 */
function bestMatch(faqs: HospitalFaq[], question: string): { faq: HospitalFaq; score: number } | null {
  const asked = new Set(words(question));
  if (asked.size === 0) return null;

  let best: { faq: HospitalFaq; score: number } | null = null;
  for (const faq of faqs) {
    const theirs = words(faq.question);
    if (theirs.length === 0) continue;
    const hits = theirs.filter((word) => asked.has(word)).length;
    if (hits < 2) continue;
    const score = hits / theirs.length;
    if (score < 0.4) continue;
    if (!best || score > best.score) best = { faq, score };
  }
  return best;
}

/** Words worth matching on: the short, everywhere ones are no evidence. */
const NOISE = new Set([
  "the", "a", "an", "is", "are", "do", "does", "did", "what", "when", "where", "how", "can", "i", "you", "my",
  "me", "to", "of", "in", "on", "at", "for", "and", "or", "it", "be", "have", "has", "there", "any", "your",
  "we", "please", "tell", "about", "with", "from", "this", "that",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !NOISE.has(word));
}

// ------------------------------------------------------------
// The backlog
// ------------------------------------------------------------

export function listUnanswered(tenantId: string, options: { status?: UnansweredInquiry["status"] } = {}): UnansweredInquiry[] {
  return getUnansweredInquiries(tenantId)
    .filter((inquiry) => !options.status || inquiry.status === options.status)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Writes the FAQ that answers an outstanding inquiry, and closes it. */
export function resolveInquiry(
  tenantId: string,
  inquiryId: string,
  resolution: { answer?: string; faqId?: string; dismiss?: boolean; topic?: string | null },
  actor: string
): { ok: true; inquiry: UnansweredInquiry; faq: HospitalFaq | null } | { ok: false; problem: string } {
  const inquiry = getUnansweredInquiry(tenantId, inquiryId);
  if (!inquiry) return { ok: false, problem: "No such inquiry." };

  if (resolution.dismiss) {
    const dismissed = saveUnansweredInquiry({
      ...inquiry,
      status: "dismissed",
      resolvedBy: actor,
      resolvedAt: new Date().toISOString(),
    });
    audit(tenantId, actor, "inquiry.dismissed", inquiryId, null);
    return { ok: true, inquiry: dismissed, faq: null };
  }

  let faq: HospitalFaq | null = null;
  if (resolution.faqId) {
    faq = getHospitalFaqs(tenantId).find((entry) => entry.id === resolution.faqId) ?? null;
    if (!faq) return { ok: false, problem: "No such FAQ." };
  } else if (resolution.answer?.trim()) {
    const created = saveFaq(
      tenantId,
      { question: inquiry.question, answer: resolution.answer, topic: resolution.topic ?? null, active: true },
      actor
    );
    if (!created.ok) return created;
    faq = created.faq;
  } else {
    return { ok: false, problem: "Give the approved answer, or choose an existing FAQ." };
  }

  const resolved = saveUnansweredInquiry({
    ...inquiry,
    status: "answered",
    resolvedFaqId: faq.id,
    resolvedBy: actor,
    resolvedAt: new Date().toISOString(),
  });
  audit(tenantId, actor, "inquiry.answered", inquiryId, faq.id);
  return { ok: true, inquiry: resolved, faq };
}
