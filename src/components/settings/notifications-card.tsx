"use client";

// ============================================================
// Tringlo AI — Notifications Settings
// ============================================================
//
// The email toggles, backed by the server.
//
// They used to write to the browser's localStorage only, so they looked like
// settings but controlled nothing: the server, which is what sends email,
// never knew they were on. Now they load from and save to the workspace's
// settings, and the server acts on them.
//
// SMS is left as it was — local only, and not wired to anything — because it
// is not in use.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { useSettingsStore } from "@/lib/store";

interface NotificationView {
  emailAlerts: boolean;
  dailySummary: boolean;
  recipient: string | null;
  effectiveRecipient: string | null;
  mailConfigured: boolean;
  summaryHour: number;
}

export function NotificationsCard() {
  const { settings, updateSettings } = useSettingsStore();

  const [view, setView] = useState<NotificationView | null>(null);
  const [recipientDraft, setRecipientDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body: NotificationView = await response.json();
      setView(body);
      setRecipientDraft(body.recipient ?? "");
    } catch {
      setError("Could not load notification settings.");
    }
  }, []);

  // Scheduled rather than called inline, matching lib/use-tringlo-data.
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  /** Saves a change; the switch moves at once and moves back if the save fails. */
  const save = async (updates: Partial<Pick<NotificationView, "emailAlerts" | "dailySummary">> & { recipient?: string }) => {
    if (!view) return;
    const previous = view;
    setView({ ...view, ...updates, recipient: updates.recipient ?? view.recipient } as NotificationView);
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch("/api/settings/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not save.");
      setView(body);
      setRecipientDraft(body.recipient ?? "");
      setNotice("Saved");
    } catch (err) {
      setView(previous);
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/notifications", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not send the test email.");
      setNotice(`Test email sent to ${body.to}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the test email.");
    } finally {
      setTesting(false);
    }
  };

  const hourLabel = view
    ? new Date(2000, 0, 1, view.summaryHour).toLocaleTimeString("en-IN", { hour: "numeric", hour12: true })
    : "";

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Notifications</h2>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" />}
      </div>

      {view && !view.mailConfigured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          Email is not set up on this server, so these emails cannot be sent yet.
        </p>
      )}

      <div className="space-y-4">
        <Toggle
          label="Email alerts for interested leads"
          hint="Sent the moment a call ends with the lead marked interested."
          checked={view?.emailAlerts ?? false}
          disabled={!view}
          onChange={(next) => save({ emailAlerts: next })}
        />

        {/* SMS is untouched: not in use, and not wired to anything. */}
        <Toggle
          label="SMS alerts for interested leads"
          checked={settings.smsAlerts}
          onChange={() => updateSettings({ smsAlerts: !settings.smsAlerts })}
        />

        <Toggle
          label="Daily summary report via email"
          hint={view ? `Sent each day at ${hourLabel}, covering that day's calls.` : undefined}
          checked={view?.dailySummary ?? false}
          disabled={!view}
          onChange={(next) => save({ dailySummary: next })}
        />
      </div>

      <div className="border-t pt-4">
        <label htmlFor="notify-recipient" className="text-xs font-medium text-muted-foreground">
          Send to
        </label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id="notify-recipient"
            type="email"
            value={recipientDraft}
            onChange={(event) => setRecipientDraft(event.target.value)}
            onBlur={() => {
              if (view && recipientDraft.trim() !== (view.recipient ?? "")) {
                save({ recipient: recipientDraft.trim() });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
            placeholder={view?.effectiveRecipient ?? "you@company.com"}
            disabled={!view}
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 phone:h-11"
          />
          <button
            type="button"
            onClick={sendTest}
            disabled={!view || !view.mailConfigured || testing}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 phone:h-11"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send test email
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Leave blank to use your login email
          {view?.effectiveRecipient ? ` (${view.effectiveRecipient})` : ""}.
        </p>

        {(error || notice) && (
          <p
            role={error ? "alert" : "status"}
            className={`mt-2 text-xs ${error ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}`}
          >
            {error ?? notice}
          </p>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <span className="text-sm text-foreground">{label}</span>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
