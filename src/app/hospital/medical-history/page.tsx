"use client";

// ============================================================
// Medical History
// ============================================================
//
// Three things, in the order staff need them: the reports waiting to be read,
// the histories on file, and a questionnaire that can be run at the desk.
//
// The nine-question limit is the server's, not this page's. The progress bar
// shows "4 of 9" because the server said so; when it says there is no next
// question, there is no next question, and this page has no way to ask for a
// tenth. It also never shows a report as submitted on its own say-so — the
// status comes back from the submission attempt.
//
// One patient, one history. Where that history came from a patient the
// hospital had not registered, it says so, because a provisional record is
// something somebody has to reconcile.
// ============================================================

import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, FileText, Lock, ShieldCheck } from "lucide-react";

import { api, formatWhen, useApi } from "@/lib/hospital/panel-api";
import {
  Button,
  Card,
  CardHead,
  DemoTag,
  Dialog,
  Empty,
  Field,
  Loading,
  NotConfigured,
  PageHeader,
  Problem,
  Stat,
  Status,
  Table,
  inputClass,
  type Tone,
} from "@/components/hospital/ui";

interface Question {
  id: string;
  label: string;
  prompt: string;
}

interface Answer {
  questionId: string;
  label: string;
  prompt: string;
  state: "answered" | "skipped" | "unknown";
  value: string | null;
  note: string | null;
  answeredAt: string | null;
}

interface HistoryRow {
  id: string;
  canonicalPatientId: string;
  provisional: boolean;
  patientName: string;
  consent: { granted: boolean; at: string; via: string } | null;
  storage: "tringlo_local" | "hospital_server";
  sync: { state: string; problem: string | null; reference: string | null };
  updatedAt: string;
  revisions: number;
  demo: boolean;
  answers: Answer[];
}

interface Progress {
  asked: number;
  answered: number;
  skipped: number;
  total: number;
  limit: number;
  remaining: number;
}

interface SessionRow {
  id: string;
  patientLeadId: string;
  patientStatus: "new" | "returning" | "unverified";
  status: string;
  consent: { granted: boolean } | null;
  asked: string[];
  answers: Array<{ questionId: string; state: string; value: string | null }>;
  escalation: { reason: string; protocol: string } | null;
  startedAt: string;
  demo: boolean;
  progress: Progress;
}

interface ReportRow {
  id: string;
  patientName: string;
  patientStatus: string;
  collectedAt: string;
  status: "draft" | "ready" | "submitted" | "failed" | "reviewed";
  destination: "hospital_server" | "panel_review";
  failureReason: string | null;
  skipped: string[];
  unanswered: string[];
  notes: string | null;
  consent: { granted: boolean } | null;
  answers: Array<{ questionId: string; label: string; prompt: string; state: string; value: string | null }>;
  reviewedBy: string | null;
  demo: boolean;
}

interface Payload {
  questions: Question[];
  limit: number;
  disclaimer: string;
  consentStatement: string;
  histories: HistoryRow[];
  sessions: SessionRow[];
  reports: ReportRow[];
  awaitingReview: number;
}

const REPORT_TONES: Record<ReportRow["status"], Tone> = {
  draft: "neutral",
  ready: "waiting",
  submitted: "good",
  failed: "bad",
  reviewed: "good",
};

const REPORT_LABELS: Record<ReportRow["status"], string> = {
  draft: "Draft",
  ready: "Ready for review",
  submitted: "Submitted",
  failed: "Submission failed",
  reviewed: "Reviewed",
};

