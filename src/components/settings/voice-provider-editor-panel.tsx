"use client";

// ============================================================
// Settings — Edit voice provider configuration
// ============================================================
//
// The same three sections, the same paste-the-example areas and the same
// parser as workspace creation, over an existing workspace's saved values.
// An agent, version, connection, number or deployment can be replaced here;
// the workspace never has to be recreated for it.
//
// What this does NOT do: it never starts, replaces or stops a Sarvam
// deployment. Saving stores settings. Making a line follow them is a separate,
// deliberate press on the inbound card.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";

import {
  draftFromSaved,
  draftProblems,
  draftToPayload,
  emptyDraft,
  VoiceProviderSections,
  type VoiceProviderDraft,
} from "@/components/providers/voice-provider-editor";

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export function VoiceProviderEditorPanel({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const [draft, setDraft] = useState<VoiceProviderDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState<"load" | "validate" | "save" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The editor opens on what is saved. Nothing is written by opening it.
  const load = useCallback(async () => {
    setBusy("load");
    setLoadError(null);
    try {
      const [providerRes, inboundRes] = await Promise.all([
        fetch("/api/integrations/provider", { cache: "no-store" }),
        fetch("/api/inbound/settings", { cache: "no-store" }),
      ]);
      if (!providerRes.ok) throw new Error("This workspace's configuration could not be read.");
      const provider = await providerRes.json();
      const inbound = inboundRes.ok ? await inboundRes.json().catch(() => null) : null;
      setDraft(
        draftFromSaved({
          outbound: provider.outbound ?? null,
          batch: provider.batch ?? null,
          inbound: provider.inbound ?? null,
          inboundSettings: inbound?.settings ?? null,
        })
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "This workspace's configuration could not be read.");
      setDraft(emptyDraft());
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    // Deferred by a tick so the first paint is not a cascade of renders.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const edit = (next: VoiceProviderDraft) => {
    setDraft(next);
    // Anything shown about the old values stops applying the moment a field
    // changes, so a stale "all good" cannot be mistaken for the current state.
    setProblems(null);
    setChecks(null);
    setNotice(null);
  };

  const validate = () => {
    if (!draft) return;
    setBusy("validate");
    setError(null);
    setChecks(null);
    const found = draftProblems(draft);
    setProblems(found);
    setBusy(null);
    setNotice(found.length === 0 ? "Everything required is filled in. This checks the form, not Sarvam — use Test connection for that." : null);
  };

  const save = async () => {
    if (!draft) return;
    const found = draftProblems(draft);
    setProblems(found);
    if (found.length) {
      setError("Fix the listed problems first.");
      return;
    }

    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const payload = draftToPayload(draft);

      const providerRes = await fetch("/api/integrations/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outbound: payload.outbound,
          batch: payload.batch,
          // Cleared rather than kept when inbound is off, so a half-configured
          // agent cannot answer a call later by surprise.
          inbound: payload.inbound
            ? {
                appId: payload.inbound.appId,
                appVersion: payload.inbound.appVersion,
                connectionId: payload.inbound.connectionId,
              }
            : null,
        }),
      });
      const providerBody = await providerRes.json().catch(() => ({}));
      if (!providerRes.ok) {
        throw new Error(providerBody?.error?.message ?? "The configuration was not saved.");
      }

      // The inbound line's own settings — number, deployment, hours, handoff —
      // are saved by the inbound endpoint, which refuses a number or a
      // deployment already claimed by another workspace.
      if (payload.inbound) {
        const inboundRes = await fetch("/api/inbound/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneNumber: payload.inbound.phoneNumber,
            deploymentId: payload.inbound.deploymentId,
            handoffNumber: payload.inbound.handoffNumber,
            startTime: payload.inbound.startTime,
            endTime: payload.inbound.endTime,
            days: payload.inbound.days,
            timezone: payload.inbound.timezone,
          }),
        });
        const inboundBody = await inboundRes.json().catch(() => ({}));
        if (!inboundRes.ok) {
          throw new Error(
            inboundBody?.error?.message ??
              "The agent settings were saved, but the inbound line's settings were not."
          );
        }
      }

      setNotice(
        "Saved for this workspace. New outbound calls and new campaigns use it straight away; calls and campaigns already running keep the settings they started with. Run Test connection to check it against Sarvam."
      );
      onSaved?.();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The configuration was not saved.");
    } finally {
      setBusy(null);
    }
  };

  const runTest = async () => {
    setBusy("validate");
    setError(null);
    setProblems(null);
    try {
      const response = await fetch("/api/integrations/provider/test", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "The test could not run.");
      setChecks(body.checks ?? null);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The test could not run.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Edit voice provider configuration</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The same form as workspace creation, over what this workspace has saved. Paste a Sarvam example to fill
            fields in, check them, then save.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </div>

      {busy === "load" && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading this workspace&rsquo;s configuration…
        </p>
      )}

      {loadError && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{loadError}</p>}

      {draft && busy !== "load" && (
        <>
          <VoiceProviderSections draft={draft} onChange={edit} saved />

          {problems && problems.length > 0 && (
            <ul className="mt-4 list-disc space-y-0.5 rounded-lg border border-red-200 bg-red-50 pl-7 pr-3 py-2.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}

          {checks && (
            <ul className="mt-4 space-y-1.5 rounded-lg border p-3">
              {checks.map((check) => (
                <li key={check.label} className="flex items-start gap-2 text-[11px]">
                  {check.ok ? (
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
                  )}
                  <span>
                    <span className="font-medium">{check.label}</span>{" "}
                    <span className="text-muted-foreground">{check.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
          {notice && <p className="mt-3 text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
            <button
              type="button"
              onClick={save}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </button>
            <button
              type="button"
              onClick={validate}
              disabled={busy !== null}
              className="inline-flex h-9 items-center rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              Validate configuration
            </button>
            <button
              type="button"
              onClick={runTest}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "validate" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Test connection
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy === "save"}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Cancel discards anything unsaved. Saving never creates, replaces or activates a Sarvam deployment, and
            never changes an agent&rsquo;s prompt or publishes a version.
          </p>
        </>
      )}
    </section>
  );
}
