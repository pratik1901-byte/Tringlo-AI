"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Phone, RefreshCw, Search, ShieldOff, Trash2, Upload, Users } from "lucide-react";

import type { Lead } from "@/lib/types";
import { useAgentConfigStore } from "@/lib/store";
import { useLeads } from "@/lib/use-dialo-data";
import { useModalEntrance, useReveal } from "@/lib/animation";
import { EMPTY, formatText } from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
  StatusBadge,
} from "@/components/ui/data-display";
import { RealCallModal } from "@/components/call/RealCallModal";

export default function LeadsPage() {
  const { leads, error, isLoading, isRefreshing, refresh } = useLeads();
  const { config: agentConfig } = useAgentConfigStore();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [pendingAction, setPendingAction] = useState<
    { kind: "delete" | "suppress"; lead: Lead } | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const statuses = useMemo(
    () => Array.from(new Set(leads.map((lead) => lead.status))),
    [leads]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
      const matchesQuery =
        !needle ||
        lead.name.toLowerCase().includes(needle) ||
        lead.phone.includes(needle) ||
        (lead.company || "").toLowerCase().includes(needle) ||
        (lead.email || "").toLowerCase().includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [leads, query, statusFilter]);

  const tableRef = useReveal<HTMLTableSectionElement>({
    selector: "[data-row]",
    distance: 6,
    deps: [statusFilter, filtered.length],
    enabled: filtered.length > 0 && filtered.length <= 40,
  });

  const runAction = async () => {
    if (!pendingAction) return;
    const { kind, lead } = pendingAction;
    setActionError(null);

    try {
      const response =
        kind === "delete"
          ? await fetch(`/api/leads?id=${encodeURIComponent(lead.id)}`, { method: "DELETE" })
          : await fetch("/api/leads", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: lead.id,
                suppressed: true,
                reason: "Marked do-not-call from the Leads page.",
              }),
            });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "The change could not be saved.");
      }

      setPendingAction(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The change could not be saved.");
    }
  };

  const suppressedCount = leads.filter((lead) => lead.suppressed).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        description={
          isLoading
            ? "Loading leads"
            : `${leads.length} ${leads.length === 1 ? "lead" : "leads"}${
                suppressedCount > 0 ? ` · ${suppressedCount} do not call` : ""
              }`
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
            <Link
              href="/upload"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload leads
            </Link>
          </>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}

      {!isLoading && leads.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No leads yet"
          description="Upload a CSV to get started. Each lead can be called individually or as part of a campaign."
          action={
            <Link
              href="/upload"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Upload className="h-4 w-4" />
              Upload leads CSV
            </Link>
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative lg:max-w-xs lg:flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, phone, company or email"
                className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by status">
              <FilterButton
                active={statusFilter === "all"}
                onClick={() => setStatusFilter("all")}
                label={`All (${leads.length})`}
              />
              {statuses.map((status) => (
                <FilterButton
                  key={status}
                  active={statusFilter === status}
                  onClick={() => setStatusFilter(status)}
                  label={`${status.replace(/_/g, " ")} (${
                    leads.filter((lead) => lead.status === status).length
                  })`}
                />
              ))}
            </nav>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="hidden px-4 py-3 md:table-cell">Company</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Scheduled</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                {isLoading ? (
                  <SkeletonRows rows={6} columns={6} />
                ) : (
                  <tbody ref={tableRef}>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-14 text-center text-sm text-muted-foreground">
                          No leads match these filters.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((lead) => (
                        <tr
                          key={lead.id}
                          data-row
                          className="group border-b transition-colors last:border-b-0 hover:bg-muted/40"
                        >
                          <td className="px-5 py-3.5">
                            <p className="font-medium leading-tight">{lead.name}</p>
                            {lead.email && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{lead.email}</p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs">{lead.phone}</td>
                          <td className="hidden px-4 py-3.5 text-muted-foreground md:table-cell">
                            {formatText(lead.company)}
                          </td>
                          <td className="hidden px-4 py-3.5 text-xs text-muted-foreground lg:table-cell">
                            {lead.callingDate ? `${lead.callingDate} · ${lead.callingTime}` : EMPTY}
                          </td>
                          <td className="px-4 py-3.5">
                            <StatusBadge status={lead.status} showPulse />
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              {lead.suppressed ? (
                                <span
                                  className="text-xs text-muted-foreground"
                                  title={lead.suppressedReason ?? undefined}
                                >
                                  Do not call
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setActiveLead(lead)}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                                  >
                                    <Phone className="h-3.5 w-3.5" />
                                    Call
                                  </button>
                                  <button
                                    onClick={() => setPendingAction({ kind: "suppress", lead })}
                                    title="Mark do not call"
                                    aria-label={`Mark ${lead.name} do not call`}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                                  >
                                    <ShieldOff className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setPendingAction({ kind: "delete", lead })}
                                title="Delete lead"
                                aria-label={`Delete ${lead.name}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
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
                Showing {filtered.length} of {leads.length}
              </div>
            )}
          </div>
        </>
      )}

      {pendingAction && (
        <ConfirmDialog
          action={pendingAction}
          error={actionError}
          onConfirm={runAction}
          onCancel={() => {
            setPendingAction(null);
            setActionError(null);
          }}
        />
      )}

      {activeLead && (
        <RealCallModal
          lead={activeLead}
          agentConfig={agentConfig}
          onClose={() => {
            setActiveLead(null);
            refresh();
          }}
          onSettled={refresh}
        />
      )}
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active}
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ConfirmDialog({
  action,
  error,
  onConfirm,
  onCancel,
}: {
  action: { kind: "delete" | "suppress"; lead: Lead };
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { backdropRef, panelRef } = useModalEntrance();
  const isDelete = action.kind === "delete";

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
      role="alertdialog"
      aria-modal="true"
    >
      <div ref={panelRef} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          {isDelete ? `Delete ${action.lead.name}?` : `Mark ${action.lead.name} do not call?`}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isDelete
            ? "The lead is removed from the database. Call records for this lead are kept."
            : "Dialo will refuse to place any further call to this number, and pending callbacks for it are cancelled."}
        </p>

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`h-9 rounded-md px-3.5 text-sm font-medium text-white transition-colors ${
              isDelete ? "bg-destructive hover:bg-destructive/90" : "bg-foreground hover:bg-foreground/90"
            }`}
          >
            {isDelete ? "Delete" : "Mark do not call"}
          </button>
        </div>
      </div>
    </div>
  );
}
