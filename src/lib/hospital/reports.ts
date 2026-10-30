// ============================================================
// Tringlo AI — The preliminary history report
// ============================================================
//
// What a clinician actually reads: the nine questions, what the patient said
// to each, and what they did not answer, assembled for a person to review.
//
// The things it is careful not to be:
//
//   - It is not a summary. Nothing is condensed, rephrased or interpreted; an
//     answer appears as the patient gave it, and a question with no answer
//     appears as a question with no answer rather than being quietly dropped.
//   - It is not a clinical document. `REPORT_DISCLAIMER` is on every one, and
//     there is nowhere in the structure for a conclusion to be written.
//   - It is not submitted until a destination says so. `submitted` is set from
//     a receipt and from nothing else; a failure keeps the reason and stays
//     visible in the panel as a report that has not been delivered.
// ============================================================

import { getHistoryReport, getHistoryReports, getMedicalHistory, getQuestionnaireSession, saveHistoryReport } from "@/lib/db";
import { hospitalServer, integrationConfig } from "./his";
import {
  QUESTIONNAIRE,
  REPORT_DISCLAIMER,
  type HistoryReport,
  type MedicalHistoryRecord,
  type QuestionnaireSession,
  type ReportStatus,
} from "./records";
import { audit, hospitalProfile } from "./service";

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export { REPORT_DISCLAIMER };

/**
 * Builds the report for a finished questionnaire.
 *
 * One report per session: asked again, it rebuilds the same one rather than
 * stacking up copies of the same conversation in the review queue.
 */
export function buildReport(
  tenantId: string,
  sessionId: string,
  historyId: string,
  actor: string
): { ok: true; report: HistoryReport } | { ok: false; problem: string } {
  const session = getQuestionnaireSession(tenantId, sessionId);
  if (!session) return { ok: false, problem: "No such questionnaire." };
  const history = getMedicalHistory(tenantId, historyId);
  if (!history) return { ok: false, problem: "No such medical history." };

  const existing = getHistoryReports(tenantId).find((report) => report.sessionId === sessionId);
  const destination = integrationConfig(tenantId).reportDestination;
  const now = new Date().toISOString();

  const answers = QUESTIONNAIRE.map((question) => {
    const answer = session.answers.find((entry) => entry.questionId === question.id);
    return {
      questionId: question.id,
      label: question.label,
      prompt: question.prompt,
      state: answer?.state ?? ("unknown" as const),
      // Only ever what the patient said. Never a filled-in blank.
      value: answer?.state === "answered" ? answer.value : null,
    };
  });

  const report: HistoryReport = {
    id: existing?.id ?? ID("rep"),
    tenantId,
    historyId: history.id,
    sessionId: session.id,
    canonicalPatientId: history.provisional ? null : history.canonicalPatientId,
    patientLeadId: session.patientLeadId,
    patientName: history.patientName,
    patientStatus: session.patientStatus,
    collectedAt: session.completedAt ?? session.startedAt,
    consent: session.consent,
    answers,
    skipped: session.answers.filter((answer) => answer.state === "skipped").map((answer) => answer.questionId),
    unanswered: answers.filter((answer) => answer.state === "unknown").map((answer) => answer.questionId),
    notes: administrativeNotes(session, history),
    // Ready as soon as it is complete; a session cut short is a draft, because
    // a half-finished history going into a review queue as finished is how it
    // gets read as the whole picture.
    status: existing?.status === "submitted" || existing?.status === "reviewed" ? existing.status : session.status === "complete" ? "ready" : "draft",
    destination,
    submittedAt: existing?.submittedAt ?? null,
    failureReason: existing?.failureReason ?? null,
    attempts: existing?.attempts ?? 0,
    reviewedBy: existing?.reviewedBy ?? null,
    reviewedAt: existing?.reviewedAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    demo: session.demo,
  };

  const saved = saveHistoryReport(report);
  if (!existing) audit(tenantId, actor, "report.created", saved.id, `session ${sessionId}`);
  return { ok: true, report: saved };
}

/**
 * Administrative notes only — where the record is held, and whether the
 * conversation ended early. Nothing clinical, and nothing inferred about the
 * patient.
 */
function administrativeNotes(session: QuestionnaireSession, history: MedicalHistoryRecord): string | null {
  const notes: string[] = [];
  if (session.status === "escalated" && session.escalation) {
    notes.push(`The conversation was escalated before the questionnaire finished: ${session.escalation.reason}`);
  }
  if (session.status === "abandoned") notes.push("The questionnaire was not completed.");
  if (history.provisional) {
    notes.push("This patient has no hospital patient id yet, so the record is held under a provisional identifier.");
  }
  if (history.sync.state === "unsupported" || history.sync.state === "failed") {
    notes.push(history.sync.problem ?? "The record has not reached the hospital's system.");
  }
  if (session.asked.length < QUESTIONNAIRE.length) {
    notes.push(`${session.asked.length} of ${QUESTIONNAIRE.length} questions were put to the patient.`);
  }
  return notes.length ? notes.join(" ") : null;
}

