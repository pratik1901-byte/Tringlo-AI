"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Plus, RefreshCw, X } from "lucide-react";

import type { FollowUp, Lead } from "@/lib/types";
import { useAgentConfigStore } from "@/lib/store";
import { useFollowUps } from "@/lib/use-dialo-data";
import { useNow } from "@/lib/use-now";
import { useModalEntrance, useReveal } from "@/lib/animation";
import {
  EMPTY,
  formatDateTime,
  formatFollowUpStatus,
  formatInterest,
  formatText,
} from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  Tag,
} from "@/components/ui/data-display";
import { RealCallModal } from "@/components/call/RealCallModal";

export default function FollowUpsPage() {
  const { followUps, error, isLoading, isRefreshing, refresh } = useFollowUps();
  const { config: agentConfig } = useAgentConfigStore();

  const [callingLead, setCallingLead] = useState<Lead | null>(null);
  const [scheduling, setScheduling] = useState<FollowUp | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // A ticking clock, so "overdue" becomes true on its own rather than only when
  // something else happens to re-render the page.
  const now = useNow(30_000);

  const counts = useMemo(() => {
    const open = followUps.filter(
      (item) => item.status !== "completed" && item.status !== "cancelled"
    );
    return {
      open: open.length,
      needsTime: open.filter((item) => item.scheduledTime === null).length,
      overdue: open.filter(
        (item) => item.scheduledTime !== null && new Date(item.scheduledTime).getTime() < now
      ).length,
      completed: followUps.filter((item) => item.status === "completed").length,
    };
  }, [followUps, now]);

  const tableRef = useReveal<HTMLTableSectionElement>({
    selector: "[data-row]",
    distance: 6,
    deps: [followUps.length],
    enabled: followUps.length > 0 && followUps.length <= 40,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Follow-ups"
        description="Callbacks Sarvam recorded during real calls, plus anything scheduled by hand"
        actions={
          <>
            <button
              onClick={refresh}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
            <button
              onClick={() => setIsAdding(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Add follow-up
            </button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <SummaryTile label="Open" value={counts.open} />
        <SummaryTile
          label="Need a time"
          value={counts.needsTime}
          tone={counts.needsTime > 0 ? "warning" : "neutral"}
        />
        <SummaryTile
          label="Overdue"
          value={counts.overdue}
          tone={counts.overdue > 0 ? "negative" : "neutral"}
        />
        <SummaryTile label="Completed" value={counts.completed} />
      </div>

      <p className="text-xs text-muted-foreground">
        Callbacks with an agreed time are placed automatically by the server — no action needed.
      </p>

      {counts.needsTime > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          {counts.needsTime} {counts.needsTime === 1 ? "customer" : "customers"} asked for a callback
          without giving a usable date and time. Dialo will not guess one — set a time to schedule
          the call.
        </div>
      )}

      {!isLoading && followUps.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No follow-ups yet"
          description="When a customer asks to be called back, Sarvam reports it and the callback appears here automatically."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">What they said</th>
                  <th className="px-4 py-3">Interest</th>
                  <th className="px-4 py-3">Scheduled</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Timezone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 xl:table-cell">Next action</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>

              {isLoading ? (
                <SkeletonRows rows={5} columns={9} />
              ) : (
                <tbody ref={tableRef}>
                  {followUps.map((followUp) => {
                    const overdue =
                      followUp.status !== "completed" &&
                      followUp.status !== "cancelled" &&
                      followUp.scheduledTime !== null &&
                      new Date(followUp.scheduledTime).getTime() < now;

                    return (
                      <tr
                        key={followUp.id}
                        data-row
                        className="border-b transition-colors last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="px-5 py-3.5">
                          <span className="font-medium">{followUp.lead.name}</span>
                          {followUp.source === "manual" && (
                            <span className="ml-2 text-xs text-muted-foreground">Added manually</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {followUp.lead.phone}
                        </td>
                        <td
                          className="max-w-[260px] truncate px-4 py-3.5 text-xs text-muted-foreground"
                          title={followUp.previousResponse ?? undefined}
                        >
                          {formatText(followUp.previousResponse)}
                        </td>
                        <td className="px-4 py-3.5 text-xs">{formatInterest(followUp.interest)}</td>
                        <td className="px-4 py-3.5 text-xs">
                          {followUp.scheduledTime ? (
                            <span
                              className={overdue ? "text-red-600 dark:text-red-400" : undefined}
                              title={followUp.interpretation ?? undefined}
                            >
                              {formatDateTime(followUp.scheduledTime)}
                            </span>
                          ) : (
                            <span
                              className="text-muted-foreground/60"
                              title={
                                followUp.requestedCallback
                                  ? `The agent recorded: "${followUp.requestedCallback}"`
                                  : "No time was captured on the call."
                              }
                            >
                              {EMPTY}
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3.5 text-xs text-muted-foreground lg:table-cell">
                          {formatText(followUp.timezone)}
                        </td>
                        <td className="px-4 py-3.5">
                          <Tag
                            tone={
                              followUp.status === "completed"
                                ? "positive"
                                : followUp.status === "needs_scheduling"
                                  ? "warning"
                                  : overdue
                                    ? "negative"
                                    : "neutral"
                            }
                          >
                            {overdue && followUp.status === "scheduled"
                              ? "Overdue"
                              : formatFollowUpStatus(followUp.status)}
                          </Tag>
                        </td>
                        <td
                          className="hidden max-w-[200px] truncate px-4 py-3.5 text-xs text-muted-foreground xl:table-cell"
                          title={followUp.nextAction ?? undefined}
                        >
                          {formatText(followUp.nextAction)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-3">
                            {followUp.lead.suppressed ? (
                              <span className="text-xs text-muted-foreground">Do not call</span>
                            ) : followUp.status === "triggering" || followUp.status === "calling" ? (
                              <span className="text-xs text-muted-foreground">Calling now</span>
                            ) : followUp.status === "retry_pending" ? (
                              <span className="text-xs text-muted-foreground">Retrying</span>
                            ) : (
                              <button
                                onClick={() => setCallingLead(followUp.lead)}
                                className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                              >
                                Call
                              </button>
                            )}
                            <button
                              onClick={() => setScheduling(followUp)}
                              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
        </div>
      )}

      {scheduling && (
        <EditFollowUpDialog
          followUp={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={() => {
            setScheduling(null);
            refresh();
          }}
        />
      )}

      {isAdding && (
        <AddFollowUpDialog
          onClose={() => setIsAdding(false)}
          onSaved={() => {
            setIsAdding(false);
            refresh();
          }}
        />
      )}

      {callingLead && (
        <RealCallModal
          lead={callingLead}
          agentConfig={agentConfig}
          onClose={() => {
            setCallingLead(null);
            refresh();
          }}
          onSettled={refresh}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "negative";
}) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p
        className={`font-heading text-3xl font-semibold tabular-nums tracking-tight ${
          tone === "negative"
            ? "text-red-600 dark:text-red-400"
            : tone === "warning"
              ? "text-amber-600 dark:text-amber-400"
              : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { backdropRef, panelRef } = useModalEntrance();

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={panelRef} className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="font-heading text-base font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * The admin's edit: move a callback, change its next action, or cancel it.
 *
 * Every rule lives on the server; this dialog only disables what the server
 * would refuse, so a person is not invited to try something that cannot work —
 * cancelling a call already ringing, or picking a time that has passed.
 */
function EditFollowUpDialog({
  followUp,
  onClose,
  onSaved,
}: {
  followUp: FollowUp;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialTime = followUp.scheduledTime ? toLocalInputValue(followUp.scheduledTime) : "";
  const [value, setValue] = useState(initialTime);
  const [nextAction, setNextAction] = useState(followUp.nextAction ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "cancel" | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [minTime] = useState(() => toLocalInputValue(new Date().toISOString()));

  const inFlight = followUp.status === "triggering" || followUp.status === "calling";
  const suppressed = Boolean(followUp.lead.suppressed);
  const cancelled = followUp.status === "cancelled";
  const finished = followUp.status === "completed";

  const timeChanged = value !== initialTime;
  const actionChanged = nextAction.trim() !== (followUp.nextAction ?? "").trim();

  const patch = async (body: Record<string, unknown>, kind: "save" | "cancel") => {
    setBusy(kind);
    setError(null);
    try {
      const response = await fetch("/api/follow-ups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: followUp.id, ...body }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "The change was not saved.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change was not saved.");
      setConfirmingCancel(false);
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    const body: Record<string, unknown> = {};
    if (timeChanged) {
      if (!value) {
        setError("Pick a date and time.");
        return;
      }
      const when = new Date(value);
      if (when.getTime() < Date.now() - 60_000) {
        setError("That time has already passed. Choose a time in the future.");
        return;
      }
      body.scheduledTime = when.toISOString();
    }
    if (actionChanged) body.nextAction = nextAction;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    patch(body, "save");
  };

  return (
    <Dialog title="Edit follow-up" onClose={onClose}>
      <div className="space-y-4 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {followUp.lead.name} · <span className="font-mono text-xs">{followUp.lead.phone}</span>
          </p>
          <Tag tone={inFlight ? "pending" : "neutral"}>{formatFollowUpStatus(followUp.status)}</Tag>
        </div>

        {/* What the customer actually asked for, next to what is scheduled. */}
        {followUp.requestedCallback && (
          <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs">
            <span className="text-muted-foreground">The customer asked: </span>
            <span className="font-medium">{followUp.requestedCallback}</span>
          </div>
        )}

        {inFlight && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            This callback is being placed right now, so it can&apos;t be changed. Edit it once the
            call&apos;s result is in.
          </p>
        )}
        {suppressed && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            This lead is on the do-not-call list. The callback can&apos;t be rescheduled.
          </p>
        )}
        {cancelled && !suppressed && (
          <p className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            Cancelled{followUp.cancelledBy === "admin" ? " by an admin" : ""}
            {followUp.cancelledAt ? ` on ${formatDateTime(followUp.cancelledAt)}` : ""}. Set a new
            time to reopen it.
          </p>
        )}

        <div>
          <label htmlFor="callback-time" className="text-xs font-medium text-muted-foreground">
            Callback time
          </label>
          <input
            id="callback-time"
            type="datetime-local"
            value={value}
            min={minTime}
            disabled={inFlight || suppressed}
            onChange={(event) => setValue(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            The call is placed automatically at this time, shown in your local time.
          </p>
        </div>

        <div>
          <label htmlFor="next-action" className="text-xs font-medium text-muted-foreground">
            Next action
          </label>
          <input
            id="next-action"
            type="text"
            value={nextAction}
            maxLength={500}
            onChange={(event) => setNextAction(event.target.value)}
            placeholder="e.g. Share pricing on the callback"
            className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t px-6 py-4">
        <div>
          {!cancelled && !finished && !inFlight &&
            (confirmingCancel ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Cancel this callback?</span>
                <button
                  onClick={() => patch({ status: "cancelled" }, "cancel")}
                  disabled={busy !== null}
                  className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {busy === "cancel" ? "Cancelling" : "Yes, cancel"}
                </button>
                <button
                  onClick={() => setConfirmingCancel(false)}
                  className="h-8 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted"
                >
                  Keep
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingCancel(true)}
                className="h-9 rounded-md px-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                Cancel callback
              </button>
            ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Close
          </button>
          <button
            onClick={save}
            disabled={busy !== null || inFlight || (!timeChanged && !actionChanged)}
            className="h-9 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "save" ? "Saving" : cancelled && timeChanged ? "Reopen" : "Save"}
          </button>
        </div>
      </footer>
    </Dialog>
  );
}

function AddFollowUpDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      // The lead is created first so the follow-up points at a real row rather
      // than an inline copy that nothing else can find.
      const leadResponse = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, notes: note }),
      });
      if (!leadResponse.ok) {
        const body = await leadResponse.json().catch(() => ({}));
        throw new Error(body.error || "Could not create the lead.");
      }
      const lead = (await leadResponse.json()) as Lead;

      const response = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          lead,
          previousResponse: note || null,
          scheduledTime: when ? new Date(when).toISOString() : null,
          nextAction: "Call the lead back",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Could not create the follow-up.");
      }

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the follow-up.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog title="Add follow-up" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="space-y-4 px-6 py-5">
          <TextField label="Name" value={name} onChange={setName} required placeholder="Customer name" />
          <TextField
            label="Phone"
            value={phone}
            onChange={setPhone}
            required
            mono
            placeholder="+91 98765 43210"
          />
          <TextField
            label="Note"
            value={note}
            onChange={setNote}
            placeholder="What they asked for"
          />
          <div>
            <label htmlFor="new-followup-time" className="text-xs font-medium text-muted-foreground">
              Callback time <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              id="new-followup-time"
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
              className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Leave blank to file it under &ldquo;needs a time&rdquo;.
            </p>
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || !name.trim() || !phone.trim()}
            className="h-9 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? "Saving" : "Add"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type="text"
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

/** Converts an ISO timestamp to the local value a `datetime-local` input expects. */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
