"use client";

// ============================================================
// Choose your workspace
// ============================================================
//
// Between signing in and seeing a business. One account may hold several
// workspaces; this is where it says which one it is here for.
//
// Only workspaces this account may open are listed — the page never learns
// that any other exists. Signing in is what proved who you are, so opening
// one asks for nothing; the server still checks the membership before it
// changes which workspace the session is looking at.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Loader2, LogOut, Plus, Search } from "lucide-react";
import { PageTitle } from "@/components/ui/data-display";

interface WorkspaceCard {
  tenantId: string;
  name: string;
  companyName: string;
  industry: string | null;
  role: "owner" | "admin" | "member";
  lastAccessedAt: string | null;
  createdAt: string;
  isHospital?: boolean;
}

/** Initials from a company name — two letters, no decoration. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function whenLast(value: string | null): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Opened today";
  if (days === 1) return "Opened yesterday";
  if (days < 30) return `Opened ${days} days ago`;
  return `Opened ${new Date(value).toLocaleDateString()}`;
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceCard[] | null>(null);
  const [account, setAccount] = useState<{ email: string; name: string } | null>(null);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      setWorkspaces(body.workspaces ?? []);
      setAccount(body.account ?? null);
    } catch {
      setLoadError("Your workspaces could not be loaded. Check your connection and try again.");
      setWorkspaces([]);
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !workspaces) return workspaces ?? [];
    return workspaces.filter(
      (workspace) =>
        workspace.companyName.toLowerCase().includes(needle) ||
        workspace.name.toLowerCase().includes(needle) ||
        (workspace.industry ?? "").toLowerCase().includes(needle)
    );
  }, [workspaces, query]);

  const open = async (workspace: WorkspaceCard) => {
    if (busy) return;
    setBusy(true);
    setOpening(workspace.tenantId);
    setError(null);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.tenantId)}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error?.message ?? "That workspace could not be opened.");
        return;
      }
      // The workspace changed server-side; anything the browser kept about the
      // previous one belongs to a different company.
      try {
        const { clearBrowserHeldWorkspaceState, useAuthStore } = await import("@/lib/store");
        clearBrowserHeldWorkspaceState();
        // Re-ask the server what is open before leaving, or the app still
        // believes none is and sends the person straight back here.
        await useAuthStore.getState().refresh();
      } catch {
        // Nothing held, or storage unavailable. Not worth blocking entry.
      }
      // A hospital workspace opens its own panel directly — no detour through
      // the general dashboard. The server is the authority on which it is.
      router.replace(body?.workspace?.isHospital ? "/hospital" : "/dashboard");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
      setOpening(null);
    }
  };

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  };

  return (
    <main className="min-h-dvh bg-muted/30 px-4 py-10 phone:py-6">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <PageTitle title="Choose your workspace" eyebrow="Tringlo AI" inShell={false} />
            <p className="mt-2 text-sm text-muted-foreground">
              Select the company workspace you want to access.
            </p>
          </div>
          {account && (
            <div className="text-right">
              <p className="text-xs font-medium">{account.name || account.email}</p>
              <p className="text-[11px] text-muted-foreground">{account.email}</p>
              <button
                onClick={signOut}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          )}
        </header>

        {workspaces === null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your workspaces…
          </p>
        )}

        {loadError && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{loadError}</p>}
        {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {workspaces !== null && workspaces.length > 4 && (
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspaces"
              aria-label="Search workspaces"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        )}

        {workspaces !== null && workspaces.length === 0 && !loadError && (
          <div className="rounded-xl border bg-card p-8 text-center">
            <Building2 className="mx-auto h-6 w-6 text-muted-foreground" />
            <h2 className="mt-3 text-sm font-semibold">No workspaces yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              A workspace holds one company&rsquo;s leads, calls and settings. Create your first one to begin.
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {shown.map((workspace) => (
            <li key={workspace.tenantId}>
              <button
                onClick={() => void open(workspace)}
                disabled={busy}
                className={`group flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                  workspace.isHospital
                    ? "border-emerald-600/25 bg-emerald-50/60 hover:border-emerald-600/40 hover:bg-emerald-50 dark:bg-emerald-950/20"
                    : "bg-card hover:border-primary/40 hover:bg-muted/40"
                }`}
              >
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${
                    workspace.isHospital ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300" : "bg-primary/10 text-primary"
                  }`}
                >
                  {initials(workspace.companyName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{workspace.companyName}</span>
                    {workspace.isHospital && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-600/30 dark:text-emerald-300">
                        Hospital panel
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    {workspace.industry && <span>{workspace.industry}</span>}
                    {workspace.industry && <span aria-hidden>·</span>}
                    <span className="capitalize">{workspace.role}</span>
                    {whenLast(workspace.lastAccessedAt) && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{whenLast(workspace.lastAccessedAt)}</span>
                      </>
                    )}
                  </span>
                </span>
                {opening === workspace.tenantId ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                )}
              </button>
            </li>
          ))}
        </ul>

        {workspaces !== null && shown.length === 0 && workspaces.length > 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No workspace matches &ldquo;{query}&rdquo;.
          </p>
        )}

        <button
          onClick={() => router.push("/workspaces/new")}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          Create new workspace
        </button>
      </div>

    </main>
  );
}
