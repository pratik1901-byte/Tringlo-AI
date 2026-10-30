"use client";

// ============================================================
// Tringlo AI — Voice provider settings
// ============================================================
//
// Which Sarvam agent speaks for this workspace, on which connection, from
// which number. Editing these is configuration, not a deployment: a customer
// who publishes a new agent version changes it here.
//
// Tringlo's own Sarvam credentials are not on this page. They belong to the
// platform, stay on the server, and are reported only as present or missing.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil, PhoneOutgoing, XCircle } from "lucide-react";

import { StatusChip } from "@/components/auth/snippet-import";
import { VoiceProviderEditorPanel } from "@/components/settings/voice-provider-editor-panel";
import type { ConfigStatus } from "@/lib/providers/types";

interface Outbound {
  appId: string;
  appVersion: number;
  connectionId: string;
  phoneNumber: string;
  agentName: string | null;
  agentVariables: string[];
}

interface Inbound {
  appId: string;
  appVersion: number;
  connectionId: string;
  agentVariables: string[];
}

interface View {
  outbound: Outbound | null;
  inbound: Inbound | null;
  configured: boolean;
  status: {
    singleOutbound: ConfigStatus;
    batchOutbound: ConfigStatus;
    leadSubmission: ConfigStatus;
    inbound: ConfigStatus;
  };
  platform: { ready: boolean; problems: string[] };
  /** Whether the workspace's business information can reach the outbound agent. */
  businessContext: {
    reaches: boolean;
    via: "declared" | "mapping" | "none";
    declaredCount: number;
    hasMappings: boolean;
  } | null;
  updatedAt: string | null;
}

const input =
  "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const blank = { appId: "", appVersion: "", connectionId: "", phoneNumber: "", agentName: "", agentVariables: "" };

