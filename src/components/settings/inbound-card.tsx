"use client";

// ============================================================
// Tringlo AI — Inbound Calling settings
// ============================================================
//
// Optional and OFF by default. Turning it on creates (or resumes) a Sarvam
// deployment that answers the workspace's inbound number — live the moment
// it exists — so Enable and Update always ask first.
//
// Every status shown is the one Sarvam last reported, read back by the
// server. Nothing here talks to Sarvam directly or sees a credential.
// ============================================================

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2, PhoneIncoming, RefreshCw } from "lucide-react";

import { formatDateTime } from "@/lib/format";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles"];

type DeploymentStatus = "inactive" | "creating" | "active" | "paused" | "failed";

interface InboundView {
  settings: {
    enabled: boolean;
    phoneNumber: string | null;
    startTime: string;
    endTime: string;
    days: string[];
    timezone: string;
    handoffNumber: string | null;
    afterHoursMessage: string | null;
    deploymentStatus: DeploymentStatus;
    hasDeployment: boolean;
    deploymentId: string | null;
    lastError: string | null;
    knownCallersCount: number;
    knownCallersSyncedAt: string | null;
    knownCallersError?: string | null;
    lastSyncedAt: string | null;
  };
  server: { ready: boolean; problems: string[]; advisories?: string[] };
  lastInboundCall: { id: string; at: string | null; status: string; caller: string | null } | null;
}

interface Draft {
  deploymentId: string;
  phoneNumber: string;
  startTime: string;
  endTime: string;
  days: string[];
  timezone: string;
  handoffNumber: string;
  afterHoursMessage: string;
}

