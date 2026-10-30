"use client";

// ============================================================
// AI Agent
// ============================================================
//
// The hospital's voice agents, read AND edited here.
//
// There are three, and the hospital configures each from this page: the
// outbound agent (confirmation calls and callbacks), the campaign agent
// (batch outbound), and the inbound agent (the one that answers). Each is a
// Sarvam application identified by its own app id, with its own version,
// connection and declared variables.
//
// This page does not hold a second copy of that configuration. It reads and
// writes the platform's own voice-provider settings through
// /api/integrations/provider — the same endpoint the general panel uses — so
// there is one source of truth and the Sarvam key never leaves the server.
// Advanced fields it does not surface (a campaign's retry and schedule, a
// variable mapping) are carried back untouched on every save, so editing the
// agent id here never quietly resets them.
//
// The agent's display name is the workspace's own setting. Renaming it here
// does not touch the Sarvam app id, which was fixed when the app was created;
// changing a provider identifier to match a label would break every call.
// ============================================================

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ClipboardPaste, PhoneOutgoing, Save } from "lucide-react";

import { api, useApi, useWorkspace } from "@/lib/hospital/panel-api";
import { parseSarvamSnippet, type SnippetKind, type SnippetResult } from "@/lib/providers/sarvam/snippet-import";
import {
  Button,
  Card,
  CardHead,
  Field,
  Loading,
  NotConfigured,
  PageHeader,
  Problem,
  Status,
  inputClass,
} from "@/components/hospital/ui";

// The full shapes the provider endpoint returns; the advanced members are
// kept so they can be round-tripped on save rather than lost.
interface Outbound {
  appId: string;
  appVersion: number;
  connectionId: string;
  phoneNumber: string;
  agentName: string | null;
  agentVariables: string[];
  variableMappings?: unknown[];
}
interface Batch {
  appId: string;
  appVersion: number;
  appType?: string;
  connectionId: string;
  phoneNumbers: string[];
  attemptsPerSecond: number;
  cohortMode: "stream" | "upload";
  agentVariables: string[];
  variableMappings?: unknown[];
  retry?: unknown;
  schedule?: unknown;
}
interface Inbound {
  appId: string;
  appVersion: number;
  connectionId: string;
  agentVariables: string[];
  variableMappings?: unknown[];
}
interface ProviderView {
  outbound: Outbound | null;
  batch: Batch | null;
  inbound: Inbound | null;
  configured: boolean;
  status: Record<string, string>;
  businessContext: { reaches: boolean; via: string; declaredCount: number } | null;
}

interface DeploymentView {
  settings: {
    enabled: boolean;
    deploymentId: string | null;
    phoneNumber: string | null;
    handoffNumber: string | null;
    startTime: string;
    endTime: string;
    timezone: string;
  } | null;
}

const toList = (text: string): string[] => text.split(",").map((s) => s.trim()).filter(Boolean);
const fromList = (list: string[] | undefined): string => (list ?? []).join(", ");

