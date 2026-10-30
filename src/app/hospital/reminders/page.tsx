"use client";

// ============================================================
// Confirmation calls — the calls the server owes
// ============================================================
//
// About a day before each appointment the agent rings to ask whether the
// patient still intends to come. These calls are placed by the Tringlo server
// on its own timer: closing this panel does not stop them, and nothing on this
// page dials. Staff may cancel, re-time or re-queue a call, and record what a
// patient said; the worker decides the rest.
//
// Recording an outcome is the only action here that can change an appointment,
// and only one answer does: an explicit confirmation. A no-answer or an
// unclear reply leaves the appointment exactly as it was, and a request to
// cancel becomes a cancellation request for the hospital's own system rather
// than a cancellation.
// ============================================================

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { api, formatWhen, relative, useApi } from "@/lib/hospital/panel-api";
import {
  Button,
  Card,
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
  reminderTone,
} from "@/components/hospital/ui";

interface Reminder {
  id: string;
  appointmentId: string;
  dueAt: string;
  status: string;
  attempts: number;
  lastAttemptAt: string | null;
  failureReason: string | null;
  skippedReason: string | null;
  callId: string | null;
  cycle?: string;
  outcome: { response: string; note: string | null; recordedAt: string; action: string | null } | null;
  demo: boolean;
  doctorName: string | null;
  patientName: string | null;
  appointment: { id: string; scheduledAt: string; status: string } | null;
}

/** What a patient can have said, in the words the panel shows. */
const RESPONSES: Array<{ key: string; label: string }> = [
  { key: "confirmed", label: "Confirmed they will attend" },
  { key: "cancel_requested", label: "Asked to cancel" },
  { key: "reschedule_requested", label: "Asked to reschedule" },
  { key: "declined", label: "Said they will not attend" },
  { key: "no_answer", label: "No answer" },
  { key: "unclear", label: "Reply was unclear" },
];

const FILTERS = [
  { key: "", label: "All" },
  { key: "scheduled", label: "Upcoming" },
  { key: "sent", label: "Placed" },
  // Result categories — what the patient's answer came to.
  { key: "confirmed", label: "Confirmed" },
  { key: "reschedule", label: "Reschedule requested" },
  { key: "no_answer", label: "No answer" },
  { key: "followup", label: "Needs follow-up" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Skipped" },
  { key: "cancelled", label: "Cancelled" },
];

/** Whether a reminder belongs under a given filter chip. */
function matchesFilter(reminder: Reminder, filter: string): boolean {
  switch (filter) {
    case "":
      return true;
    case "confirmed":
      return reminder.outcome?.response === "confirmed";
    case "reschedule":
      return reminder.outcome?.response === "reschedule_requested";
    case "no_answer":
      return reminder.outcome?.response === "no_answer";
    case "followup":
      return (
        reminder.outcome?.response === "declined" ||
        reminder.outcome?.response === "unclear" ||
        reminder.outcome?.response === "cancel_requested"
      );
    default:
      // A plain lifecycle status: scheduled, sent, failed, skipped, cancelled.
      return reminder.status === filter;
  }
}

export default function RemindersPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Reminders />
    </Suspense>
  );
}

