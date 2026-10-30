"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Pencil, Phone, RefreshCw, Search, ShieldOff, Trash2, Upload, Users } from "lucide-react";

import type { Lead } from "@/lib/types";
import { isPlaceholderName } from "@/lib/customers/placeholder";
import { useAgentConfigStore } from "@/lib/store";
import { useLeads } from "@/lib/use-tringlo-data";
import { useModalEntrance, useReveal } from "@/lib/animation";
import { EMPTY, formatPhone, formatText } from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonRows,
} from "@/components/ui/data-display";
import { RealCallModal } from "@/components/call/RealCallModal";

export default function LeadsPage() {
  const { leads, error, isLoading, isRefreshing, refresh } = useLeads();
  const { config: agentConfig } = useAgentConfigStore();

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
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
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground phone:top-3.5" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, phone, company or email"
                className="h-9 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring phone:h-11"
              />
            </div>

            <nav
              className="flex flex-wrap items-center gap-1 phone:-mx-4 phone:flex-nowrap phone:overflow-x-auto phone:px-4 phone:pb-1 phone:[scrollbar-width:none]"
              aria-label="Filter by status"
            >
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

          {/* Phone: one card per lead with its actions always showing.

              On the desktop the row actions appear on hover. A phone has no
              hover, so there they would stay invisible — including the Call
              button, which is the reason to open this page on a phone. */}
          <div className="hidden phone:block">
            {isLoading ? (
              <ul className="space-y-2" aria-busy="true">
                {Array.from({ length: 4 }, (_, index) => (
                  <li key={index} className="h-[104px] animate-pulse rounded-lg border bg-card" />
                ))}
              </ul>
            ) : filtered.length === 0 ? (
              <p className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
                No leads match these filters.
              </p>
            ) : (
              <ul className="space-y-2">
                {filtered.map((lead) => (
                  <li key={lead.id} className="rounded-lg border bg-card px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium leading-tight">
                        {lead.name}
                        <AddNameButton lead={lead} onEdit={setEditingLead} />
                      </p>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {formatPhone(lead.phone)}
                        {lead.company ? ` · ${lead.company}` : ""}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {lead.suppressed ? (
                        <span
                          className="flex h-11 flex-1 items-center text-sm text-muted-foreground"
                          title={lead.suppressedReason ?? undefined}
                        >
                          Do not call
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => setActiveLead(lead)}
                            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground active:bg-primary/90"
                          >
                            <Phone className="h-4 w-4" />
                            Call {lead.name.split(" ")[0]}
                          </button>
                          <button
                            onClick={() => setPendingAction({ kind: "suppress", lead })}
                            aria-label={`Mark ${lead.name} do not call`}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-muted-foreground active:bg-muted"
                          >
                            <ShieldOff className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => setEditingLead(lead)}
                        aria-label={`Edit ${lead.name}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-muted-foreground active:bg-muted"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setPendingAction({ kind: "delete", lead })}
                        aria-label={`Delete ${lead.name}`}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-md border text-muted-foreground active:bg-destructive/10 active:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border bg-card phone:hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="hidden px-4 py-3 md:table-cell">Company</th>
                    <th className="hidden px-4 py-3 lg:table-cell">Scheduled</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                {isLoading ? (
                  <SkeletonRows rows={6} columns={5} />
                ) : (
                  <tbody ref={tableRef}>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-5 py-14 text-center text-sm text-muted-foreground">
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
                            <p className="font-medium leading-tight">
                              {lead.name}
                              <AddNameButton lead={lead} onEdit={setEditingLead} />
                            </p>
                            {lead.email && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{lead.email}</p>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs">{formatPhone(lead.phone)}</td>
                          <td className="hidden px-4 py-3.5 text-muted-foreground md:table-cell">
                            {formatText(lead.company)}
                          </td>
                          <td className="hidden px-4 py-3.5 text-xs text-muted-foreground lg:table-cell">
                            {lead.callingDate && lead.callingTime ? `${lead.callingDate} · ${lead.callingTime}` : lead.callingDate || EMPTY}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
                                onClick={() => setEditingLead(lead)}
                                title="Edit lead"
                                aria-label={`Edit ${lead.name}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
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

      {editingLead && (
        <EditLeadDialog
          lead={editingLead}
          onClose={() => setEditingLead(null)}
          onSaved={() => {
            setEditingLead(null);
            refresh();
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
      // On a phone the filters sit in one scrolling row: `shrink-0` stops them
      // squashing, and the extra height makes each one a real touch target.
      className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors phone:h-9 phone:shrink-0 phone:whitespace-nowrap phone:px-3 ${
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 phone:items-end phone:p-0"
      role="alertdialog"
      aria-modal="true"
    >
      <div ref={panelRef} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl phone:max-h-[92dvh] phone:max-w-none phone:overflow-y-auto phone:rounded-b-none phone:rounded-t-2xl phone:border-x-0 phone:border-b-0 phone:pb-safe">
        <h2 className="font-heading text-base font-semibold tracking-tight">
          {isDelete ? `Delete ${action.lead.name}?` : `Mark ${action.lead.name} do not call?`}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {isDelete
            ? "The lead is removed, with its calls, recordings and follow-ups. Customer memory is kept only if another lead has the same number."
            : "Tringlo will refuse to place any further call to this number, and pending callbacks for it are cancelled."}
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

/** "Add name" beside a contact Tringlo has no name for (e.g. an unknown caller). */
function AddNameButton({ lead, onEdit }: { lead: Lead; onEdit: (lead: Lead) => void }) {
  if (!isPlaceholderName(lead.name)) return null;
  return (
    <button
      type="button"
      onClick={() => onEdit(lead)}
      className="ml-2 rounded px-1.5 py-0.5 align-middle text-[11px] font-medium text-primary transition-colors hover:bg-accent"
    >
      Add name
    </button>
  );
}

function EditLeadDialog({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const { backdropRef, panelRef } = useModalEntrance();
  const [name, setName] = useState(isPlaceholderName(lead.name) ? "" : lead.name);
  const [email, setEmail] = useState(lead.email ?? "");
  const [company, setCompany] = useState(lead.company ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lead.id, name: name.trim(), email: email.trim(), company: company.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The change could not be saved.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The change could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const input =
    "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 phone:items-end phone:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${lead.name}`}
    >
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl phone:max-h-[92dvh] phone:max-w-none phone:overflow-y-auto phone:rounded-b-none phone:rounded-t-2xl phone:border-x-0 phone:border-b-0 phone:pb-safe"
      >
        <form onSubmit={save}>
          <h2 className="font-heading text-base font-semibold tracking-tight">Edit contact</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{formatPhone(lead.phone)}</p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} required autoFocus maxLength={60} placeholder="Full name" className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Email (optional)</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={200} className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Company (optional)</span>
              <input value={company} onChange={(event) => setCompany(event.target.value)} maxLength={200} className={input} />
            </label>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            The new name shows on this contact&apos;s calls and memory, and the AI agent uses it the next time they call.
          </p>
          {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-6 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