export default function AgentPage() {
  const provider = useApi<ProviderView>("integrations/provider");
  const deployment = useApi<DeploymentView>("inbound/settings");
  const { data: context } = useWorkspace();

  if (provider.loading) return <Loading label="Reading the agent configuration" />;

  const data = provider.data;
  const agentName = data?.outbound?.agentName?.trim() || context?.agent.name || "Maya";
  const line = deployment.data?.settings;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calling"
        title={agentName}
        description="The voice agents that place and answer this hospital's calls. Configure the outbound, campaign and inbound agents here — these are the platform's own settings, and the Sarvam key stays on the server."
      />

      {provider.error && <Problem message={provider.error} onRetry={provider.reload} />}

      {!provider.error && !data?.configured && (
        <NotConfigured
          what="No outbound voice agent is connected yet"
          how="Fill in the outbound agent below — its Sarvam app ID, version, connection and calling number. Until then the hospital cannot place confirmation calls."
        />
      )}

      {/* The warning that explains a wrong-business call: if the outbound agent
          declares nothing through which the hospital's own context can travel,
          it speaks only from its Sarvam-side prompt. */}
      {data?.businessContext && !data.businessContext.reaches && data.outbound && (
        <div className="rounded-xl border border-clay/30 bg-clay-soft px-5 py-4 text-sm">
          <p className="font-medium text-ink">This agent is not receiving the hospital&apos;s information.</p>
          <p className="mt-1 leading-relaxed text-ink-soft">
            The outbound agent declares no variables and has no mapping, so this hospital&apos;s name, doctors and
            context are not sent on a call — the agent speaks only from its own Sarvam-side prompt. Add the variables
            your Sarvam agent expects under &ldquo;Declared variables&rdquo; below.
          </p>
        </div>
      )}

      <OutboundEditor config={data?.outbound ?? null} shownAs={agentName} onSaved={provider.reload} />
      <BatchEditor config={data?.batch ?? null} from={data?.outbound ?? null} onSaved={provider.reload} />
      <InboundEditor config={data?.inbound ?? null} from={data?.outbound ?? null} onSaved={provider.reload} />

      {/* The inbound line's deployment — what patients ring — is managed on the
          platform's Inbound page; shown here read-only for context. */}
      <Card>
        <CardHead
          title="Inbound line"
          note="What patients ring. Managed on the platform's Inbound page."
          actions={<Status label={line?.enabled ? "Live" : "Off"} tone={line?.enabled ? "good" : "neutral"} />}
        />
        <dl className="divide-y">
          <Row label="Deployment ID" value={line?.deploymentId ?? null} mono />
          <Row label="Number patients call" value={line?.phoneNumber ?? null} mono />
          <Row label="Transfers to" value={line?.handoffNumber ?? null} mono />
          <Row label="Answers" value={line ? `${line.startTime}–${line.endTime} (${line.timezone})` : null} />
        </dl>
      </Card>

      <DemoCall />

      <Card>
        <CardHead title="Hospital context" note="Read fresh at the start of every call" />
        <div className="space-y-2 p-5 text-[13px] leading-relaxed text-ink-soft">
          <p>
            {agentName} is given the hospital&apos;s current doctors, their consulting days and hours, the
            hospital&apos;s own opening hours, and its FAQs — as they stand at the moment the call begins. That is why
            changing a schedule reaches the next caller without anyone editing a prompt on Sarvam.
          </p>
          <p className="text-ink-muted">
            Booking, moving and cancelling during a call need a Sarvam tool call back into Tringlo. That capability is
            not configured here, so today {agentName} answers with current information, and bookings taken on a call are
            entered by staff afterwards.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className={`text-right text-[13px] ${mono ? "font-mono text-xs" : ""} ${value ? "text-ink" : "text-ink-muted"}`}>
        {value || "not set"}
      </dd>
    </div>
  );
}

// ------------------------------------------------------------
// Saving one section
// ------------------------------------------------------------

/**
 * Posts one section to the shared provider endpoint.
 *
 * Only the section sent is touched; the others are left exactly as they are.
 * The caller spreads the full existing object into `payload` first, so fields
 * this page does not show survive the save.
 */
function useSectionSave(section: "outbound" | "batch" | "inbound", onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await api("integrations/provider", { method: "PUT", body: JSON.stringify({ [section]: payload }) });
      setNotice("Saved.");
      onSaved();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  return { save, busy, problem, notice };
}

function SectionMessages({ problem, notice }: { problem: string | null; notice: string | null }) {
  if (!problem && !notice) return null;
  return problem ? (
    <Problem message={problem} />
  ) : (
    <p className="rounded-lg border border-sage/30 bg-sage-soft px-3.5 py-2.5 text-[13px] text-sage-ink">{notice}</p>
  );
}

// ------------------------------------------------------------
// Read example — populate fields from a Sarvam API example
// ------------------------------------------------------------
//
// The same parser the general TenWeb editor uses, `parseSarvamSnippet`. It is
// pure and runs here in the browser: the example is read, never run, nothing
// is sent anywhere, and no credential is extracted — only the agent id,
// version, connection, numbers and (for a deployment) the deployment id. The
// paste itself is never saved or logged.
//
// Two steps on purpose: read shows a PREVIEW of what was detected, and only a
// second click applies it to the fields, which stay editable before you save.
// Fields the example does not mention are left exactly as they are.

/** What each detected field is called, in the words the hospital panel uses. */
const EXAMPLE_LABELS: Record<string, string> = {
  appId: "Agent ID",
  appVersion: "Version",
  connectionId: "Connection ID",
  phoneNumber: "Calls from",
  phoneNumbers: "Numbers",
  attemptsPerSecond: "Calls per second",
  deploymentId: "Deployment ID",
};