function Reminders() {
  const params = useSearchParams();
  const [filter, setFilter] = useState(params.get("status") ?? "");
  const { data, error, loading, reload } = useApi<{
    reminders: Reminder[];
    timezone: string;
    remindersEnabled: boolean;
    leadHours: number;
    maxAttempts: number;
    campaigns: string[];
  }>("hospital/reminders");

  const [recording, setRecording] = useState<Reminder | null>(null);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const all = data?.reminders ?? [];
  const rows = all.filter((reminder) => matchesFilter(reminder, filter));
  const timezone = data?.timezone ?? "Asia/Kolkata";

  /** Dispatch every eligible appointment for tomorrow (AUTO: instant or batch). */
  const sendAll = async () => {
    setProblem(null);
    setNotice(null);
    setBusy(true);
    try {
      const { summary } = await api<{ summary: { date: string; eligibleCount: number; queued: number; method: string; problem?: string } }>(
        "hospital/reminders",
        { method: "PUT", body: JSON.stringify({ action: "send_all", strategy: "auto" }) }
      );
      setNotice(
        summary.problem
          ? `Nothing was dialled: ${summary.problem}`
          : `${summary.date}: ${summary.eligibleCount} eligible, ${summary.queued} dispatched via ${summary.method}.`
      );
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  /** Pause an active reminder campaign at the provider. */
  const pauseCampaign = async (campaignId: string) => {
    setProblem(null);
    try {
      await api("hospital/reminders", { method: "PUT", body: JSON.stringify({ action: "pause_campaign", campaignId }) });
      setNotice(`Campaign ${campaignId} paused.`);
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    }
  };

  /** Queue a manual confirmation call, surfacing the server's own answer. */
  const sendNow = async (id: string) => {
    setProblem(null);
    setNotice(null);
    try {
      const result = await api<{ message?: string }>("hospital/reminders", {
        method: "PUT",
        body: JSON.stringify({ id, action: "send" }),
      });
      setNotice(result.message ?? "Queued.");
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    }
  };

  const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setProblem(null);
    try {
      await api("hospital/reminders", { method: "PUT", body: JSON.stringify({ id, action, ...extra }) });
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    }
  };

  /**
   * Records what the patient said.
   *
   * The message that comes back is the server's account of what it did —
   * including, for a cancellation, that the appointment still stands until the
   * hospital's system confirms. It is shown as given rather than summarised.
   */
  const recordReply = async (response: string) => {
    if (!recording) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api<{ note: string; appointmentConfirmed: boolean; cancellation: { message?: string; problem?: string } | null }>(
        "hospital/reminders",
        { method: "PUT", body: JSON.stringify({ id: recording.id, action: "outcome", response, note: note || null }) }
      );
      setNotice([result.note, result.cancellation?.message ?? result.cancellation?.problem].filter(Boolean).join(" "));
      setRecording(null);
      setNote("");
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calling"
        title="Confirmation calls"
        description={
          data
            ? `One call about ${data.leadHours} hours before each appointment, placed by the server, asking whether the patient still intends to come. Up to ${data.maxAttempts} attempts. An appointment booked inside that window is called as soon as is reasonable instead.`
            : undefined
        }
      />

      {data && !data.remindersEnabled && (
        <NotConfigured
          what="Confirmation calling is switched off"
          how="The schedule below is kept up to date, but no call is placed. Turn it on in Settings once the voice provider is configured and you are ready for patients to be rung."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Scheduled" value={all.filter((r) => r.status === "scheduled").length} />
        <Stat label="Placed" value={all.filter((r) => r.status === "sent").length} tone="sage" note="Call went out" />
        <Stat
          label="Patient answered"
          value={all.filter((r) => Boolean(r.outcome)).length}
          note={`${all.filter((r) => r.outcome?.response === "confirmed").length} confirmed attendance`}
        />
        <Stat label="Failed" value={all.filter((r) => r.status === "failed").length} tone="alert" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={busy} onClick={sendAll}>
            Send all eligible (tomorrow)
          </Button>
          <span className="text-[12px] text-ink-muted">
            Processes every eligible appointment for the next day — one call per appointment. Large days go out as a batch
            campaign; small days as individual calls.
          </span>
        </div>
        {data?.campaigns && data.campaigns.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {data.campaigns.map((campaignId) => (
              <span key={campaignId} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] text-ink-soft">
                Campaign {campaignId.slice(0, 10)}…
                <button type="button" className="font-medium text-sage-ink hover:underline" onClick={() => pauseCampaign(campaignId)}>
                  Pause
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${
              filter === item.key ? "bg-sage text-white" : "border text-ink-muted hover:bg-sunken"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && <Loading label="Loading the schedule" />}
      {error && <Problem message={error} onRetry={reload} />}
      {problem && <Problem message={problem} />}
      {notice && (
        <p className="rounded-xl border border-sage/30 bg-sage-soft px-4 py-3 text-[13px] text-sage-ink">{notice}</p>
      )}

      {!loading && !error && rows.length === 0 && (
        <Empty
          title="No confirmation calls here"
          description="One is scheduled whenever an appointment is booked. Book an appointment, and its confirmation call appears in this schedule."
        />
      )}

      {rows.length > 0 && (
        <Card>
          <Table head={["Patient", "Appointment", "Call due", "Status", "Patient said", ""]}>
            {rows.map((reminder) => (
              <tr key={reminder.id} className="hover:bg-sunken/40">
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{reminder.patientName ?? "—"}</span>
                  {reminder.demo && <span className="ml-2 align-middle"><DemoTag /></span>}
                  <span className="block text-[11px] text-ink-muted">{reminder.doctorName ?? "—"}</span>
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {reminder.appointment ? formatWhen(reminder.appointment.scheduledAt, timezone) : "—"}
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {formatWhen(reminder.dueAt, timezone)}
                  <span className="block text-[11px] text-ink-muted">{relative(reminder.dueAt)}</span>
                </td>
                <td className="px-4 py-3">
                  <Status label={reminder.status} tone={reminderTone(reminder.status)} />
                  {(reminder.failureReason || reminder.skippedReason) && (
                    <span className="mt-1 block max-w-[18rem] text-[11px] leading-snug text-ink-muted">
                      {reminder.failureReason ?? reminder.skippedReason}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {reminder.outcome ? (
                    <>
                      <Status
                        label={reminder.outcome.response.replace(/_/g, " ")}
                        tone={
                          reminder.outcome.response === "confirmed"
                            ? "good"
                            : reminder.outcome.response === "no_answer" || reminder.outcome.response === "unclear"
                              ? "neutral"
                              : "warn"
                        }
                      />
                      {reminder.outcome.action && (
                        <span className="mt-1 block max-w-[20rem] text-[11px] leading-snug text-ink-muted">
                          {reminder.outcome.action}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-ink-muted">
                      {reminder.attempts ? `${reminder.attempts} attempt${reminder.attempts === 1 ? "" : "s"}` : "not yet"}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    {reminder.status === "failed" && (
                      <Button variant="quiet" onClick={() => act(reminder.id, "retry")}>
                        Retry
                      </Button>
                    )}
                    {(reminder.status === "cancelled" || reminder.status === "skipped") && (
                      <Button variant="quiet" onClick={() => act(reminder.id, "reinstate")}>
                        Reinstate
                      </Button>
                    )}
                    {(reminder.status === "scheduled" || reminder.status === "due") && (
                      <Button variant="quiet" onClick={() => act(reminder.id, "cancel")}>
                        Cancel
                      </Button>
                    )}
                    {!reminder.demo &&
                      !reminder.outcome &&
                      reminder.appointment &&
                      (reminder.status === "scheduled" ||
                        reminder.status === "due" ||
                        reminder.status === "skipped" ||
                        reminder.status === "failed") && (
                        <Button variant="quiet" onClick={() => sendNow(reminder.id)}>
                          Send now
                        </Button>
                      )}
                    {!reminder.outcome && reminder.appointment && (
                      <Button variant="quiet" onClick={() => setRecording(reminder)}>
                        Record reply
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Dialog
        open={Boolean(recording)}
        title="What did the patient say?"
        onClose={() => setRecording(null)}
        footer={
          <Button variant="quiet" onClick={() => setRecording(null)}>
            Cancel
          </Button>
        }
      >
        {recording && (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              {recording.patientName} · {recording.appointment ? formatWhen(recording.appointment.scheduledAt, timezone) : "—"} with{" "}
              {recording.doctorName ?? "a doctor"}.
            </p>

            <Field label="Anything they said" hint="Optional. Their own words.">
              <textarea
                className="min-h-[70px] w-full rounded-lg border px-3 py-2 text-sm text-ink outline-none focus-visible:border-sage"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>

            <div className="space-y-2">
              {RESPONSES.map((response) => (
                <Button
                  key={response.key}
                  className="w-full justify-start"
                  variant={response.key === "confirmed" ? "primary" : "plain"}
                  disabled={busy}
                  onClick={() => recordReply(response.key)}
                >
                  {response.label}
                </Button>
              ))}
            </div>

            <p className="text-[11.5px] leading-relaxed text-ink-muted">
              Only an explicit confirmation marks the appointment confirmed. A request to cancel is passed to the
              hospital&rsquo;s system, and the appointment stands until that confirms.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
