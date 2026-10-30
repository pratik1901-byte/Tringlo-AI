// ============================================================
// Tringlo AI — The preliminary history questionnaire
// ============================================================
//
// Nine questions, asked once each, to a patient the hospital has no record of,
// who has agreed to answer them.
//
// The limit is enforced here and not in the agent's prompt. A prompt is a
// request; this is the only thing that hands out a question, it will not hand
// out a tenth, and it will not hand out the same one twice. An agent that asks
// for more gets `null` and a reason.
//
// What this module will not do:
//
//   - It will not start for a returning patient, or for a caller who has not
//     been identified. Both of those are checked against the hospital's own
//     answer, not inferred here.
//   - It will not collect anything before consent is recorded.
//   - It will not interpret an answer. A symptom is stored as the patient's
//     words; nothing here decides what those words mean, including how urgent
//     they are.
//   - It will not keep going when the conversation turns out to need a person.
//     `escalate` ends the session and names the hospital's own protocol, or
//     says plainly that the hospital has not configured one.
// ============================================================

import {
  getMedicalHistoryByPatient,
  getOpenQuestionnaireSession,
  getQuestionnaireSession,
  getQuestionnaireSessions,
  saveQuestionnaireSession,
} from "@/lib/db";
import {
  MAX_QUESTIONNAIRE_QUESTIONS,
  QUESTIONNAIRE,
  QUESTION_IDS,
  type AnswerState,
  type ConsentRecord,
  type QuestionnaireAnswer,
  type QuestionnaireQuestion,
  type QuestionnaireSession,
} from "./records";
import type { IdentityResult } from "./identity";
import { audit, hospitalProfile } from "./service";

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** The statement a patient agrees to, so what they consented to is on record. */
export const CONSENT_STATEMENT =
  "Before your visit we would like to ask a few short questions about your health. Your answers are shared with the hospital's medical team and recorded in your hospital record. You can skip any question, and you do not have to answer at all. Is that alright?";

export type Started =
  | { ok: true; session: QuestionnaireSession; resumed: boolean }
  | { ok: false; problem: string; reason: "already_has_history" | "not_new" | "unidentified" };

/**
 * Opens a questionnaire for a new patient, or hands back the one already open.
 *
 * Resuming matters more than it looks: a dropped call that rings back should
 * carry on from question four, not start again at one, and starting again is
 * also how nine questions quietly becomes eighteen.
 */
export function startQuestionnaire(options: {
  tenantId: string;
  patientLeadId: string;
  identity: IdentityResult;
  callId?: string | null;
  demo?: boolean;
}): Started {
  const { tenantId, patientLeadId, identity } = options;

  if (identity.status === "unverified") {
    return {
      ok: false,
      reason: "unidentified",
      problem:
        "This caller has not been identified, so no medical history is collected for them. Ask for the information the hospital needs, or hand the call to staff.",
    };
  }
  if (identity.status === "returning") {
    return {
      ok: false,
      reason: "not_new",
      problem:
        "This patient is already known to the hospital. Their history is retrieved rather than collected again; anything about today goes in as visit information.",
    };
  }
  if (identity.canonicalPatientId && getMedicalHistoryByPatient(tenantId, identity.canonicalPatientId)) {
    return {
      ok: false,
      reason: "already_has_history",
      problem: "This patient already has a medical history on file. Use the update workflow rather than collecting a new one.",
    };
  }

  const open = getOpenQuestionnaireSession(tenantId, patientLeadId);
  if (open) return { ok: true, session: open, resumed: true };

  const now = new Date().toISOString();
  const session = saveQuestionnaireSession({
    id: ID("qs"),
    tenantId,
    patientLeadId,
    canonicalPatientId: identity.canonicalPatientId,
    patientStatus: identity.status,
    consent: null,
    answers: [],
    asked: [],
    status: "consent_pending",
    escalation: null,
    callId: options.callId ?? null,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    demo: Boolean(options.demo),
  });
  audit(tenantId, options.callId ?? "agent", "history.questionnaire_started", session.id, `patient ${patientLeadId}`);
  return { ok: true, session, resumed: false };
}

