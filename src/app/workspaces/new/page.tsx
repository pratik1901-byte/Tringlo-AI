"use client";

// ============================================================
// Create another workspace
// ============================================================
//
// The same three-step wizard as first-run — account context, company, voice
// provider — but for someone who is already signed in. They are not asked for
// an email or a password, because they have both; the workspace is created
// against the account the server resolves from their session.
//
// It posts to POST /api/workspaces, the ordinary authenticated endpoint, not
// to the privileged bootstrap route that creates a first account.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { CreateWorkspaceForm, type CreateWorkspacePayload } from "@/components/auth/create-workspace-form";

export default function NewWorkspacePage() {
  const router = useRouter();
  const [account, setAccount] = useState<{ name: string; email: string } | null>(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      const body = await response.json();
      setAccount(body.account ?? null);
    } catch {
      setError("Your account could not be read. Check your connection and try again.");
    } finally {
      setChecking(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const submit = async (payload: CreateWorkspacePayload) => {
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      // The account is not sent: the server takes the owner from the session,
      // so nothing in this request can nominate a different one.
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: payload.businessName,
          company: payload.company,
          outbound: payload.outbound,
          batch: payload.batch,
          inbound: payload.inbound,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body?.error?.message ?? "The workspace could not be created.");
        setProblems(Array.isArray(body?.error?.problems) ? body.error.problems : []);
        return;
      }

      // The new workspace is already open on the session. Anything the browser
      // kept about the previous one is now the wrong company's.
      try {
        const { clearBrowserHeldWorkspaceState, useAuthStore } = await import("@/lib/store");
        clearBrowserHeldWorkspaceState();
        await useAuthStore.getState().refresh();
      } catch {
        // Not worth blocking entry to the workspace that was just created.
      }
      router.replace("/dashboard");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-muted/30 px-4 py-10 phone:py-6">
      <div className="mx-auto w-full max-w-[620px] rounded-2xl border bg-card p-6 shadow-sm phone:p-4">
        <h1 className="text-xl font-semibold tracking-tight">Create a workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A separate workspace, with its own leads, calls and history.
        </p>

        {checking ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking your account…
          </p>
        ) : (
          <div className="mt-5">
            <CreateWorkspaceForm
              busy={busy}
              error={error}
              problems={problems}
              account={account}
              backLabel="Back to workspaces"
              onBackToSignIn={() => router.push("/workspaces")}
              onSubmit={submit}
            />
          </div>
        )}
      </div>
    </main>
  );
}