/** The detected fields worth previewing, as label/value pairs. */
function previewFields(fields: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (const [key, label] of Object.entries(EXAMPLE_LABELS)) {
    const value = fields[key];
    if (value === undefined || value === null || value === "") continue;
    rows.push({ label, value: Array.isArray(value) ? value.join(", ") : String(value) });
  }
  return rows;
}

function ReadExample({
  kind,
  hint,
  onApply,
}: {
  kind: SnippetKind;
  hint: string;
  /** Fills the editor's form from the detected fields; returns what it set. */
  onApply: (fields: Record<string, unknown>) => string[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<SnippetResult | null>(null);
  const [applied, setApplied] = useState<string[] | null>(null);

  const read = () => {
    setApplied(null);
    setResult(parseSarvamSnippet(kind, text));
  };
  const apply = () => {
    if (result?.ok) setApplied(onApply(result.fields));
  };

  const detected = result?.ok ? previewFields(result.fields) : [];

  return (
    <div className="rounded-lg border bg-sunken/50">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
          <ClipboardPaste className="h-3.5 w-3.5 text-ink-muted" />
          Read example
        </span>
        <span className="flex items-center gap-2">
          {applied && <Check className="h-3.5 w-3.5 text-sage" />}
          <ChevronDown className={`h-3.5 w-3.5 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-2.5 border-t px-3.5 py-3">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">{hint}</p>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
              setApplied(null);
            }}
            rows={5}
            spellCheck={false}
            placeholder="curl --location 'https://apps.sarvam.ai/api/…' --data '{ … }'"
            className="w-full rounded-lg border bg-raised px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus-visible:border-sage"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="plain" disabled={!text.trim()} onClick={read}>
              Read example
            </Button>
            {result?.ok && detected.length > 0 && (
              <Button variant="primary" disabled={Boolean(applied)} onClick={apply}>
                {applied ? `Applied ${applied.length}` : "Apply to the fields"}
              </Button>
            )}
          </div>

          {/* Preview — what was detected, before anything is applied. */}
          {result?.ok && detected.length > 0 && (
            <div className="space-y-1 rounded-lg border bg-raised px-3 py-2.5">
              <p className="text-[11px] font-semibold text-ink">Detected — review, then apply:</p>
              {detected.map((row) => (
                <p key={row.label} className="text-[11.5px]">
                  <span className="text-ink-muted">{row.label}:</span>{" "}
                  <span className="font-mono text-ink">{row.value}</span>
                </p>
              ))}
              {applied && (
                <p className="pt-0.5 text-[11px] text-sage-ink">
                  Filled {applied.length} field{applied.length === 1 ? "" : "s"} below — edit any of them, then Save.
                </p>
              )}
            </div>
          )}

          {result && !result.ok && (
            <p className="text-[11.5px] text-ink-muted">Nothing was applied. The fields are unchanged.</p>
          )}
          {result?.problems.map((problem) => (
            <p key={problem} className="flex items-start gap-1.5 text-[11.5px] text-alert">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {problem}
            </p>
          ))}
          {result?.warnings.map((warning) => (
            <p key={warning} className="text-[11px] text-ink-muted">
              {warning}
            </p>
          ))}

          <p className="text-[11px] text-ink-muted">
            The example is read, never run. Nothing is sent anywhere, no credential is read from it, and the paste is
            not saved.
          </p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Outbound — confirmation calls and callbacks
// ------------------------------------------------------------

function OutboundEditor({ config, shownAs, onSaved }: { config: Outbound | null; shownAs: string; onSaved: () => void }) {
  const { save, busy, problem, notice } = useSectionSave("outbound", onSaved);
  const [form, setForm] = useState(() => ({
    appId: config?.appId ?? "",
    appVersion: config ? String(config.appVersion) : "",
    connectionId: config?.connectionId ?? "",
    phoneNumber: config?.phoneNumber ?? "",
    agentName: config?.agentName ?? "",
    agentVariables: fromList(config?.agentVariables),
  }));

  const applyExample = (fields: Record<string, unknown>): string[] => {
    const filled: string[] = [];
    setForm((prev) => {
      const next = { ...prev };
      if (fields.appId) { next.appId = String(fields.appId); filled.push("Agent ID"); }
      if (fields.appVersion) { next.appVersion = String(fields.appVersion); filled.push("Version"); }
      if (fields.connectionId) { next.connectionId = String(fields.connectionId); filled.push("Connection ID"); }
      if (fields.phoneNumber) { next.phoneNumber = String(fields.phoneNumber); filled.push("Calls from"); }
      return next;
    });
    return filled;
  };

  return (
    <Card>
      <CardHead
        title="Outbound agent"
        note="Places confirmation calls and callbacks"
        actions={<Status label={config ? "Saved" : "Not set"} tone={config ? "good" : "neutral"} />}
      />
      <div className="space-y-4 p-5">
        <SectionMessages problem={problem} notice={notice} />
        <ReadExample
          kind="instant_outbound"
          hint="Paste Sarvam's Instant Outbound API example. The agent, version, connection and calling number are read from it; your variables and webhook are Tringlo's own and are never taken from here."
          onApply={applyExample}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sarvam agent ID" hint="The app id, exactly as created in Sarvam.">
            <input className={`${inputClass} font-mono`} value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} />
          </Field>
          <Field label="Version">
            <input className={inputClass} type="number" min={1} value={form.appVersion} onChange={(e) => setForm({ ...form, appVersion: e.target.value })} />
          </Field>
          <Field label="Connection ID">
            <input className={`${inputClass} font-mono`} value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })} />
          </Field>
          <Field label="Calls from" hint="The number the patient sees.">
            <input className={inputClass} value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+91…" />
          </Field>
          <Field label="Agent name" hint="What the agent calls itself. Shown in this panel as a label.">
            <input className={inputClass} value={form.agentName} onChange={(e) => setForm({ ...form, agentName: e.target.value })} placeholder={shownAs} />
          </Field>
          <Field label="Declared variables" hint="Comma separated, exactly as declared in Sarvam. Empty means none.">
            <input className={inputClass} value={form.agentVariables} onChange={(e) => setForm({ ...form, agentVariables: e.target.value })} placeholder="company_name, product_name, …" />
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            save({
              // Round-trip the mapping so saving the id does not drop it.
              ...(config ?? {}),
              appId: form.appId.trim(),
              appVersion: Number(form.appVersion) || 0,
              connectionId: form.connectionId.trim(),
              phoneNumber: form.phoneNumber.trim(),
              agentName: form.agentName.trim() || null,
              agentVariables: toList(form.agentVariables),
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save outbound agent
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Batch — campaigns
// ------------------------------------------------------------

function BatchEditor({ config, from, onSaved }: { config: Batch | null; from: Outbound | null; onSaved: () => void }) {
  const { save, busy, problem, notice } = useSectionSave("batch", onSaved);
  const [form, setForm] = useState(() => seedBatch(config));

  // Most hospitals run one Sarvam app for every kind of call, so the ids are
  // the same as the outbound agent's. This copies them in rather than making
  // somebody retype "Amrita---We-…" a third time.
  const autofill = () => {
    if (!from) return;
    setForm({
      ...form,
      appId: from.appId,
      appVersion: String(from.appVersion),
      connectionId: from.connectionId,
      phoneNumbers: form.phoneNumbers || from.phoneNumber,
      agentVariables: fromList(from.agentVariables),
    });
  };

  return (
    <Card>
      <CardHead
        title="Campaign agent"
        note="Batch outbound — the agent a campaign dials with"
        actions={
          <span className="flex items-center gap-2">
            {from && (
              <Button variant="quiet" onClick={autofill}>
                Copy from outbound agent
              </Button>
            )}
            <Status label={config ? "Saved" : "Not set"} tone={config ? "good" : "neutral"} />
          </span>
        }
      />
      <div className="space-y-4 p-5">
        <SectionMessages problem={problem} notice={notice} />
        <ReadExample
          kind="create_campaign"
          hint="Paste Sarvam's Create Campaign API example. The agent, version, connection, numbers and call rate are read from it; retry rules and schedule already saved are kept."
          onApply={(fields) => {
            const filled: string[] = [];
            setForm((prev) => {
              const next = { ...prev };
              if (fields.appId) { next.appId = String(fields.appId); filled.push("Agent ID"); }
              if (fields.appVersion) { next.appVersion = String(fields.appVersion); filled.push("Version"); }
              if (fields.connectionId) { next.connectionId = String(fields.connectionId); filled.push("Connection ID"); }
              if (Array.isArray(fields.phoneNumbers) && fields.phoneNumbers.length) { next.phoneNumbers = (fields.phoneNumbers as string[]).join(", "); filled.push("Numbers"); }
              if (fields.attemptsPerSecond) { next.attemptsPerSecond = String(fields.attemptsPerSecond); filled.push("Calls per second"); }
              return next;
            });
            return filled;
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sarvam agent ID">
            <input className={`${inputClass} font-mono`} value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} />
          </Field>
          <Field label="Version">
            <input className={inputClass} type="number" min={1} value={form.appVersion} onChange={(e) => setForm({ ...form, appVersion: e.target.value })} />
          </Field>
          <Field label="Connection ID">
            <input className={`${inputClass} font-mono`} value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })} />
          </Field>
          <Field label="Calls from" hint="One or more numbers, comma separated. A pool spreads the load.">
            <input className={inputClass} value={form.phoneNumbers} onChange={(e) => setForm({ ...form, phoneNumbers: e.target.value })} placeholder="+91…, +91…" />
          </Field>
          <Field label="Attempts per second" hint="How fast the campaign dials.">
            <input className={inputClass} type="number" min={1} value={form.attemptsPerSecond} onChange={(e) => setForm({ ...form, attemptsPerSecond: e.target.value })} />
          </Field>
          <Field label="How leads are handed over">
            <select className={inputClass} value={form.cohortMode} onChange={(e) => setForm({ ...form, cohortMode: e.target.value })}>
              <option value="stream">Stream (recommended)</option>
              <option value="upload">Upload</option>
            </select>
          </Field>
          <Field label="Declared variables" className="sm:col-span-2" hint="Comma separated, exactly as declared in Sarvam. Empty means none.">
            <input className={inputClass} value={form.agentVariables} onChange={(e) => setForm({ ...form, agentVariables: e.target.value })} placeholder="company_name, product_name, …" />
          </Field>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-muted">
          A campaign&apos;s retry rules and calling schedule are kept as they are and are not changed by saving here.
        </p>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            save({
              ...(config ?? {}),
              appId: form.appId.trim(),
              appVersion: Number(form.appVersion) || 0,
              appType: config?.appType ?? "agent",
              connectionId: form.connectionId.trim(),
              phoneNumbers: toList(form.phoneNumbers),
              attemptsPerSecond: Number(form.attemptsPerSecond) || 1,
              cohortMode: form.cohortMode === "upload" ? "upload" : "stream",
              agentVariables: toList(form.agentVariables),
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save campaign agent
        </Button>
      </div>
    </Card>
  );
}

function seedBatch(config: Batch | null) {
  return {
    appId: config?.appId ?? "",
    appVersion: config ? String(config.appVersion) : "",
    connectionId: config?.connectionId ?? "",
    phoneNumbers: fromList(config?.phoneNumbers),
    attemptsPerSecond: config ? String(config.attemptsPerSecond) : "1",
    cohortMode: (config?.cohortMode ?? "stream") as string,
    agentVariables: fromList(config?.agentVariables),
  };
}

// ------------------------------------------------------------
// Inbound — the agent that answers
// ------------------------------------------------------------

function InboundEditor({ config, from, onSaved }: { config: Inbound | null; from: Outbound | null; onSaved: () => void }) {
  const { save, busy, problem, notice } = useSectionSave("inbound", onSaved);
  const [form, setForm] = useState(() => ({
    appId: config?.appId ?? "",
    appVersion: config ? String(config.appVersion) : "",
    connectionId: config?.connectionId ?? "",
    agentVariables: fromList(config?.agentVariables),
  }));

  const autofill = () => {
    if (!from) return;
    setForm({
      appId: from.appId,
      appVersion: String(from.appVersion),
      connectionId: from.connectionId,
      agentVariables: fromList(from.agentVariables),
    });
  };

  return (
    <Card>
      <CardHead
        title="Inbound agent"
        note="Answers the calls patients place"
        actions={
          <span className="flex items-center gap-2">
            {from && (
              <Button variant="quiet" onClick={autofill}>
                Copy from outbound agent
              </Button>
            )}
            <Status label={config ? "Saved" : "Not set"} tone={config ? "good" : "neutral"} />
          </span>
        }
      />
      <div className="space-y-4 p-5">
        <SectionMessages problem={problem} notice={notice} />
        <ReadExample
          kind="inbound_deployment"
          hint="Paste Sarvam's Inbound Deployment API example or its response. The inbound agent, version and connection are read from it. The deployment ID and the number patients ring are configured on the platform's Inbound page."
          onApply={(fields) => {
            const filled: string[] = [];
            setForm((prev) => {
              const next = { ...prev };
              if (fields.appId) { next.appId = String(fields.appId); filled.push("Agent ID"); }
              if (fields.appVersion) { next.appVersion = String(fields.appVersion); filled.push("Version"); }
              if (fields.connectionId) { next.connectionId = String(fields.connectionId); filled.push("Connection ID"); }
              return next;
            });
            return filled;
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sarvam agent ID">
            <input className={`${inputClass} font-mono`} value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} />
          </Field>
          <Field label="Version">
            <input className={inputClass} type="number" min={1} value={form.appVersion} onChange={(e) => setForm({ ...form, appVersion: e.target.value })} />
          </Field>
          <Field label="Connection ID">
            <input className={`${inputClass} font-mono`} value={form.connectionId} onChange={(e) => setForm({ ...form, connectionId: e.target.value })} />
          </Field>
          <Field label="Declared variables" hint="Comma separated, exactly as declared in Sarvam. Empty means none.">
            <input className={inputClass} value={form.agentVariables} onChange={(e) => setForm({ ...form, agentVariables: e.target.value })} />
          </Field>
        </div>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            save({
              ...(config ?? {}),
              appId: form.appId.trim(),
              appVersion: Number(form.appVersion) || 0,
              connectionId: form.connectionId.trim(),
              agentVariables: toList(form.agentVariables),
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save inbound agent
        </Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Showing the agent working
// ------------------------------------------------------------

/**
 * Places one real call, to one number somebody types.
 *
 * Written to be impossible to mistake for a simulation: it says it will ring
 * a real phone before it does, shows exactly which number and which agent,
 * and asks once more on the button itself. It reads no list — the only number
 * it can dial is the one in the field.
 */
function DemoCall() {
  const { data } = useApi<{
    ready: boolean;
    problems: string[];
    agent: { name: string; callsFrom: string | null };
    hospital: { name: string };
    warning: string;
  }>("hospital/demo-call");

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ callId: string; phone: string } | null>(null);

  const dial = async () => {
    if (!confirm(`Call ${phone} now? This rings a real phone and is billed like any other call.`)) return;
    setBusy(true);
    setProblem(null);
    setPlaced(null);
    try {
      const result = await api<{ callId: string; phone: string }>("hospital/demo-call", {
        method: "POST",
        body: JSON.stringify({ phone, name }),
      });
      setPlaced(result);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "The call could not be placed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead
        title="Place a demonstration call"
        note="One real call, to one number you type"
        actions={<Status label={data?.ready ? "Ready" : "Not ready"} tone={data?.ready ? "good" : "neutral"} />}
      />
      <div className="space-y-4 p-5">
        {!data?.ready && data?.problems?.length ? (
          <NotConfigured what="A call cannot be placed yet" how={data.problems.join(" ")} />
        ) : null}

        <p className="flex items-start gap-2.5 rounded-lg border border-clay/30 bg-clay-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink">
          <PhoneOutgoing className="mt-0.5 h-4 w-4 shrink-0 text-clay" />
          {data?.warning ?? "This places a real call."}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Number to call" hint="With the country code. This is the only number that will be dialled.">
            <input className={inputClass} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91…" inputMode="tel" />
          </Field>
          <Field label="Who is answering" hint="What the agent will call them. Optional.">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
        </div>

        <p className="text-[12px] leading-relaxed text-ink-muted">
          {data?.agent.name ?? "The agent"} will call from {data?.agent.callsFrom ?? "the workspace's number"} on behalf
          of {data?.hospital.name ?? "this hospital"}, with the hospital context it would have on any call.
        </p>

        {problem && <Problem message={problem} />}
        {placed && (
          <p className="rounded-lg border border-sage/30 bg-sage-soft px-3.5 py-3 text-[13px] text-sage-ink">
            Calling {placed.phone} now. It will appear in Call History once the provider reports on it.
          </p>
        )}

        <Button variant="primary" onClick={dial} disabled={busy || !phone.trim() || !data?.ready}>
          {busy ? "Placing the call…" : "Call this number now"}
        </Button>

        <ul className="space-y-1 text-[11.5px] leading-relaxed text-ink-muted">
          <li>· Only the number above is dialled. No list, campaign or patient table is read.</li>
          <li>· A number belonging to someone who has opted out is refused.</li>
          <li>· A seeded demonstration patient&rsquo;s number is refused — those numbers are fictional.</li>
          <li>· Every demonstration call is recorded in this hospital&rsquo;s activity.</li>
        </ul>
      </div>
    </Card>
  );
}
