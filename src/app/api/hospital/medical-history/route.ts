// ============================================================
// Hospital — medical history, questionnaires and reports
// ============================================================
//
// Three things live behind this one endpoint because they are three views of
// one workflow: the questionnaire being answered, the single longitudinal
// record it writes to, and the report a clinician reads.
//
// The limit on questions is enforced in `@/lib/hospital/questionnaire`, not
// here. This route cannot ask for a tenth question — there is no parameter for
// it — and if it tried, `nextQuestion` would hand back nothing.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { getLeads, getQuestionnaireSession } from "@/lib/db";
import { identifyPatient } from "@/lib/hospital/identity";
import {
  adoptCanonicalId,
  historyView,
  listHistories,
  recordVisitNote,
  updateHistory,
  visitNotesFor,
  writeHistoryFromSession,
} from "@/lib/hospital/history";
import {
  CONSENT_STATEMENT,
  abandonQuestionnaire,
  escalate,
  listSessions,
  nextQuestion,
  recordAnswer,
  recordConsent,
  sessionProgress,
  startQuestionnaire,
} from "@/lib/hospital/questionnaire";
import { QUESTIONNAIRE, MAX_QUESTIONNAIRE_QUESTIONS, REPORT_DISCLAIMER } from "@/lib/hospital/records";
import { awaitingReview, buildReport, listReports, markReviewed, submitReport } from "@/lib/hospital/reports";
import { patientFor } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");

  // One questionnaire in progress, for the panel's own intake screen.
  if (sessionId) {
    const session = getQuestionnaireSession(auth.tenantId, sessionId);
    if (!session) {
      return NextResponse.json({ error: { message: "No such questionnaire." } }, { status: 404, headers: noStore });
    }
    return NextResponse.json(
      {
        session,
        progress: sessionProgress(session),
        questions: QUESTIONNAIRE,
        consentStatement: CONSENT_STATEMENT,
      },
      { headers: noStore }
    );
  }

  const histories = listHistories(auth.tenantId);
  return NextResponse.json(
    {
      questions: QUESTIONNAIRE,
      limit: MAX_QUESTIONNAIRE_QUESTIONS,
      disclaimer: REPORT_DISCLAIMER,
      consentStatement: CONSENT_STATEMENT,
      histories: histories.map(historyView),
      sessions: listSessions(auth.tenantId).map((session) => ({
        ...session,
        progress: sessionProgress(session),
      })),
      reports: listReports(auth.tenantId),
      awaitingReview: awaitingReview(auth.tenantId).length,
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "");
  const fail = (message: string, status = 400) =>
    NextResponse.json({ error: { message } }, { status, headers: noStore });

  switch (action) {
    // ---------------- running a questionnaire ----------------
    case "start": {
      const phone = String(body?.phone ?? "").trim();
      if (!phone) return fail("A phone number is needed to open a questionnaire.");

      // Identity decides whether there should be a questionnaire at all, and
      // it is asked here rather than taken from the caller's say-so.
      const identity = await identifyPatient(auth.tenantId, {
        phone,
        name: typeof body?.name === "string" ? body.name.trim() : null,
        dateOfBirth: typeof body?.dateOfBirth === "string" ? body.dateOfBirth.trim() : null,
        patientId: typeof body?.patientId === "string" ? body.patientId.trim() : null,
      });

      const patient = patientFor(auth.tenantId, phone, typeof body?.name === "string" ? body.name : undefined);
      const started = startQuestionnaire({
        tenantId: auth.tenantId,
        patientLeadId: patient.id,
        identity,
        callId: typeof body?.callId === "string" ? body.callId : null,
        demo: Boolean(body?.demo),
      });
      if (!started.ok) {
        return NextResponse.json(
          { error: { message: started.problem, reason: started.reason }, identity: { status: identity.status, reason: identity.reason } },
          { status: 409, headers: noStore }
        );
      }
      return NextResponse.json(
        {
          session: started.session,
          resumed: started.resumed,
          progress: sessionProgress(started.session),
          identity: { status: identity.status, reason: identity.reason },
          consentStatement: CONSENT_STATEMENT,
        },
        { status: started.resumed ? 200 : 201, headers: noStore }
      );
    }

    case "consent": {
      const result = recordConsent(auth.tenantId, String(body?.sessionId ?? ""), {
        granted: Boolean(body?.granted),
        via: body?.via === "voice" ? "voice" : "staff",
        recordedBy: auth.user.id,
      });
      if (!result.ok) return fail(result.problem);
      return NextResponse.json({ session: result.session, progress: sessionProgress(result.session) }, { headers: noStore });
    }

    case "next": {
      const next = nextQuestion(auth.tenantId, String(body?.sessionId ?? ""));
      return NextResponse.json(next, { headers: noStore });
    }

    case "answer": {
      const state = body?.state === "skipped" || body?.state === "unknown" ? body.state : "answered";
      const result = recordAnswer(auth.tenantId, String(body?.sessionId ?? ""), String(body?.questionId ?? ""), {
        state,
        value: typeof body?.value === "string" ? body.value : null,
        note: typeof body?.note === "string" ? body.note : null,
      });
      if (!result.ok) return fail(result.problem, 409);
      return NextResponse.json({ session: result.session, progress: sessionProgress(result.session) }, { headers: noStore });
    }

    case "escalate": {
      const result = escalate(
        auth.tenantId,
        String(body?.sessionId ?? ""),
        String(body?.reason ?? "").trim() || "No reason was recorded.",
        auth.user.id
      );
      if (!result.ok) return fail(result.problem);
      return NextResponse.json({ session: result.session, protocol: result.protocol }, { headers: noStore });
    }

    case "abandon": {
      const done = abandonQuestionnaire(auth.tenantId, String(body?.sessionId ?? ""), auth.user.id);
      return done ? NextResponse.json({ ok: true }, { headers: noStore }) : fail("That questionnaire cannot be abandoned.");
    }

    // ---------------- writing it down ----------------
    case "finish": {
      const sessionId = String(body?.sessionId ?? "");
      const written = await writeHistoryFromSession(auth.tenantId, sessionId, auth.user.id);
      if (!written.ok) return fail(written.problem, 409);

      const report = buildReport(auth.tenantId, sessionId, written.history.id, auth.user.id);
      if (!report.ok) return fail(report.problem);

      return NextResponse.json(
        {
          history: historyView(written.history),
          // Says plainly whether this was a new record or a revision of the
          // one the patient already had.
          created: written.created,
          revision: written.revision,
          report: report.report,
        },
        { headers: noStore }
      );
    }

    case "submit-report": {
      const result = await submitReport(auth.tenantId, String(body?.reportId ?? ""), auth.user.id);
      if (!result.ok) {
        // 200 with ok:false — the request worked, the submission did not, and
        // the panel needs the report's new state to show that.
        return NextResponse.json({ ok: false, report: result.report, problem: result.problem }, { headers: noStore });
      }
      return NextResponse.json(
        { ok: true, report: result.report, destination: result.destination, reference: result.reference },
        { headers: noStore }
      );
    }

    case "review": {
      const report = markReviewed(auth.tenantId, String(body?.reportId ?? ""), auth.user.id);
      return report
        ? NextResponse.json({ report }, { headers: noStore })
        : fail("That report cannot be marked reviewed.");
    }

    // ---------------- changing an existing history ----------------
    case "update": {
      const changes = body?.changes;
      if (!changes || typeof changes !== "object") return fail("Nothing to change.");
      const result = await updateHistory(
        auth.tenantId,
        String(body?.historyId ?? ""),
        changes as Record<string, { state: "answered" | "skipped" | "unknown"; value?: string | null }>,
        auth.user.id,
        typeof body?.note === "string" ? body.note : null
      );
      if (!result.ok) return fail(result.problem);
      return NextResponse.json(
        { history: historyView(result.history), revision: result.revision },
        { headers: noStore }
      );
    }

    case "adopt-patient-id": {
      const result = await adoptCanonicalId(
        auth.tenantId,
        String(body?.historyId ?? ""),
        String(body?.patientId ?? ""),
        auth.user.id
      );
      if (!result.ok) return fail(result.problem);
      return NextResponse.json({ history: historyView(result.history), merged: result.merged }, { headers: noStore });
    }

    case "visit-note": {
      const phone = String(body?.phone ?? "").trim();
      const leadId = String(body?.patientLeadId ?? "").trim();
      const patient = leadId
        ? getLeads().find((lead) => lead.tenantId === auth.tenantId && lead.id === leadId)
        : phone
          ? patientFor(auth.tenantId, phone)
          : null;
      if (!patient) return fail("That patient is not in this hospital's records.");

      const note = recordVisitNote({
        tenantId: auth.tenantId,
        patientLeadId: patient.id,
        canonicalPatientId: typeof body?.patientId === "string" ? body.patientId : null,
        appointmentId: typeof body?.appointmentId === "string" ? body.appointmentId : null,
        callId: typeof body?.callId === "string" ? body.callId : null,
        note: String(body?.note ?? ""),
        recordedBy: auth.user.id,
        demo: Boolean(body?.demo),
      });
      if (!note) return fail("A visit note needs something in it.");
      return NextResponse.json({ note, notes: visitNotesFor(auth.tenantId, patient.id) }, { status: 201, headers: noStore });
    }

    default:
      return fail("Unknown action.");
  }
}