/** Records consent, or a refusal. A refusal ends the session there. */
export function recordConsent(
  tenantId: string,
  sessionId: string,
  consent: { granted: boolean; via: ConsentRecord["via"]; recordedBy: string; statement?: string }
): { ok: true; session: QuestionnaireSession } | { ok: false; problem: string } {
  const session = getQuestionnaireSession(tenantId, sessionId);
  if (!session) return { ok: false, problem: "No such questionnaire." };
  if (session.status === "complete" || session.status === "escalated") {
    return { ok: false, problem: "That questionnaire is already finished." };
  }

  const record: ConsentRecord = {
    granted: consent.granted,
    statement: consent.statement ?? CONSENT_STATEMENT,
    at: new Date().toISOString(),
    via: consent.via,
    recordedBy: consent.recordedBy,
  };

  const next = saveQuestionnaireSession({
    ...session,
    consent: record,
    // Declining is a complete answer, not a failure. Nothing further is asked.
    status: consent.granted ? "in_progress" : "abandoned",
  });
  audit(
    tenantId,
    consent.recordedBy,
    consent.granted ? "history.consent_given" : "history.consent_declined",
    sessionId,
    null
  );
  return { ok: true, session: next };
}

export interface NextQuestion {
  question: QuestionnaireQuestion | null;
  /** 1-based, for "question 4 of 9". */
  number: number;
  total: number;
  /** How many are still to come. */
  remaining: number;
  /** Why there is no question, when there is none. */
  done: string | null;
}

/**
 * The next question, or nothing.
 *
 * The single point at which a question is handed out, which is what makes the
 * limit real. Four things stop it:
 *
 *   - nine questions have been put to the patient,
 *   - every question has been answered or skipped,
 *   - consent has not been given, or was declined,
 *   - the session is finished or was escalated.
 */
export function nextQuestion(tenantId: string, sessionId: string): NextQuestion {
  const session = getQuestionnaireSession(tenantId, sessionId);
  const total = QUESTIONNAIRE.length;
  const none = (done: string): NextQuestion => ({ question: null, number: 0, total, remaining: 0, done });

  if (!session) return none("No such questionnaire.");
  if (session.status === "escalated") return none("This conversation was escalated, so the questionnaire stopped.");
  if (session.status === "complete") return none("The questionnaire is complete.");
  if (session.status === "abandoned") return none("The questionnaire was not continued.");
  if (!session.consent?.granted) return none("Consent has not been given, so no health questions are asked.");

  // The limit. Checked before anything else about which question is next,
  // because it does not matter which one it would have been.
  if (session.asked.length >= MAX_QUESTIONNAIRE_QUESTIONS) {
    return none(
      `All ${MAX_QUESTIONNAIRE_QUESTIONS} questions have been put to this patient. The questionnaire does not go beyond ${MAX_QUESTIONNAIRE_QUESTIONS} questions.`
    );
  }

  const answered = new Set(session.answers.map((answer) => answer.questionId));
  const question = QUESTIONNAIRE.find((entry) => !answered.has(entry.id) && !session.asked.includes(entry.id));

  if (!question) {
    // Everything has either been answered or already put to them once.
    const outstanding = QUESTIONNAIRE.filter((entry) => !answered.has(entry.id));
    if (outstanding.length === 0) return none("Every question has been answered or skipped.");
    return none("Every question has already been asked once; none is repeated.");
  }

  const asked = [...session.asked, question.id];
  saveQuestionnaireSession({ ...session, asked });

  return {
    question,
    number: asked.length,
    total,
    remaining: Math.min(total, MAX_QUESTIONNAIRE_QUESTIONS) - asked.length,
    done: null,
  };
}

export type AnswerResult = { ok: true; session: QuestionnaireSession } | { ok: false; problem: string };

/**
 * Records one answer.
 *
 * Idempotent by question: answering the same question again is refused rather
 * than appended, so a retried request or an agent that loops cannot produce
 * two answers to "do you have any allergies".
 */