export type SubmitResult =
  | { ok: true; report: HistoryReport; destination: "hospital_server" | "panel_review"; reference: string | null }
  | { ok: false; report: HistoryReport; problem: string };

/**
 * Sends a report to wherever this hospital has said reports go.
 *
 * Marked `submitted` only on a receipt. The panel-review destination is not a
 * submission at all — it is the report sitting here waiting for somebody, and
 * it says `ready`, because calling that "submitted" would tell a hospital
 * their report had gone somewhere it has not.
 */
export async function submitReport(tenantId: string, reportId: string, actor: string): Promise<SubmitResult> {
  const report = getHistoryReport(tenantId, reportId);
  if (!report) {
    throw new Error("No such report.");
  }
  if (report.status === "draft") {
    return { ok: false, report, problem: "This report is still a draft: the questionnaire was not completed." };
  }
  if (report.status === "submitted") {
    // Already delivered. Sending it twice is a duplicate in somebody's queue.
    return { ok: true, report, destination: report.destination, reference: null };
  }

  if (report.destination === "panel_review") {
    return {
      ok: true,
      report: saveHistoryReport({ ...report, status: "ready", failureReason: null }),
      destination: "panel_review",
      reference: null,
    };
  }

  const server = hospitalServer(tenantId);
  if (!server.supports("report_submit")) {
    const failed = saveHistoryReport({
      ...report,
      status: "failed",
      attempts: report.attempts + 1,
      failureReason:
        "The hospital's API has no configured endpoint for history reports, so the report has not been submitted. It is available here for review.",
    });
    return { ok: false, report: failed, problem: failed.failureReason! };
  }

  const result = await server.submitReport(payloadFor(tenantId, report));
  if (!result.ok) {
    const failed = saveHistoryReport({
      ...report,
      status: "failed",
      attempts: report.attempts + 1,
      failureReason: result.problem,
    });
    audit(tenantId, actor, "report.submission_failed", report.id, result.problem);
    return { ok: false, report: failed, problem: result.problem };
  }

  const submitted = saveHistoryReport({
    ...report,
    status: "submitted",
    attempts: report.attempts + 1,
    submittedAt: result.data.acceptedAt,
    failureReason: null,
  });
  audit(tenantId, actor, "report.submitted", report.id, result.data.reference);
  return { ok: true, report: submitted, destination: "hospital_server", reference: result.data.reference };
}

/** What is actually sent. Carries its own disclaimer so the receiver sees it. */
export function payloadFor(tenantId: string, report: HistoryReport) {
  const profile = hospitalProfile(tenantId);
  return {
    kind: "preliminary_patient_reported_history",
    disclaimer: REPORT_DISCLAIMER,
    hospital: profile.name,
    patient: {
      patientId: report.canonicalPatientId,
      name: report.patientName,
      status: report.patientStatus,
    },
    collectedAt: report.collectedAt,
    consent: report.consent,
    answers: report.answers.map((answer) => ({
      question: answer.prompt,
      questionId: answer.questionId,
      state: answer.state,
      answer: answer.value,
    })),
    skipped: report.skipped,
    unanswered: report.unanswered,
    notes: report.notes,
    collectedBy: "Tringlo AI voice assistant",
    demo: report.demo,
  };
}

/** A human has read it. Only a person can set this. */
export function markReviewed(tenantId: string, reportId: string, reviewer: string): HistoryReport | null {
  const report = getHistoryReport(tenantId, reportId);
  if (!report) return null;
  if (report.status === "draft") return null;
  const next = saveHistoryReport({
    ...report,
    status: "reviewed",
    reviewedBy: reviewer,
    reviewedAt: new Date().toISOString(),
  });
  audit(tenantId, reviewer, "report.reviewed", reportId, null);
  return next;
}

export function listReports(tenantId: string, status?: ReportStatus): HistoryReport[] {
  return getHistoryReports(tenantId)
    .filter((report) => !status || report.status === status)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

/** Reports a clinician has not looked at yet, for the dashboard. */
export function awaitingReview(tenantId: string): HistoryReport[] {
  return getHistoryReports(tenantId)
    .filter((report) => report.status === "ready" || report.status === "failed")
    .sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
}
