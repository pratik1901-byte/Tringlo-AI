"use client";

// ============================================================
// Follow-ups
// ============================================================
//
// Patients who have asked to be contacted, and what staff have done about it.
//
// The one thing this page is careful about: a request shows "Callback
// scheduled" only when a callback actually exists. The status cannot be set by
// hand — scheduling is what sets it, and if scheduling fails the request stays
// where it was and says why. A patient told "the doctor will ring you at four"
// when nothing is in the dialler is the failure worth designing against.
// ============================================================

import { useMemo, useState } from "react";
import { CalendarClock, PhoneForwarded } from "lucide-react";

import { api, formatWhen, relative, useApi } from "@/lib/hospital/panel-api";
import {
  Button,
  Card,
  CardHead,
  DemoTag,
  Dialog,
  Empty,
  Field,
  Loading,
  PageHeader,
  Problem,
  Stat,
  Status,
  Table,
  inputClass,
  type Tone,
} from "@/components/hospital/ui";

type FollowUpStatus =
  | "new"
  | "pending_review"
  | "assigned"
  | "callback_scheduled"
  | "in_progress"
  | "completed"
  | "unable_to_reach"
  | "cancelled";

interface FollowUp {
  id: string;
  canonicalPatientId: string | null;
  patientLeadId: string;
  patientName: string;
  appointmentId: string | null;
  requestedAt: string;
  reason: string;
  sourceCallId: string | null;
  preferredAt: string | null;
  priority: "normal" | "raised";
  priorityRule: string | null;
  department: string | null;
  assignedTo: string | null;
  status: FollowUpStatus;
  outcome: string | null;
  callbackId: string | null;
  callback: { id: string; scheduledTime: string | null; status: string } | null;
  events: Array<{ at: string; actor: string; action: string; detail?: string | null }>;
  updatedAt: string;
  demo: boolean;
}

interface Payload {
  followUps: FollowUp[];
  statuses: FollowUpStatus[];
  counts: { open: number; total: number };
}

const TONES: Record<FollowUpStatus, Tone> = {
  new: "waiting",
  pending_review: "waiting",
  assigned: "neutral",
  callback_scheduled: "good",
  in_progress: "neutral",
  completed: "good",
  unable_to_reach: "warn",
  cancelled: "neutral",
};

const label = (status: string) => status.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());