export default function MedicalHistoryPage() {
  const { data, error, loading, reload } = useApi<Payload>("hospital/medical-history");
  const [tab, setTab] = useState<"reports" | "histories" | "intake">("reports");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<ReportRow | null>(null);
  const [openHistory, setOpenHistory] = useState<HistoryRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  const histories = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data?.histories ?? [];
    return (data?.histories ?? []).filter(
      (history) =>
        history.patientName.toLowerCase().includes(term) ||
        history.canonicalPatientId.toLowerCase().includes(term)
    );
  }, [data?.histories, search]);

  const reports = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data?.reports ?? [];
    return (data?.reports ?? []).filter((report) => report.patientName.toLowerCase().includes(term));
  }, [data?.reports, search]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await api<{ ok?: boolean; problem?: string; report?: ReportRow; destination?: string }>(
        "hospital/medical-history",
        { method: "POST", body: JSON.stringify(body) }
      );
      // A submission that failed comes back ok:false with the report's new
      // state. It is not an error in the request, and it is not a success.
      if (result.ok === false) {
        setProblem(result.problem ?? "That did not go through.");
        if (result.report) setOpenReport(result.report);
      } else {
        setNotice(success);
        if (result.report) setOpenReport(result.report);
      }
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading medical history" />;

  const awaiting = data?.awaitingReview ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinic"
        title="Questionnaire"
        description={
          <>
            The preliminary questionnaire the voice agent runs with new patients, and the patient-reported histories and
            reports it produces — for review by hospital staff. Not a clinical assessment and not a diagnosis. Each
            patient has one history, updated by revision.
          </>
        }
      />

      {error && <Problem message={error} onRetry={reload} />}
      {problem && <Problem message={problem} />}
      {notice && (
        <p className="rounded-xl border border-sage/30 bg-sage-soft px-4 py-3 text-[13px] text-sage-ink">{notice}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Awaiting review" value={awaiting} tone={awaiting ? "clay" : "plain"} note="Reports no one has read yet" />
        <Stat label="Histories on file" value={data?.histories.length ?? 0} note="One per patient" />
        <Stat
          label="Questionnaires run"
          value={data?.sessions.length ?? 0}
          note={`Never more than ${data?.limit ?? 9} questions`}
        />
        <Stat
          label="Submission failed"
          value={data?.reports.filter((report) => report.status === "failed").length ?? 0}
          tone={data?.reports.some((report) => report.status === "failed") ? "alert" : "plain"}
          note="Not delivered to the hospital"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {([
          ["reports", "Reports"],
          ["histories", "Histories"],
          ["intake", "Run a questionnaire"],
        ] as const).map(([key, label]) => (
          <Button key={key} variant={tab === key ? "primary" : "plain"} onClick={() => setTab(key)}>
            {label}
          </Button>
        ))}
        {tab !== "intake" && (
          <input
            className={`${inputClass} ml-auto max-w-[260px]`}
            placeholder="Search by patient"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
      </div>

      {tab === "reports" && (
        <Card>
          <CardHead
            title="Preliminary history reports"
            note={data?.disclaimer}
            actions={<Status label={`${reports.length} total`} />}
          />
          {reports.length === 0 ? (
            <Empty
              title="No reports yet"
              description="A report is created when a new patient finishes the preliminary questionnaire. Nothing is generated until that happens."
            />
          ) : (
            <Table head={["Patient", "Collected", "Consent", "Destination", "Status", ""]}>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="text-ink">{report.patientName || "Unknown patient"}</span>
                      {report.demo && <DemoTag />}
                    </span>
                    <span className="block text-[11.5px] text-ink-muted">{report.patientStatus} patient</span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{formatWhen(report.collectedAt)}</td>
                  <td className="px-4 py-2.5">
                    {report.consent?.granted ? (
                      <Status label="Given" tone="good" />
                    ) : (
                      <Status label="Not recorded" tone="warn" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {report.destination === "hospital_server" ? "Hospital server" : "Review here"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Status label={REPORT_LABELS[report.status]} tone={REPORT_TONES[report.status]} />
                    {report.failureReason && (
                      <span className="mt-1 block max-w-[280px] text-[11.5px] leading-snug text-alert">
                        {report.failureReason}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="quiet" onClick={() => setOpenReport(report)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "histories" && (
        <Card>
          <CardHead title="Histories on file" note="One longitudinal record per patient. Updates are revisions, never replacements." />
          {histories.length === 0 ? (
            <Empty
              title="No histories on file"
              description="A history is created the first time a new patient completes the questionnaire, and updated from then on."
            />
          ) : (
            <Table head={["Patient", "Hospital patient ID", "Held", "Revisions", "Updated", ""]}>
              {histories.map((history) => (
                <tr key={history.id}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="text-ink">{history.patientName}</span>
                      {history.demo && <DemoTag />}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {history.provisional ? (
                      <Status label="Provisional" tone="warn" />
                    ) : (
                      <span className="font-mono text-[12px] text-ink-muted">{history.canonicalPatientId}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {history.storage === "hospital_server" ? (
                      <Status label="Hospital server" tone="good" />
                    ) : (
                      <Status label="In Tringlo" tone="neutral" />
                    )}
                  </td>
                  <td className="px-4 py-2.5 tabular text-ink-muted">{history.revisions}</td>
                  <td className="px-4 py-2.5 text-ink-muted">{formatWhen(history.updatedAt)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="quiet" onClick={() => setOpenHistory(history)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "intake" && (
        <Intake
          questions={data?.questions ?? []}
          limit={data?.limit ?? 9}
          consentStatement={data?.consentStatement ?? ""}
          sessions={data?.sessions ?? []}
          onChanged={reload}
        />
      )}

      {/* ---------------- one report ---------------- */}
      <Dialog
        open={Boolean(openReport)}
        title="Preliminary history report"
        onClose={() => setOpenReport(null)}
        footer={
          openReport && (
            <>
              {openReport.status === "ready" || openReport.status === "failed" ? (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => act({ action: "submit-report", reportId: openReport.id }, "Sent to the configured destination.")}
                >
                  {openReport.destination === "hospital_server" ? "Submit to hospital server" : "Mark ready for review"}
                </Button>
              ) : null}
              {openReport.status !== "draft" && openReport.status !== "reviewed" && (
                <Button
                  disabled={busy}
                  onClick={() => act({ action: "review", reportId: openReport.id }, "Marked as reviewed.")}
                >
                  Mark reviewed
                </Button>
              )}
              <Button variant="quiet" onClick={() => setOpenReport(null)}>
                Close
              </Button>
            </>
          )
        }
      >
        {openReport && (
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-lg border border-clay/30 bg-clay-soft px-3.5 py-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
              <p className="text-[12.5px] leading-relaxed text-ink">{data?.disclaimer}</p>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <Detail label="Patient">{openReport.patientName || "Unknown"}</Detail>
              <Detail label="Patient status">{openReport.patientStatus}</Detail>
              <Detail label="Collected">{formatWhen(openReport.collectedAt)}</Detail>
              <Detail label="Consent">{openReport.consent?.granted ? "Given" : "Not recorded"}</Detail>
              <Detail label="Status">{REPORT_LABELS[openReport.status]}</Detail>
              <Detail label="Reviewed by">{openReport.reviewedBy ?? "—"}</Detail>
            </dl>

            {openReport.notes && (
              <p className="rounded-lg bg-sunken px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-soft">
                {openReport.notes}
              </p>
            )}

            <ol className="space-y-3">
              {openReport.answers.map((answer, index) => (
                <li key={answer.questionId} className="border-b pb-3 last:border-0 last:pb-0">
                  <p className="text-[12px] text-ink-muted">
                    {index + 1}. {answer.prompt}
                  </p>
                  {answer.state === "answered" ? (
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink">{answer.value}</p>
                  ) : (
                    <p className="mt-1 text-[13px] italic text-ink-muted">
                      {answer.state === "skipped" ? "Skipped by the patient" : "Not asked"}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Dialog>

      {/* ---------------- one history ---------------- */}
      <Dialog
        open={Boolean(openHistory)}
        title={openHistory ? `${openHistory.patientName} — medical history` : "Medical history"}
        onClose={() => setOpenHistory(null)}
        footer={
          <Button variant="quiet" onClick={() => setOpenHistory(null)}>
            Close
          </Button>
        }
      >
        {openHistory && (
          <div className="space-y-4">
            {openHistory.provisional && (
              <NotConfigured
                what="This patient has no hospital patient ID yet"
                how="The record is held under a provisional identifier. Once the hospital registers the patient, enter their patient ID against this history and the two are reconciled — no second history is created."
              />
            )}
            {openHistory.sync.problem && (
              <div className="flex items-start gap-2.5 rounded-lg border bg-sunken px-3.5 py-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                <p className="text-[12.5px] leading-relaxed text-ink-soft">{openHistory.sync.problem}</p>
              </div>
            )}
            <p className="flex items-center gap-2 text-[12.5px] text-ink-muted">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Patient-reported. {openHistory.revisions} revision{openHistory.revisions === 1 ? "" : "s"}; previous
              answers are kept.
            </p>
            <ol className="space-y-3">
              {openHistory.answers.map((answer, index) => (
                <li key={answer.questionId} className="border-b pb-3 last:border-0 last:pb-0">
                  <p className="text-[12px] text-ink-muted">
                    {index + 1}. {answer.prompt}
                  </p>
                  {answer.state === "answered" ? (
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink">{answer.value}</p>
                  ) : (
                    <p className="mt-1 text-[13px] italic text-ink-muted">
                      {answer.state === "skipped" ? "Skipped by the patient" : "Not answered"}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </Dialog>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </>
  );
}

// ------------------------------------------------------------
// Running a questionnaire at the desk
// ------------------------------------------------------------

/**
 * The same workflow the agent follows, for staff taking it over the counter.
 *
 * Identity is checked first and the server decides whether a questionnaire is
 * allowed at all — a returning patient is refused here exactly as the agent is
 * refused, which is what stops a second history being created by hand.
 */
function Intake({
  questions,
  limit,
  consentStatement,
  sessions,
  onChanged,
}: {
  questions: Question[];
  limit: number;
  consentStatement: string;
  sessions: SessionRow[];
  onChanged: () => Promise<void> | void;
}) {
  const [form, setForm] = useState({ phone: "", name: "", dateOfBirth: "", patientId: "" });
  const [session, setSession] = useState<SessionRow | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [current, setCurrent] = useState<{ question: Question | null; number: number; done: string | null } | null>(null);
  const [value, setValue] = useState("");
  const [identity, setIdentity] = useState<{ status: string; reason: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async <T,>(body: Record<string, unknown>): Promise<T | null> => {
    setBusy(true);
    setProblem(null);
    try {
      return await api<T>("hospital/medical-history", { method: "POST", body: JSON.stringify(body) });
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    const result = await post<{ session: SessionRow; progress: Progress; identity: { status: string; reason: string } }>({
      action: "start",
      phone: form.phone,
      name: form.name,
      dateOfBirth: form.dateOfBirth,
      patientId: form.patientId,
    });
    if (!result) return;
    setSession(result.session);
    setProgress(result.progress);
    setIdentity(result.identity);
    setCurrent(null);
    await onChanged();
  };

  const giveConsent = async (granted: boolean) => {
    if (!session) return;
    const result = await post<{ session: SessionRow; progress: Progress }>({
      action: "consent",
      sessionId: session.id,
      granted,
      via: "staff",
    });
    if (!result) return;
    setSession(result.session);
    setProgress(result.progress);
    if (granted) await askNext(result.session.id);
  };

  const askNext = async (sessionId: string) => {
    const result = await post<{ question: Question | null; number: number; done: string | null }>({
      action: "next",
      sessionId,
    });
    if (!result) return;
    setCurrent(result);
    setValue("");
  };

  const answer = async (state: "answered" | "skipped") => {
    if (!session || !current?.question) return;
    const result = await post<{ session: SessionRow; progress: Progress }>({
      action: "answer",
      sessionId: session.id,
      questionId: current.question.id,
      state,
      value: state === "answered" ? value : null,
    });
    if (!result) return;
    setSession(result.session);
    setProgress(result.progress);
    await onChanged();
    if (result.session.status === "complete") setCurrent({ question: null, number: 0, done: "Every question is done." });
    else await askNext(session.id);
  };

  const finish = async () => {
    if (!session) return;
    const result = await post<{ created: boolean; report: ReportRow }>({ action: "finish", sessionId: session.id });
    if (!result) return;
    setSession(null);
    setProgress(null);
    setCurrent(null);
    setForm({ phone: "", name: "", dateOfBirth: "", patientId: "" });
    setProblem(null);
    await onChanged();
  };

  const recent = sessions.slice(0, 6);

  return (
    <div className="space-y-6">
      {problem && <Problem message={problem} />}

      <Card>
        <CardHead
          title="Identify the patient"
          note="A phone number alone is never enough. Ask for a date of birth, or the hospital patient number."
        />
        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Phone number" hint="The number the hospital has, or the one they are calling from.">
            <input
              className={inputClass}
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="+91…"
            />
          </Field>
          <Field label="Name">
            <input
              className={inputClass}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Date of birth" hint="What the hospital matches on.">
            <input
              type="date"
              className={inputClass}
              value={form.dateOfBirth}
              onChange={(event) => setForm({ ...form, dateOfBirth: event.target.value })}
            />
          </Field>
          <Field label="Hospital patient number" hint="If they have it. Strongest identifier.">
            <input
              className={inputClass}
              value={form.patientId}
              onChange={(event) => setForm({ ...form, patientId: event.target.value })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button variant="primary" disabled={busy || !form.phone.trim()} onClick={start}>
              Check with the hospital
            </Button>
          </div>
        </div>
      </Card>

      {identity && (
        <Card>
          <CardHead
            title="What the hospital says"
            actions={
              <Status
                label={identity.status === "new" ? "New patient" : identity.status === "returning" ? "Returning" : "Unverified"}
                tone={identity.status === "new" ? "waiting" : identity.status === "returning" ? "good" : "warn"}
              />
            }
          />
          <p className="px-5 py-4 text-[13px] leading-relaxed text-ink-soft">{identity.reason}</p>
        </Card>
      )}

      {session && (
        <Card>
          <CardHead
            title="Preliminary questions"
            note={`${limit} questions, no more. Each is asked once, and any can be skipped.`}
            actions={
              progress && (
                <Status
                  label={`${progress.asked} of ${Math.min(questions.length, limit)} asked`}
                  tone={progress.asked >= limit ? "good" : "waiting"}
                />
              )
            }
          />
          <div className="space-y-4 p-5">
            {progress && (
              <div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" role="presentation">
                  <div
                    className="h-full rounded-full bg-sage transition-all"
                    style={{ width: `${Math.round((progress.asked / Math.min(questions.length, limit)) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-[12px] text-ink-muted">
                  {progress.answered} answered · {progress.skipped} skipped · {progress.remaining} left
                </p>
              </div>
            )}

            {!session.consent && (
              <div className="space-y-3 rounded-lg border bg-sunken px-4 py-3.5">
                <p className="text-[13px] leading-relaxed text-ink">{consentStatement}</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => giveConsent(true)}>
                    They agreed
                  </Button>
                  <Button disabled={busy} onClick={() => giveConsent(false)}>
                    They declined
                  </Button>
                </div>
              </div>
            )}

            {session.consent && !session.consent.granted && (
              <NotConfigured
                what="The patient declined"
                how="No health questions were asked and nothing was recorded against them. That is a complete answer, not a failure."
              />
            )}

            {session.consent?.granted && current?.question && (
              <div className="space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-muted">
                  Question {current.number} of {Math.min(questions.length, limit)}
                </p>
                <p className="text-[15px] leading-relaxed text-ink">{current.question.prompt}</p>
                <textarea
                  className="min-h-[88px] w-full rounded-lg border px-3 py-2 text-sm text-ink outline-none focus-visible:border-sage"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="The patient's own words"
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy || !value.trim()} onClick={() => answer("answered")}>
                    Record answer
                  </Button>
                  <Button disabled={busy} onClick={() => answer("skipped")}>
                    They would rather not say
                  </Button>
                </div>
              </div>
            )}

            {session.consent?.granted && current && !current.question && (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-ink">{current.done}</p>
                <Button variant="primary" disabled={busy} onClick={finish}>
                  Save the history and generate the report
                </Button>
              </div>
            )}

            {session.consent?.granted && !current && (
              <Button variant="primary" disabled={busy} onClick={() => askNext(session.id)}>
                Ask the first question
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHead title="Recent questionnaires" note="Including the ones that stopped early" />
        {recent.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-ink-muted">None yet.</p>
        ) : (
          <Table head={["Started", "Patient status", "Asked", "Consent", "Outcome"]}>
            {recent.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2.5 text-ink-muted">{formatWhen(row.startedAt)}</td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="text-ink">{row.patientStatus}</span>
                    {row.demo && <DemoTag />}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular text-ink-muted">
                  {row.progress.asked} / {row.progress.limit}
                </td>
                <td className="px-4 py-2.5">
                  {row.consent?.granted ? (
                    <Status label="Given" tone="good" />
                  ) : row.consent ? (
                    <Status label="Declined" tone="neutral" />
                  ) : (
                    <Status label="Not asked" tone="waiting" />
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Status
                    label={row.status.replace(/_/g, " ")}
                    tone={row.status === "complete" ? "good" : row.status === "escalated" ? "warn" : "neutral"}
                  />
                  {row.escalation && (
                    <span className="mt-1 block max-w-[260px] text-[11.5px] leading-snug text-ink-muted">
                      {row.escalation.reason}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
        <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        The {limit}-question limit is enforced by the server, not by this page. There is no way to ask a tenth question
        from here, and the agent gets the same refusal.
      </p>
      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A report is marked submitted only when its destination confirms receipt.
      </p>
    </div>
  );
}
