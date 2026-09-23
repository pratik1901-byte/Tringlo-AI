"use client";

import { useMemo, useState } from "react";
import { ClipboardList, Download, PhoneCall, RefreshCw, Search, X } from "lucide-react";

import type { CallRecord } from "@/lib/types";
import { useAgentConfigStore } from "@/lib/store";
import { useCallRecords } from "@/lib/use-dialo-data";
import { useNow } from "@/lib/use-now";
import { useModalEntrance, useReveal } from "@/lib/animation";
import { exportToCSV } from "@/lib/csv-utils";
import { isConnected, isInterested, isNotInterested } from "@/lib/metrics";
import {
  EMPTY,
  formatDate,
  formatDateTime,
  formatDuration,
  formatInterest,
  formatOutcome,
  formatText,
} from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui/data-display";
import { RealCallModal } from "@/components/call/RealCallModal";
import { TranscriptView } from "@/components/call/TranscriptView";

type TabFilter = "all" | "connected" | "interested" | "not_interested" | "unreached";

const TABS: Array<{ id: TabFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "connected", label: "Answered" },
  { id: "interested", label: "Interested" },
  { id: "not_interested", label: "Not interested" },
  { id: "unreached", label: "Not reached" },
];

export default function ResultsPage() {
  const { records, error, isLoading, isRefreshing, refresh } = useCallRecords();
  const { config: agentConfig } = useAgentConfigStore();
  const now = useNow(60_000);

  const [tab, setTab] = useState<TabFilter>("all");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recallRecord, setRecallRecord] = useState<CallRecord | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return records.filter((record) => {
      const matchesTab =
        tab === "all"
          ? true
          : tab === "connected"
            ? isConnected(record)
            : tab === "interested"
              ? isInterested(record)
              : tab === "not_interested"
                ? isNotInterested(record)
                : record.status === "no_answer" ||
                  record.status === "busy" ||
                  record.status === "failed";

      const matchesQuery =
        !needle ||
        record.lead.name.toLowerCase().includes(needle) ||
        record.lead.phone.includes(needle) ||
        (record.aiSummary || "").toLowerCase().includes(needle) ||
        (record.nextAction || "").toLowerCase().includes(needle);

      const timestamp = record.startedAt || record.requestedAt;
      let matchesDate = true;
      if (startDate && timestamp) matchesDate = new Date(timestamp) >= new Date(startDate);
      if (endDate && timestamp && matchesDate) {
        matchesDate = new Date(timestamp) <= new Date(`${endDate}T23:59:59`);
      }

      return matchesTab && matchesQuery && matchesDate;
    });
  }, [records, tab, query, startDate, endDate]);

  const tableRef = useReveal<HTMLTableSectionElement>({
    selector: "[data-row]",
    distance: 6,
    deps: [tab, filtered.length],
    enabled: filtered.length > 0 && filtered.length <= 40,
  });

  const selected = selectedId ? records.find((record) => record.id === selectedId) ?? null : null;

  // Only fields that exist get exported. Missing values become an em dash rather
  // than an empty cell that a spreadsheet would read as zero.
  const handleExport = () => {
    exportToCSV(
      filtered.map((record) => ({
        Name: record.lead.name,
        Phone: record.lead.phone,
        Status: record.status,
        Outcome: formatOutcome(record.aiResult?.status),
        Interest: formatInterest(record.interestLevel),
        Confidence:
          record.interestConfidence === null || record.interestConfidence === undefined
            ? EMPTY
            : `${record.interestConfidence}%`,
        Duration: formatDuration(record.duration),
        "Call date": formatDate(record.startedAt || record.requestedAt),
        Summary: record.aiSummary ?? EMPTY,
        "Next action": record.nextAction ?? EMPTY,
        "Follow-up": formatDate(record.aiResult?.callback_datetime),
        "Attempt ID": record.providerAttemptId ?? EMPTY,
      })),
      `dialo_results_${new Date().toISOString().split("T")[0]}.csv`
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Results"
        description={
          isLoading
            ? "Loading call records"
            : `${records.length} ${records.length === 1 ? "call" : "calls"} from Sarvam`
        }
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
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Filter results">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                tab === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone or summary"
              className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-label="From date"
              className="h-9 rounded-md border bg-card px-2.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-label="To date"
              className="h-9 rounded-md border bg-card px-2.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {!isLoading && records.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No calls yet"
          description="Call a lead from the Leads page. The result appears here the moment Sarvam reports the outcome."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Interest</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-5 py-3 text-right">Details</th>
                </tr>
              </thead>

              {isLoading ? (
                <SkeletonRows rows={6} columns={9} />
              ) : (
                <tbody ref={tableRef}>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-5 py-14 text-center text-sm text-muted-foreground">
                        No calls match these filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((record) => (
                      <tr
                        key={record.id}
                        data-row
                        className="border-b transition-colors last:border-b-0 hover:bg-muted/40"
                      >
                        <td className="px-5 py-3.5 font-medium">{record.lead.name}</td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {record.lead.phone}
                        </td>
                        <td className="px-4 py-3.5">
                          <StatusBadge
                            status={record.status}
                            requestedAt={record.requestedAt}
                            now={now}
                            showPulse
                          />
                        </td>
                        <td className="px-4 py-3.5 text-xs text-muted-foreground">
                          {formatOutcome(record.aiResult?.status)}
                        </td>
                        <td className="px-4 py-3.5 text-xs">{formatInterest(record.interestLevel)}</td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {record.interestConfidence === null ||
                          record.interestConfidence === undefined
                            ? EMPTY
                            : `${record.interestConfidence}%`}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                          {formatDuration(record.duration)}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-muted-foreground">
                          {formatDate(record.startedAt || record.requestedAt)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => setSelectedId(record.id)}
                            className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              )}
            </table>
          </div>

          {!isLoading && filtered.length > 0 && (
            <div className="border-t px-5 py-2.5 text-xs text-muted-foreground">
              Showing {filtered.length} of {records.length}
            </div>
          )}
        </div>
      )}

      {selected && (
        <CallDetailPanel
          record={selected}
          now={now}
          onClose={() => setSelectedId(null)}
          onRecall={() => {
            setRecallRecord(selected);
            setSelectedId(null);
          }}
        />
      )}

      {recallRecord && (
        <RealCallModal
          lead={recallRecord.lead}
          agentConfig={agentConfig}
          onClose={() => {
            setRecallRecord(null);
            refresh();
          }}
          onSettled={refresh}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------

function CallDetailPanel({
  record,
  now,
  onClose,
  onRecall,
}: {
  record: CallRecord;
  now: number;
  onClose: () => void;
  onRecall: () => void;
}) {
  const { backdropRef, panelRef } = useModalEntrance();

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Call details for ${record.lead.name}`}
    >
      <div
        ref={panelRef}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                {record.lead.name}
              </h2>
              <StatusBadge status={record.status} requestedAt={record.requestedAt} now={now} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{record.lead.phone}</span>
              {record.lead.company ? ` · ${record.lead.company}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Field label="Duration" value={formatDuration(record.duration)} mono />
            <Field label="Outcome" value={formatOutcome(record.aiResult?.status)} />
            <Field label="Interest" value={formatInterest(record.interestLevel)} />
            <Field
              label="Confidence"
              value={
                record.interestConfidence === null || record.interestConfidence === undefined
                  ? EMPTY
                  : `${record.interestConfidence}%`
              }
              mono
            />
            <Field label="Started" value={formatDateTime(record.startedAt)} />
            <Field label="Ended" value={formatDateTime(record.endedAt)} />
            <Field label="Attempt" value={record.providerAttemptId ?? EMPTY} mono />
            <Field label="Interaction" value={record.providerInteractionId ?? EMPTY} mono />
          </dl>

          {record.failureReason && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              {record.failureReason}
            </div>
          )}

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Summary
            </h3>
            <p className="mt-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
              {record.aiSummary ? (
                record.aiSummary
              ) : (
                <span className="text-muted-foreground">
                  {record.status === "connected"
                    ? "The agent did not return a summary for this call."
                    : "No conversation took place, so there is no summary."}
                </span>
              )}
            </p>
          </section>

          {record.status === "connected" && (
            <dl className="grid gap-5 rounded-lg border bg-muted/20 px-4 py-4 sm:grid-cols-2">
              <Field label="Pain points" value={formatText(record.painPoints)} className="sm:col-span-2" />
              <Field label="Requirement" value={formatText(record.customerRequirement)} className="sm:col-span-2" />
              <Field label="Objection" value={formatText(record.objection)} />
              <Field label="Budget" value={formatText(record.budgetIndication)} />
              <Field label="Timeline" value={formatText(record.timelineToDecide)} />
              <Field label="Next action" value={formatText(record.nextAction)} />
              <Field label="Disposition" value={formatText(record.callDisposition)} />
              <Field label="Fit score" value={formatText(record.discoveryFitScore?.toString())} />
            </dl>
          )}

          <TranscriptView turns={record.transcriptTurns} status={record.status} />

          {/* Only a connected call was recorded. The audio is Sarvam's own
              recording, served through Dialo — never synthesised from the
              transcript. */}
          {record.status === "connected" && record.providerInteractionId && (
            <CallRecording callId={record.id} />
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <p className="text-xs text-muted-foreground">
            Attempt {record.attempts} · {record.provider}
          </p>
          <div className="flex items-center gap-2">
            {record.lead.suppressed ? (
              <span className="text-xs text-muted-foreground">
                This lead is on the do-not-call list.
              </span>
            ) : (
              <button
                onClick={onRecall}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <PhoneCall className="h-3.5 w-3.5" />
                Call again
              </button>
            )}
            <button
              onClick={onClose}
              className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------

/**
 * The call's recording, with a player and a download.
 *
 * Nothing is fetched until the reader presses play or download: a recording is
 * a few megabytes, and opening a call's details should not pull audio nobody
 * asked for. When Sarvam cannot supply it, the reason is shown rather than a
 * player that silently does nothing.
 */
function CallRecording({ callId }: { callId: string }) {
  const src = `/api/calls/${encodeURIComponent(callId)}/recording`;
  const [error, setError] = useState<string | null>(null);

  const onError = async () => {
    try {
      const response = await fetch(src, { method: "GET", headers: { Range: "bytes=0-0" } });
      if (response.ok) return;
      const body = await response.json().catch(() => ({}));
      setError(body.error || "The recording could not be loaded.");
    } catch {
      setError("The recording could not be loaded.");
    }
  };

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recording
        </h3>
        {!error && (
          <a
            href={`${src}?download=1`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            <Download className="h-3.5 w-3.5" />
            {/* Says the format, because someone downloading a call usually
                wants to attach or forward it and needs to know what it is. */}
            Download MP3
          </a>
        )}
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          {error}
        </p>
      ) : (
        <audio controls preload="none" src={src} onError={onError} className="mt-2 w-full">
          <a href={`${src}?download=1`}>Download the recording as MP3</a>
        </audio>
      )}
    </section>
  );
}