export function recordAnswer(
  tenantId: string,
  sessionId: string,
  questionId: string,
  answer: { state: AnswerState; value?: string | null; note?: string | null }
): AnswerResult {
  const session = getQuestionnaireSession(tenantId, sessionId);
  if (!session) return { ok: false, problem: "No such questionnaire." };
  if (!QUESTION_IDS.includes(questionId)) {
    return { ok: false, problem: `"${questionId}" is not one of the ${QUESTIONNAIRE.length} questions.` };
  }
  if (session.status === "complete" || session.status === "escalated" || session.status === "abandoned") {
    return { ok: false, problem: "That questionnaire is no longer open." };
  }
  if (!session.consent?.granted) {
    return { ok: false, problem: "Consent has not been recorded, so no answer is stored." };
  }
  if (session.answers.some((entry) => entry.questionId === questionId)) {
    return { ok: false, problem: "That question has already been answered in this questionnaire." };
  }

  const now = new Date().toISOString();
  const value = answer.state === "answered" ? (answer.value ?? "").trim() : null;
  if (answer.state === "answered" && !value) {
    return { ok: false, problem: "An answered question needs the patient's answer. Record it as skipped instead." };
  }

  const entry: QuestionnaireAnswer = {
    questionId,
    askedAt: now,
    answeredAt: now,
    state: answer.state,
    value,
    note: answer.note ?? null,
  };

  // A question answered without having been handed out — staff entering it at
  // the desk — still counts against the nine.
  const asked = session.asked.includes(questionId) ? session.asked : [...session.asked, questionId];
  const answers = [...session.answers, entry];
  const finished = answers.length >= QUESTIONNAIRE.length || asked.length >= MAX_QUESTIONNAIRE_QUESTIONS;

  return {
    ok: true,
    session: saveQuestionnaireSession({
      ...session,
      asked,
      answers,
      status: finished ? "complete" : "in_progress",
      completedAt: finished ? now : null,
    }),
  };
}

/**
 * Stops the questionnaire because the call needs a person.
 *
 * Records the hospital's own protocol if it has one, and says plainly that it
 * does not if it does not — a hospital with no configured escalation procedure
 * should see that gap in its panel rather than have one improvised for it.
 */
export function escalate(
  tenantId: string,
  sessionId: string,
  reason: string,
  actor: string
): { ok: true; session: QuestionnaireSession; protocol: string } | { ok: false; problem: string } {
  const session = getQuestionnaireSession(tenantId, sessionId);
  if (!session) return { ok: false, problem: "No such questionnaire." };

  const profile = hospitalProfile(tenantId);
  const protocol =
    profile.escalationProtocol?.trim() ||
    "No escalation protocol has been configured for this hospital. Direct the caller to a qualified member of hospital staff.";

  const next = saveQuestionnaireSession({
    ...session,
    status: "escalated",
    escalation: { at: new Date().toISOString(), reason, protocol },
    completedAt: new Date().toISOString(),
  });
  audit(tenantId, actor, "history.escalated", sessionId, reason);
  return { ok: true, session: next, protocol };
}

export function abandonQuestionnaire(tenantId: string, sessionId: string, actor: string): boolean {
  const session = getQuestionnaireSession(tenantId, sessionId);
  if (!session || session.status === "complete" || session.status === "escalated") return false;
  saveQuestionnaireSession({ ...session, status: "abandoned" });
  audit(tenantId, actor, "history.questionnaire_abandoned", sessionId, null);
  return true;
}

/** How far along a session is, for the panel's progress indicator. */
export function sessionProgress(session: QuestionnaireSession) {
  const answered = session.answers.filter((answer) => answer.state === "answered").length;
  const skipped = session.answers.filter((answer) => answer.state !== "answered").length;
  return {
    asked: session.asked.length,
    answered,
    skipped,
    total: QUESTIONNAIRE.length,
    limit: MAX_QUESTIONNAIRE_QUESTIONS,
    /** Never above the limit, whatever is in the record. */
    remaining: Math.max(0, Math.min(QUESTIONNAIRE.length, MAX_QUESTIONNAIRE_QUESTIONS) - session.asked.length),
  };
}

export function listSessions(tenantId: string): QuestionnaireSession[] {
  return getQuestionnaireSessions(tenantId)
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
