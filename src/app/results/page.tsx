"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ClipboardList, Download, PhoneCall, RefreshCw, Search, X } from "lucide-react";

import type { ContactSummary } from "@/lib/contacts";
import { callDirection, type CallRecord } from "@/lib/types";
import { useAgentConfigStore } from "@/lib/store";
import { useApi } from "@/lib/use-dialo-data";
import { useNow } from "@/lib/use-now";
import { useModalEntrance, useReveal } from "@/lib/animation";
import { exportToCSV } from "@/lib/csv-utils";
import {
  EMPTY,
  formatDate,
  formatDateTime,
  formatDuration,
  formatInterest,
  formatLabel,
  formatOutcome,
  formatPhone,
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
import { ModalBody } from "@/components/ui/modal-body";
import { RealCallModal } from "@/components/call/RealCallModal";
import { TranscriptView } from "@/components/call/TranscriptView";

// ============================================================
// Results — one row per person
// ============================================================
//
// A contact is everyone in the workspace sharing a phone number. The row
// shows how often we called them and they called us; the contact panel
// splits their calls into Outbound and Inbound, and each call opens its full
// details (summary, transcript, recording).
// ============================================================

type TabFilter = "all" | "outbound" | "inbound" | "interested" | "follow_up";

const TABS: Array<{ id: TabFilter; label: string }> = [
  { id: "all", label: "All contacts" },
  { id: "outbound", label: "We called" },
  { id: "inbound", label: "Called us" },
  { id: "interested", label: "Interested" },
  { id: "follow_up", label: "Follow-up pending" },
];

interface ContactsResponse {
  contacts: ContactSummary[];
  totals: { contacts: number; outbound: number; inbound: number };
}



function latestOutcome(contact: ContactSummary): string {
  if (!contact.latest) return EMPTY;
  return contact.latest.direction === "inbound" ? formatLabel(contact.latest.outcome) : formatOutcome(contact.latest.outcome);
}

export function DirectionTag({ direction }: { direction: "outbound" | "inbound" }) {
  const inbound = direction === "inbound";
  const Icon = inbound ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11px] font-medium ${
        inbound
          ? "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
          : "bg-accent text-accent-foreground"
      }`}
    >
      <Icon className="h-3 w-3" />
      {inbound ? "Inbound" : "Outbound"}
    </span>
  );
}

function Counts({ contact }: { contact: ContactSummary }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      <span title="Calls we placed" className="inline-flex items-center gap-0.5">
        <ArrowUpRight className="h-3 w-3 text-accent-foreground" />
        {contact.outboundCount}
      </span>
      <span title="Calls they made to us" className="inline-flex items-center gap-0.5">
        <ArrowDownLeft className="h-3 w-3 text-teal-600 dark:text-teal-400" />
        {contact.inboundCount}
      </span>
    </span>
  );
}

function followUpText(value: string | null): string {
  if (!value) return EMPTY;
  return value === "needs a time" ? "Needs a time" : formatDateTime(value);
}

export default function ResultsPage() {
  const { data, error, isLoading, isRefreshing, refresh } = useApi<ContactsResponse>("/api/contacts", 10_000);
  const contacts = useMemo(() => data?.contacts ?? [], [data]);
  const now = useNow(60_000);

  const [tab, setTab] = useState<TabFilter>("all");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => {
      const matchesTab =
        tab === "all"
          ? true
          : tab === "outbound"
            ? contact.outboundCount > 0
            : tab === "inbound"
              ? contact.inboundCount > 0
              : tab === "interested"
                ? contact.interest === "high" || contact.interest === "medium"
                : contact.followUpAt !== null;
      const matchesQuery =
        !needle || contact.name.toLowerCase().includes(needle) || contact.phone.replace(/\s/g, "").includes(needle.replace(/\s/g, ""));
      const at = contact.lastInteractionAt;
      let matchesDate = true;
      if (startDate && at) matchesDate = new Date(at) >= new Date(startDate);
      if (endDate && at && matchesDate) matchesDate = new Date(at) <= new Date(`${endDate}T23:59:59`);
      return matchesTab && matchesQuery && matchesDate;
    });
  }, [contacts, tab, query, startDate, endDate]);

  const tableRef = useReveal<HTMLTableSectionElement>({
    selector: "[data-row]",
    distance: 6,
    deps: [tab, filtered.length],
    enabled: filtered.length > 0 && filtered.length <= 40,
  });

  const selected = selectedKey ? contacts.find((contact) => contact.key === selectedKey) ?? null : null;

  const handleExport = () => {
    exportToCSV(
      filtered.map((contact) => ({
        Name: contact.name,
        Phone: contact.phone,
        "Outbound calls": contact.outboundCount,
        "Inbound calls": contact.inboundCount,
        "Last outbound": formatDate(contact.lastOutboundAt),
        "Last inbound": formatDate(contact.lastInboundAt),
        "Latest call": contact.latest ? `${contact.latest.direction} · ${contact.latest.status}` : EMPTY,
        "Latest outcome": latestOutcome(contact),
        Interest: formatInterest(contact.interest),
        "Follow-up": followUpText(contact.followUpAt),
        "Do not call": contact.suppressed ? "Yes" : "No",
      })),
      `dialo_contacts_${new Date().toISOString().split("T")[0]}.csv`
    );
  };

  // One row per call, for reporting on what was said rather than on who was
  // reached. The contact list on screen cannot answer that, so the calls are
  // fetched when the export is actually asked for.
  const [exportingCalls, setExportingCalls] = useState(false);
  const handleExportCalls = async () => {
    setExportingCalls(true);
    try {
      const response = await fetch("/api/records?limit=200", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body: { records: CallRecord[] } = await response.json();
      exportToCSV(
        body.records.map((record) => ({
          Name: record.lead.name,
          Phone: record.lead.phone,
          Direction: callDirection(record),
          Status: record.status,
          Outcome:
            callDirection(record) === "inbound"
              ? formatLabel(record.resolutionStatus)
              : formatOutcome(record.aiResult?.status),
          "Reason for call": callDirection(record) === "inbound" ? formatLabel(record.intent) : EMPTY,
          "Human handoff": callDirection(record) === "inbound" ? transferText(record) ?? EMPTY : EMPTY,
          Interest: formatInterest(record.interestLevel),
          Duration: formatDuration(record.duration),
          "Call date": formatDateTime(record.startedAt || record.requestedAt),
          Summary: record.aiSummary ?? EMPTY,
          "Next action": formatLabel(record.nextAction),
          "Attempt ID": record.providerAttemptId ?? EMPTY,
        })),
        `dialo_calls_${new Date().toISOString().split("T")[0]}.csv`
      );
    } catch {
      setExportError("The calls could not be exported. Try again.");
    } finally {
      setExportingCalls(false);
    }
  };

  const totals = data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Results"
        description={
          isLoading || !totals
            ? "Loading contacts"
            : `${totals.contacts} ${totals.contacts === 1 ? "contact" : "contacts"} · ${totals.outbound} outbound and ${totals.inbound} inbound ${totals.outbound + totals.inbound === 1 ? "call" : "calls"}`
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
              Contacts CSV
            </button>
            <button
              onClick={handleExportCalls}
              disabled={exportingCalls || contacts.length === 0}
              title="Every call, with its summary and outcome"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Download className={`h-3.5 w-3.5 ${exportingCalls ? "animate-pulse" : ""}`} />
              Calls CSV
            </button>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}
      {exportError && <p className="text-xs text-red-600 dark:text-red-400">{exportError}</p>}

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav
          className="flex flex-wrap items-center gap-1 phone:-mx-4 phone:flex-nowrap phone:overflow-x-auto phone:px-4 phone:pb-1 phone:[scrollbar-width:none]"
          aria-label="Filter contacts"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors phone:h-10 phone:shrink-0 phone:whitespace-nowrap phone:px-3 ${
                tab === item.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center phone:flex-col! phone:items-stretch!">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground phone:top-3.5" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or phone"
              className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring sm:w-64 phone:h-11 phone:w-full!"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              aria-label="From date"
              className="h-9 rounded-md border bg-card px-2.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11 phone:min-w-0 phone:flex-1"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              aria-label="To date"
              className="h-9 rounded-md border bg-card px-2.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11 phone:min-w-0 phone:flex-1"
            />
          </div>
        </div>
      </div>

      {!isLoading && contacts.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No calls yet"
          description="Call a lead from the Leads page. The person appears here the moment Sarvam reports the outcome."
        />
      ) : (
        <>
          {/* Phone: one card per contact. */}
          <div className="hidden phone:block">
            {isLoading ? (
              <ul className="space-y-2" aria-busy="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <li key={index} className="h-[92px] animate-pulse rounded-lg border bg-card" />
                ))}
              </ul>
            ) : filtered.length === 0 ? (
              <p className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                No contacts match these filters.
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {filtered.map((contact) => (
                    <li key={contact.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedKey(contact.key)}
                        className="w-full rounded-lg border bg-card px-4 py-3 text-left transition-colors active:bg-muted/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium leading-tight">{contact.name}</p>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{formatPhone(contact.phone)}</p>
                          </div>
                          {contact.latest && <DirectionTag direction={contact.latest.direction} />}
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <Counts contact={contact} />
                          <span>{latestOutcome(contact)}</span>
                          <span>Interest {formatInterest(contact.interest)}</span>
                          <span className="ml-auto">{formatDate(contact.lastInteractionAt)}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Showing {filtered.length} of {contacts.length}
                </p>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border bg-card phone:hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Calls</th>
                    <th className="px-4 py-3">Latest call</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3">Interest</th>
                    <th className="px-4 py-3">Follow-up</th>
                    <th className="px-4 py-3">Last contact</th>
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
                          No contacts match these filters.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((contact) => (
                        <tr key={contact.key} data-row className="border-b transition-colors last:border-b-0 hover:bg-muted/40">
                          <td className="px-5 py-3.5 font-medium">
                            {contact.name}
                            {contact.suppressed && (
                              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">DND</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">{formatPhone(contact.phone)}</td>
                          <td className="px-4 py-3.5">
                            <Counts contact={contact} />
                          </td>
                          <td className="px-4 py-3.5">
                            {contact.latest ? (
                              <span className="inline-flex items-center gap-2">
                                <DirectionTag direction={contact.latest.direction} />
                                <StatusBadge status={contact.latest.status as CallRecord["status"]} now={now} />
                              </span>
                            ) : (
                              EMPTY
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-xs text-muted-foreground">{latestOutcome(contact)}</td>
                          <td className="px-4 py-3.5 text-xs">{formatInterest(contact.interest)}</td>
                          <td className="px-4 py-3.5 text-xs text-muted-foreground">{followUpText(contact.followUpAt)}</td>
                          <td className="px-4 py-3.5 text-xs text-muted-foreground">{formatDate(contact.lastInteractionAt)}</td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              onClick={() => setSelectedKey(contact.key)}
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
                Showing {filtered.length} of {contacts.length}
              </div>
            )}
          </div>
        </>
      )}

      {selected && <ContactPanel contact={selected} now={now} onClose={() => setSelectedKey(null)} onChanged={refresh} />}
    </div>
  );
}

// ------------------------------------------------------------

/** One contact: their calls, split by who called whom. */
function ContactPanel({
  contact,
  now,
  onClose,
  onChanged,
}: {
  contact: ContactSummary;
  now: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { backdropRef, panelRef } = useModalEntrance();
  const { data, error, isLoading, refresh } = useApi<{ contact: ContactSummary; calls: CallRecord[] }>(
    `/api/contacts?key=${encodeURIComponent(contact.key)}`,
    10_000
  );
  const { config: agentConfig } = useAgentConfigStore();
  const calls = useMemo(() => data?.calls ?? [], [data]);
  const [direction, setDirection] = useState<"outbound" | "inbound">(contact.outboundCount === 0 && contact.inboundCount > 0 ? "inbound" : "outbound");
  const [openCallId, setOpenCallId] = useState<string | null>(null);
  const [expandedCallId, setExpandedCallId] = useState<string | null | undefined>(undefined);
  const [recallRecord, setRecallRecord] = useState<CallRecord | null>(null);

  const shown = calls.filter((call) => callDirection(call) === direction);
  const expanded = expandedCallId === undefined ? shown[0]?.id ?? null : expandedCallId;
  const openCall = openCallId ? calls.find((call) => call.id === openCallId) ?? null : null;

  if (openCall) {
    return (
      <CallDetailPanel
        record={openCall}
        now={now}
        onClose={() => setOpenCallId(null)}
        onRecall={() => {
          setRecallRecord(openCall);
          setOpenCallId(null);
        }}
      />
    );
  }

  if (recallRecord) {
    return (
      <RealCallModal
        lead={recallRecord.lead}
        agentConfig={agentConfig}
        onClose={() => {
          setRecallRecord(null);
          refresh();
          onChanged();
        }}
        onSettled={() => {
          refresh();
          onChanged();
        }}
      />
    );
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 phone:items-end phone:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Calls with ${contact.name}`}
    >
      <div
        ref={panelRef}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl phone:max-h-[92dvh] phone:max-w-none phone:rounded-b-none phone:rounded-t-2xl phone:border-x-0 phone:border-b-0 phone:pb-safe"
      >
        <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-semibold tracking-tight">{contact.name}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{formatPhone(contact.phone)}</span>
              {contact.suppressed ? " · On the do-not-call list" : ""}
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

        <ModalBody className="space-y-5 px-6 py-5" hint="More calls below">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Field label="Last outbound" value={formatDate(contact.lastOutboundAt)} />
            <Field label="Last inbound" value={formatDate(contact.lastInboundAt)} />
            <Field label="Interest" value={formatInterest(contact.interest)} />
            <Field label="Follow-up" value={followUpText(contact.followUpAt)} />
          </dl>

          <div role="tablist" aria-label="Call direction" className="flex gap-1 border-b">
            {(["outbound", "inbound"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={direction === value}
                onClick={() => {
                  setDirection(value);
                  setExpandedCallId(undefined);
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  direction === value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {value === "outbound" ? `Outbound (${contact.outboundCount})` : `Inbound (${contact.inboundCount})`}
              </button>
            ))}
          </div>

          {error && <ErrorState message={error} onRetry={refresh} />}
          {isLoading && !data ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading calls…</p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {direction === "outbound" ? "We have not called this contact." : "This contact has not called us."}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {shown.map((call) => {
                const isOpen = expanded === call.id;
                return (
                <li key={call.id}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setExpandedCallId(isOpen ? null : call.id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{formatDateTime(call.startedAt || call.requestedAt)}</p>
                      <p className={`mt-0.5 text-xs text-muted-foreground ${isOpen ? "" : "line-clamp-2"}`}>
                        {direction === "inbound"
                          ? [call.intent ? `Reason: ${formatLabel(call.intent)}` : null, call.resolutionStatus ? formatLabel(call.resolutionStatus) : null, transferText(call)]
                              .filter(Boolean)
                              .join(" · ") || call.aiSummary || EMPTY
                          : call.aiSummary || formatOutcome(call.aiResult?.status)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusBadge status={call.status} requestedAt={call.requestedAt} now={now} />
                      <span className="font-mono text-[11px] text-muted-foreground">{formatDuration(call.duration)}</span>
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {isOpen && (
                    <div className="space-y-4 border-t bg-muted/20 px-4 py-4">
                      {call.status === "connected" && call.providerInteractionId && <CallRecording callId={call.id} />}
                      <TranscriptView turns={call.transcriptTurns} status={call.status} />
                      <button
                        type="button"
                        onClick={() => setOpenCallId(call.id)}
                        className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
                      >
                        Full details, including what the agent reported
                      </button>
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </ModalBody>

        <footer className="flex items-center justify-end border-t px-6 py-4">
          <button onClick={onClose} className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/** What happened about a person, stated only as Sarvam confirmed it. */
function transferText(call: CallRecord): string | null {
  switch (call.humanHandoffStatus) {
    case "transferred":
      return "Transferred to a person";
    case "transfer_failed":
      return "Asked for a person — not transferred";
    case "requested":
    case "assigned":
      return "Asked for a person — transfer not yet confirmed";
    case "completed":
      return "Handed to the team";
    default:
      return call.humanHandoffRequired ? "Asked for a person" : null;
  }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 phone:items-end phone:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Call details for ${record.lead.name}`}
    >
      <div
        ref={panelRef}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl phone:max-h-[92dvh] phone:max-w-none phone:rounded-b-none phone:rounded-t-2xl phone:border-x-0 phone:border-b-0 phone:pb-safe"
      >
        <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="font-heading text-base font-semibold tracking-tight">
                {record.lead.name}
              </h2>
              <DirectionTag direction={callDirection(record)} />
              <StatusBadge status={record.status} requestedAt={record.requestedAt} now={now} />
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{formatPhone(record.lead.phone)}</span>
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

        <ModalBody className="space-y-6 px-6 py-6" hint="Transcript and recording below">
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
          </dl>

          {callDirection(record) === "inbound" && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg border bg-muted/20 px-4 py-4 sm:grid-cols-4">
              <Field label="Reason for call" value={record.intent ? formatLabel(record.intent) : EMPTY} />
              <Field label="Resolution" value={record.resolutionStatus ? formatLabel(record.resolutionStatus) : EMPTY} />
              <Field label="Human handoff" value={transferText(record) ?? "Not requested"} />
              <Field label="Transferred to" value={record.humanHandoffStatus === "transferred" ? record.transferredTo ?? EMPTY : EMPTY} mono />
              <Field label="Line called" value={record.inboundNumber ?? EMPTY} mono />
            </dl>
          )}

          {record.failureReason && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              {record.failureReason}
            </div>
          )}

          {/* Only a connected call was recorded. The audio is Sarvam's own
              recording, served through Tringlo — never synthesised from the
              transcript. */}
          {record.status === "connected" && record.providerInteractionId && (
            <CallRecording callId={record.id} />
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

          {record.status === "connected" && callDirection(record) === "outbound" && (
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

          {/* Provider identifiers: needed when checking a call against Sarvam,
              not while reading one. */}
          <dl className="grid gap-x-6 gap-y-2 border-t pt-4 text-[11px] sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Attempt</dt>
              <dd className="truncate font-mono">{record.providerAttemptId ?? EMPTY}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Interaction</dt>
              <dd className="truncate font-mono">{record.providerInteractionId ?? EMPTY}</dd>
            </div>
          </dl>
        </ModalBody>

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
  // Names the format explicitly, so the download URL differs from anything a
  // browser cached back when this endpoint served WAV.
  const downloadHref = `${src}?format=mp3&download=1`;
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
            href={downloadHref}
            download
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
          <a href={downloadHref} download>Download the recording as MP3</a>
        </audio>
      )}
    </section>
  );
}