export default function FollowUpsPage() {
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const { data, error, loading, reload } = useApi<Payload>(`hospital/followups?status=${encodeURIComponent(filter)}`);
  const [open, setOpen] = useState<FollowUp | null>(null);
  const [when, setWhen] = useState("");
  const [assignee, setAssignee] = useState("");
  const [outcome, setOutcome] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.followUps ?? []).filter((followUp) =>
      term ? `${followUp.patientName} ${followUp.reason}`.toLowerCase().includes(term) : true
    );
  }, [data?.followUps, search]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await api<{ ok?: boolean; problem?: string; followUp?: FollowUp }>("hospital/followups", {
        method: "POST",
        body: JSON.stringify(body),
      });
      // Scheduling that did not happen comes back ok:false. The request keeps
      // its old status, and this page must not imply otherwise.
      if (result.ok === false) {
        setProblem(result.problem ?? "That did not go through.");
      } else {
        setNotice(success);
        if (result.followUp) setOpen(result.followUp);
      }
      await reload();
      return result.ok !== false;
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading follow-ups" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reception"
        title="Follow-ups"
        description="Patients who asked for someone to get back to them, with what they wanted addressed in their own words."
      />

      {error && <Problem message={error} onRetry={reload} />}
      {problem && <Problem message={problem} />}
      {notice && (
        <p className="rounded-xl border border-sage/30 bg-sage-soft px-4 py-3 text-[13px] text-sage-ink">{notice}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Open requests" value={data?.counts.open ?? 0} tone={data?.counts.open ? "clay" : "plain"} note="Still need somebody" />
        <Stat label="All requests" value={data?.counts.total ?? 0} note="Including closed" />
        <Stat
          label="Callbacks scheduled"
          value={(data?.followUps ?? []).filter((followUp) => followUp.callbackId).length}
          note="Actually in the dialler"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={`${inputClass} max-w-[220px]`} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
          {(data?.statuses ?? []).map((status) => (
            <option key={status} value={status}>
              {label(status)}
            </option>
          ))}
        </select>
        <input
          className={`${inputClass} max-w-[260px]`}
          placeholder="Search patient or reason"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <Card>
        <CardHead title="Requests" note="Separate from appointments, medical history and the call they came from" />
        {rows.length === 0 ? (
          <Empty
            title="No follow-up requests"
            description="When a patient asks for someone to contact them, the request appears here as soon as it is recorded — before any callback is arranged."
          />
        ) : (
          <Table head={["Patient", "What they asked about", "Requested", "Assigned", "Callback", "Status", ""]}>
            {rows.map((followUp) => (
              <tr key={followUp.id}>
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="text-ink">{followUp.patientName}</span>
                    {followUp.demo && <DemoTag />}
                  </span>
                  {followUp.priority === "raised" && followUp.priorityRule && (
                    <span className="block text-[11.5px] text-clay">Raised: {followUp.priorityRule}</span>
                  )}
                </td>
                <td className="max-w-[300px] px-4 py-2.5">
                  <span className="block truncate text-ink">{followUp.reason}</span>
                  {followUp.preferredAt && (
                    <span className="block text-[11.5px] text-ink-muted">
                      Asked for {formatWhen(followUp.preferredAt)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-ink-muted">{relative(followUp.requestedAt)}</td>
                <td className="px-4 py-2.5 text-ink-muted">{followUp.assignedTo ?? followUp.department ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {followUp.callback?.scheduledTime ? (
                    <span className="text-ink-muted">{formatWhen(followUp.callback.scheduledTime)}</span>
                  ) : (
                    <span className="text-ink-muted">Not scheduled</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Status label={label(followUp.status)} tone={TONES[followUp.status]} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setOpen(followUp);
                      setWhen("");
                      setAssignee(followUp.assignedTo ?? "");
                      setOutcome(followUp.outcome ?? "");
                    }}
                  >
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
        <PhoneForwarded className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        A request reads &ldquo;callback scheduled&rdquo; only once a callback exists in the platform scheduler. A
        demonstration request never puts a real number in the dialler.
      </p>

      <Dialog
        open={Boolean(open)}
        title={open ? `${open.patientName} — follow-up` : "Follow-up"}
        onClose={() => setOpen(null)}
        footer={
          <Button variant="quiet" onClick={() => setOpen(null)}>
            Close
          </Button>
        }
      >
        {open && (
          <div className="space-y-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-muted">In their words</p>
              <p className="mt-1 text-[14px] leading-relaxed text-ink">{open.reason}</p>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-ink-muted">Requested</dt>
              <dd className="text-ink">{formatWhen(open.requestedAt)}</dd>
              <dt className="text-ink-muted">Preferred time</dt>
              <dd className="text-ink">{open.preferredAt ? formatWhen(open.preferredAt) : "None given"}</dd>
              <dt className="text-ink-muted">Hospital patient ID</dt>
              <dd className="text-ink">{open.canonicalPatientId ?? "Not matched"}</dd>
              <dt className="text-ink-muted">From call</dt>
              <dd className="text-ink">{open.sourceCallId ?? "—"}</dd>
              <dt className="text-ink-muted">Status</dt>
              <dd>
                <Status label={label(open.status)} tone={TONES[open.status]} />
              </dd>
              <dt className="text-ink-muted">Priority</dt>
              <dd className="text-ink">
                {open.priority === "raised" ? open.priorityRule ?? "Raised" : "Normal"}
              </dd>
            </dl>

            <div className="space-y-3 border-t pt-4">
              <Field label="Assign to" hint="A person or a department.">
                <span className="flex gap-2">
                  <input
                    className={inputClass}
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                    placeholder="Name or department"
                  />
                  <Button
                    disabled={busy || !assignee.trim()}
                    onClick={() => act({ action: "assign", id: open.id, assignedTo: assignee }, "Assigned.")}
                  >
                    Assign
                  </Button>
                </span>
              </Field>

              <Field
                label="Schedule a callback"
                hint="Placed by the platform scheduler. The status changes only if this succeeds."
              >
                <span className="flex gap-2">
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={when}
                    onChange={(event) => setWhen(event.target.value)}
                  />
                  <Button
                    variant="primary"
                    disabled={busy || !when || Boolean(open.callbackId)}
                    onClick={() =>
                      act(
                        { action: "schedule-callback", id: open.id, when: new Date(when).toISOString() },
                        "Callback scheduled."
                      )
                    }
                  >
                    Schedule
                  </Button>
                </span>
              </Field>
              {open.callback?.scheduledTime && (
                <p className="flex items-center gap-2 text-[12.5px] text-sage-ink">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                  Callback at {formatWhen(open.callback.scheduledTime)} ({open.callback.status}).
                </p>
              )}

              <Field label="Outcome" hint="What came of it.">
                <textarea
                  className="min-h-[70px] w-full rounded-lg border px-3 py-2 text-sm text-ink outline-none focus-visible:border-sage"
                  value={outcome}
                  onChange={(event) => setOutcome(event.target.value)}
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                {(["in_progress", "completed", "unable_to_reach", "cancelled"] as FollowUpStatus[]).map((status) => (
                  <Button
                    key={status}
                    disabled={busy}
                    variant={status === "completed" ? "primary" : status === "cancelled" ? "danger" : "plain"}
                    onClick={() => act({ action: "status", id: open.id, status, outcome }, `Marked ${label(status)}.`)}
                  >
                    {label(status)}
                  </Button>
                ))}
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-muted">History</p>
              <ul className="mt-2 space-y-1.5 text-[12.5px]">
                {open.events
                  .slice()
                  .reverse()
                  .map((event, index) => (
                    <li key={`${event.at}-${index}`} className="flex items-start justify-between gap-3">
                      <span className="text-ink">
                        {label(event.action)}
                        {event.detail && <span className="block text-[11.5px] text-ink-muted">{event.detail}</span>}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-ink-muted">{formatWhen(event.at)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