export function VoiceProviderCard() {
  // The full editor — the same one as workspace creation — replaces this
  // card while it is open, so there is never a second, lesser form beside it.
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [out, setOut] = useState({ ...blank });
  const [inb, setInb] = useState({ ...blank });
  const [inboundOn, setInboundOn] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "test">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checks, setChecks] = useState<Array<{ label: string; ok: boolean; detail: string }> | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/provider", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body: View = await response.json();
      setView(body);
      setOut({
        appId: body.outbound?.appId ?? "",
        appVersion: body.outbound?.appVersion ? String(body.outbound.appVersion) : "",
        connectionId: body.outbound?.connectionId ?? "",
        phoneNumber: body.outbound?.phoneNumber ?? "",
        agentName: body.outbound?.agentName ?? "",
        agentVariables: (body.outbound?.agentVariables ?? []).join(", "),
      });
      setInb({
        appId: body.inbound?.appId ?? "",
        appVersion: body.inbound?.appVersion ? String(body.inbound.appVersion) : "",
        connectionId: body.inbound?.connectionId ?? "",
        phoneNumber: "",
        agentName: "",
        agentVariables: (body.inbound?.agentVariables ?? []).join(", "),
      });
      setInboundOn(Boolean(body.inbound?.appId));
    } catch {
      setError("Could not load the voice provider settings.");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const save = async () => {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/integrations/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outbound: {
            appId: out.appId,
            appVersion: Number(out.appVersion),
            connectionId: out.connectionId,
            phoneNumber: out.phoneNumber,
            agentName: out.agentName,
            agentVariables: out.agentVariables,
          },
          // Cleared rather than kept when inbound is switched off, so a
          // half-configured agent cannot answer calls later by surprise.
          inbound: inboundOn
            ? {
                appId: inb.appId,
                appVersion: Number(inb.appVersion),
                connectionId: inb.connectionId || out.connectionId,
                agentVariables: inb.agentVariables,
              }
            : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "The settings were not saved.");
      setView(body);
      setNotice("Saved. New calls use this configuration straight away.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The settings were not saved.");
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    setError(null);
    setNotice(null);
    setChecks(null);
    try {
      const response = await fetch("/api/integrations/provider/test", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "The test could not run.");
      setChecks(body.checks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The test could not run.");
    } finally {
      setBusy(null);
    }
  };

  if (editing) {
    return (
      <VoiceProviderEditorPanel
        onClose={() => setEditing(false)}
        // A save there changes what this card shows, so it reloads.
        onSaved={() => void load()}
      />
    );
  }

  if (!view) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-semibold">Voice Provider</h2>
        <p className="mt-2 text-xs text-muted-foreground">{error ?? "Loading…"}</p>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <PhoneOutgoing className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Voice Provider</h2>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
            Sarvam AI. The agent that speaks for this workspace, and the line it speaks on. Changing these takes
            effect on the next call — no deployment needed.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setEditing(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit Voice Provider Configuration
        </button>
        <span className="text-[11px] text-muted-foreground">
          Paste Sarvam API examples to fill the fields in, across single calls, campaigns and inbound.
        </span>
      </div>

      {!view.platform.ready && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">Tringlo&apos;s own Sarvam account is not set up on this server.</p>
          <ul className="mt-1 list-disc pl-4">
            {view.platform.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Outbound calling</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Agent ID</span>
            <input value={out.appId} onChange={(event) => setOut({ ...out, appId: event.target.value })} placeholder="Conversatio-…" className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Agent version</span>
            <input value={out.appVersion} onChange={(event) => setOut({ ...out, appVersion: event.target.value })} inputMode="numeric" placeholder="4" className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Telephony connection ID</span>
            <input value={out.connectionId} onChange={(event) => setOut({ ...out, connectionId: event.target.value })} className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Caller number</span>
            <input value={out.phoneNumber} onChange={(event) => setOut({ ...out, phoneNumber: event.target.value })} placeholder="+91…" className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Agent name (optional)</span>
            <input value={out.agentName} onChange={(event) => setOut({ ...out, agentName: event.target.value })} placeholder="Priya" className={input} />
            <span className="mt-1 block text-[11px] text-muted-foreground">Used to label transcripts and the opening line.</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Declared variables (optional)</span>
            <input value={out.agentVariables} onChange={(event) => setOut({ ...out, agentVariables: event.target.value })} placeholder="customer_name, company_name, …" className={input} />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Comma separated, exactly as declared in Sarvam. Leave empty to use Tringlo&apos;s default list.
            </span>
          </label>
        </div>

        {/*
          The warning that would have explained a wrong-business call. When the
          saved agent declares no variables and has no mapping, this workspace's
          company and product never travel to Sarvam, so the agent runs on its
          own provider-side prompt — whatever business that prompt was written
          for. Shown against the SAVED config, not the unsaved edits.
        */}
        {view.businessContext && !view.businessContext.reaches && view.configured && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">This agent is not receiving your business information.</p>
            <p className="mt-1">
              The saved agent declares no variables and has no mapping, so this workspace&apos;s company and product are
              not sent on a call. The agent will speak only from the prompt it was given in Sarvam — which may describe a
              different business. Declare the variables your Sarvam agent expects above, or map them, so your business
              context reaches it.
            </p>
          </div>
        )}
      </div>

      <div className="border-t pt-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inbound calling</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. The line itself — number, hours, handoff — is set up in the Inbound Calling card below.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={inboundOn}
            onClick={() => setInboundOn(!inboundOn)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${inboundOn ? "bg-primary" : "bg-muted-foreground/30"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${inboundOn ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {inboundOn && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Inbound agent ID</span>
              <input value={inb.appId} onChange={(event) => setInb({ ...inb, appId: event.target.value })} className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Inbound agent version</span>
              <input value={inb.appVersion} onChange={(event) => setInb({ ...inb, appVersion: event.target.value })} inputMode="numeric" className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Connection ID</span>
              <input value={inb.connectionId} onChange={(event) => setInb({ ...inb, connectionId: event.target.value })} placeholder="Same as outbound" className={input} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Declared variables (optional)</span>
              <input value={inb.agentVariables} onChange={(event) => setInb({ ...inb, agentVariables: event.target.value })} className={input} />
            </label>
          </div>
        )}
      </div>

      {checks && (
        <ul className="space-y-1.5 rounded-md border bg-muted/20 px-4 py-3">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-2 text-xs">
              {check.ok ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <span>
                <span className="font-medium">{check.label}:</span> {check.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {notice && <p className="text-xs text-emerald-600 dark:text-emerald-400">{notice}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={busy !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === "save" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save changes
        </button>
        <button
          onClick={test}
          disabled={busy !== null}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {busy === "test" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Test connection
        </button>
        {!view.configured && (
          <span className="text-xs text-muted-foreground">This workspace cannot place calls until an outbound agent is saved.</span>
        )}
      </div>

      {/* What each part actually amounts to. "Saved" is not "working": only a
          test connection that reached Sarvam reports Provider verified. */}
      {view.status && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
          {([
            ["Single calls", view.status.singleOutbound],
            ["Campaigns", view.status.batchOutbound],
            ["Sending leads", view.status.leadSubmission],
            ["Inbound", view.status.inbound],
          ] as const).map(([label, state]) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {label}
              <StatusChip state={state} />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