const STATUS_LABEL: Record<DeploymentStatus, { label: string; tone: string }> = {
  inactive: { label: "Off", tone: "bg-muted text-muted-foreground" },
  creating: { label: "Setting up", tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  active: { label: "Live — answering calls", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  paused: { label: "Paused — not answering", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  failed: { label: "Failed", tone: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
};

const input =
  "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

function draftFrom(view: InboundView): Draft {
  const s = view.settings;
  return {
    deploymentId: s.deploymentId ?? "",
    phoneNumber: s.phoneNumber ?? "",
    startTime: s.startTime,
    endTime: s.endTime,
    days: s.days,
    timezone: s.timezone,
    handoffNumber: s.handoffNumber ?? "",
    afterHoursMessage: s.afterHoursMessage ?? "",
  };
}

export function InboundCard() {
  const [view, setView] = useState<InboundView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<null | "save" | "enable" | "disable" | "sync" | "load">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setBusy("load");
    try {
      const response = await fetch("/api/inbound/settings", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body: InboundView = await response.json();
      setView(body);
      setDraft(draftFrom(body));
      setError(null);
    } catch {
      setError("Could not load inbound settings.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const call = async (kind: "save" | "enable" | "disable" | "sync", url: string, method: string, body?: unknown) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (json.settings && view) {
        const next = { ...view, settings: { ...view.settings, ...json.settings } };
        setView(next);
        if (kind !== "save" || response.ok) setDraft(draftFrom(next));
      }
      if (!response.ok) throw new Error(json?.error?.message ?? "Something went wrong.");
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (!view || !draft) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Inbound Calling</h2>
        <p className="mt-2 text-xs text-muted-foreground">{error ?? "Loading…"}</p>
      </section>
    );
  }

  const s = view.settings;
  const status = STATUS_LABEL[s.deploymentStatus];
  const isOn = s.enabled;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const deploymentEdited = draft.deploymentId.trim() !== (s.deploymentId ?? "");
  const payload = {
    ...draft,
    handoffNumber: draft.handoffNumber || null,
    afterHoursMessage: draft.afterHoursMessage || null,
    ...(deploymentEdited ? { deploymentId: draft.deploymentId.trim() || null } : { deploymentId: undefined }),
  };

  return (
    <section className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
            <PhoneIncoming className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Inbound Calling</h2>
            <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
              Let your AI agent answer calls to your business number, with your company details and what it
              remembers about each known caller. Optional — off unless you turn it on.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2 py-1 text-xs font-medium ${status.tone}`}>{status.label}</span>
          <button
            onClick={load}
            disabled={busy !== null}
            aria-label="Refresh status"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy === "load" ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {!view.server.ready && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">The server is not ready for inbound yet.</p>
          <ul className="mt-1 list-disc pl-4">
            {view.server.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {view.server.ready && (view.server.advisories ?? []).map((advisory) => (
        <p key={advisory} className="rounded-md border px-4 py-2.5 text-xs text-muted-foreground">
          {advisory}
        </p>
      ))}

      {s.lastError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          Last Sarvam response: {s.lastError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Inbound number</span>
          <input
            type="tel"
            value={draft.phoneNumber}
            onChange={(event) => set({ phoneNumber: event.target.value })}
            placeholder="+91 80 1234 5678"
            className={input}
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">Must be a number on your Sarvam telephony connection.</span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Human handoff number (optional)</span>
          <input
            type="tel"
            value={draft.handoffNumber}
            onChange={(event) => set({ handoffNumber: event.target.value })}
            placeholder="Where a caller who asks for a person is sent"
            className={input}
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Transfer must also be set up in Sarvam (In Call Actions → Call forwarding).
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Answers from</span>
          <input type="time" value={draft.startTime} onChange={(event) => set({ startTime: event.target.value })} className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Until</span>
          <input type="time" value={draft.endTime} onChange={(event) => set({ endTime: event.target.value })} className={input} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Timezone</span>
          <select value={draft.timezone} onChange={(event) => set({ timezone: event.target.value })} className={input}>
            {[...new Set([draft.timezone, ...TIMEZONES])].map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1.5 block text-xs font-medium text-muted-foreground">Days</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day) => {
              const on = draft.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ days: on ? draft.days.filter((d) => d !== day) : [...draft.days, day] })}
                  className={`h-8 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                    on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  {day.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Sarvam deployment ID (advanced)
          </span>
          <input
            value={draft.deploymentId}
            onChange={(event) => set({ deploymentId: event.target.value })}
            placeholder="Managed by Tringlo — paste one to point this line elsewhere"
            className={`${input} font-mono text-xs`}
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Tringlo creates this and keeps it current by itself. Paste a deployment ID only to point this workspace at
            one you made in Sarvam; clear it to hand management back to Tringlo. It applies to this workspace alone.
          </span>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">After-hours message (optional)</span>
          <textarea
            value={draft.afterHoursMessage}
            onChange={(event) => set({ afterHoursMessage: event.target.value })}
            maxLength={300}
            rows={2}
            placeholder="What the agent tells callers outside business hours, e.g. that the team will call back next working day."
            className={`${input} h-auto py-2`}
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Outside these hours Sarvam does not answer the line. This message is given to the agent for calls that
            run past closing time.
          </span>
        </label>
      </div>

      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-md border bg-muted/20 px-3 py-2.5">
          <dt className="text-muted-foreground">Last inbound call</dt>
          <dd className="mt-1 font-medium">
            {view.lastInboundCall ? `${formatDateTime(view.lastInboundCall.at)} · ${view.lastInboundCall.caller ?? "Unknown caller"}` : "None yet"}
          </dd>
        </div>
        <div className="rounded-md border bg-muted/20 px-3 py-2.5">
          <dt className="text-muted-foreground">Known callers shared</dt>
          <dd className="mt-1 font-medium">
            {s.knownCallersError
              ? `Not shared — Sarvam: ${s.knownCallersError}`
              : s.knownCallersSyncedAt
                ? `${s.knownCallersCount} · ${formatDateTime(s.knownCallersSyncedAt)}`
                : "Not yet"}
          </dd>
        </div>
        <div className="rounded-md border bg-muted/20 px-3 py-2.5">
          <dt className="text-muted-foreground">Status checked</dt>
          <dd className="mt-1 font-medium">{s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : "—"}</dd>
        </div>
      </dl>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      {confirming ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-medium">{isOn ? "Apply these settings to the live line?" : "Turn inbound calling on?"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {isOn
              ? "The line pauses for a second or two while Sarvam applies the change, then answers again."
              : `Calls to ${draft.phoneNumber || "this number"} will be answered by your AI agent as soon as Sarvam confirms — during the hours above.`}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={async () => {
                setConfirming(false);
                const result = await call("enable", "/api/inbound/enable", "POST", { ...payload, confirm: true });
                if (result) setNotice(isOn ? "Settings applied." : "Inbound calling is on.");
              }}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {isOn ? "Apply" : "Turn on"}
            </button>
            <button onClick={() => setConfirming(false)} className="h-9 rounded-md border px-3.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setConfirming(true)}
            disabled={busy !== null || !view.server.ready}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "enable" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isOn ? "Update live line" : "Enable inbound"}
          </button>
          {isOn && (
            <button
              onClick={async () => {
                const result = await call("disable", "/api/inbound/disable", "POST");
                if (result) setNotice("Inbound calling is off. The line no longer answers.");
              }}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "disable" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Disable
            </button>
          )}
          {!isOn && (
            <button
              onClick={async () => {
                const result = await call("save", "/api/inbound/settings", "PUT", payload);
                if (result) setNotice("Saved. Inbound stays off until you enable it.");
              }}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save without enabling
            </button>
          )}
          {isOn && s.deploymentStatus === "active" && (
            <button
              onClick={async () => {
                const result = await call("sync", "/api/inbound/sync-callers", "POST");
                if (result) {
                  setNotice(`${result.count} known callers shared with the line.`);
                  load();
                }
              }}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "sync" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Share known callers now
            </button>
          )}
          <Link
            href="/inbound"
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary hover:text-primary/80"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Inbound analytics
          </Link>
        </div>
      )}
    </section>
  );
}
