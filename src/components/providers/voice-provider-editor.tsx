"use client";

// ============================================================
// Tringlo AI — the voice provider editor, used in both places
// ============================================================
//
// There is one of these. The creation wizard renders it starting from an empty
// draft; Settings renders it starting from what the workspace has saved. Both
// get the same three sections, the same paste-the-example areas, the same
// parser and the same validation, because an administrator changing an agent
// a month later should not meet a lesser version of the form they filled in.
//
// The component holds no secrets. It never sees Tringlo's Sarvam key, the
// workspace's webhook token, or any other workspace's settings: it is given a
// draft and hands back a draft.
// ============================================================

import { useState } from "react";

import { SnippetImport, StatusChip } from "@/components/auth/snippet-import";
import { VariableMapper } from "@/components/providers/variable-mapper";
import type { SnippetResult } from "@/lib/providers/sarvam/snippet-import";
import {
  DAYS,
  draftStatus,
  field,
  type VoiceProviderDraft,
} from "@/lib/providers/draft";

// Re-exported so both screens import the editor and get the rules with it.
export {
  DAYS,
  draftFromSaved,
  draftProblems,
  draftStatus,
  draftToPayload,
  emptyDraft,
  field,
} from "@/lib/providers/draft";
export type { SavedProviderView, VoiceProviderDraft } from "@/lib/providers/draft";

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 block">
      <span className="block text-xs font-medium text-foreground">{children}</span>
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </span>
  );
}

// ------------------------------------------------------------
// What an import did
// ------------------------------------------------------------

export interface ImportReport {
  /** Which section the paste belonged to. */
  section: string;
  /** Fields the paste filled in, with the value now in the form. */
  extracted: Array<{ label: string; value: string }>;
  /** Fields the paste did not mention, and which kept their value. */
  preserved: Array<{ label: string; value: string }>;
  /** Fields still empty after the paste. */
  missing: string[];
  problems: string[];
  warnings: string[];
  /**
   * A value the paste carried that belongs in a field rather than in the
   * import box — a deployment ID pasted on its own. Offered with a button
   * instead of applied, so nothing is filled in on a guess.
   */
  offer?: { label: string; value: string; use: () => void };
}

/** Fields each section cares about, for the extracted/preserved/missing list. */
const FIELD_LABELS: Record<string, string> = {
  appId: "Agent ID",
  appVersion: "Agent version",
  connectionId: "Connection ID",
  phoneNumber: "Caller number",
  phoneNumbers: "Number pool",
  attemptsPerSecond: "Calls per second",
  maxRetries: "Retries",
  retryInterval: "Minutes between retries",
  startTime: "From",
  endTime: "Until",
  days: "Days",
  timezone: "Timezone",
  deploymentId: "Deployment ID",
  handoffNumber: "Human handoff number",
};

/**
 * Compares the section before and after a paste, so the administrator can see
 * what the paste changed, what it left alone, and what is still missing —
 * rather than hunting for differences in a form that silently moved.
 */
function compare(
  section: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  result: SnippetResult
): ImportReport {
  const extracted: ImportReport["extracted"] = [];
  const preserved: ImportReport["preserved"] = [];
  const missing: string[] = [];
  const show = (value: unknown) => (Array.isArray(value) ? value.join(", ") : String(value ?? ""));

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (!(key in after)) continue;
    const now = show(after[key]);
    const was = show(before[key]);
    if (now !== was) extracted.push({ label, value: now });
    else if (now) preserved.push({ label, value: now });
    else missing.push(label);
  }
  return { section, extracted, preserved, missing, problems: result.problems, warnings: result.warnings };
}

/**
 * When a paste turned out to be a deployment ID on its own, hands the summary
 * a one-click way to put it in the Deployment ID field. The ID is never
 * applied by the paste itself: an administrator decides it belongs here.
 */
function offerDeploymentId(
  summary: ImportReport,
  result: SnippetResult,
  setInbound: (changes: { deploymentId: string }) => void
): ImportReport {
  const candidate = result.fields.deploymentIdCandidate;
  if (typeof candidate !== "string" || !candidate) return summary;
  return {
    ...summary,
    offer: {
      label: "Deployment ID found in that paste:",
      value: candidate,
      use: () => setInbound({ deploymentId: candidate }),
    },
  };
}

function ImportSummary({ report }: { report: ImportReport }) {
  const line = (title: string, items: Array<{ label: string; value: string }>) =>
    items.length ? (
      <p className="text-[11px]">
        <span className="font-medium">{title}</span>{" "}
        <span className="text-muted-foreground">
          {items.map((item) => `${item.label} = ${item.value}`).join(" · ")}
        </span>
      </p>
    ) : null;

  return (
    <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
      <p className="text-xs font-semibold">{report.section}: what the paste did</p>
      {line("Filled in", report.extracted)}
      {line("Kept as it was", report.preserved)}
      {report.missing.length > 0 && (
        <p className="text-[11px]">
          <span className="font-medium">Still to set by hand</span>{" "}
          <span className="text-muted-foreground">{report.missing.join(" · ")}</span>
        </p>
      )}
      {report.warnings.map((warning) => (
        <p key={warning} className="text-[11px] text-muted-foreground">
          {warning}
        </p>
      ))}
      {report.offer && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {report.offer.label} <span className="font-mono">{report.offer.value}</span>
          </span>
          <button
            type="button"
            onClick={report.offer.use}
            className="h-6 rounded-md border bg-background px-2 text-[11px] font-medium transition-colors hover:bg-muted"
          >
            Use this ID
          </button>
        </div>
      )}
      {report.extracted.length === 0 && report.warnings.length === 0 && report.problems.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Nothing changed — the example matched what is already here.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// The sections
// ------------------------------------------------------------

/** Offered for the timezone fields: typed freely, but spelled correctly. */
const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
  "Australia/Sydney", "UTC",
];

function TimezoneOptions() {
  return (
    <datalist id="dialo-timezones">
      {TIMEZONES.map((zone) => (
        <option key={zone} value={zone} />
      ))}
    </datalist>
  );
}

/** The weekday buttons, shared by the campaign and inbound schedules. */
function DayPicker({ value, onPick }: { value: string[]; onPick: (days: string[]) => void }) {
  const toggle = (day: string) => (value.includes(day) ? value.filter((d) => d !== day) : [...value, day]);
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {DAYS.map((day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(toggle(day))}
            className={`h-8 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
            }`}
          >
            {day.slice(0, 3)}
          </button>
        );
      })}
    </div>
  );
}

export function VoiceProviderSections({
  draft,
  onChange,
  saved = false,
  autoFocus = false,
}: {
  draft: VoiceProviderDraft;
  onChange: (next: VoiceProviderDraft) => void;
  /** True in Settings, where these values are already stored. */
  saved?: boolean;
  autoFocus?: boolean;
}) {
  const [reports, setReports] = useState<Record<string, ImportReport>>({});
  const status = draftStatus(draft, saved);

  const setSingle = (patch: Partial<VoiceProviderDraft["single"]>) =>
    onChange({ ...draft, single: { ...draft.single, ...patch } });
  const setBatch = (patch: Partial<VoiceProviderDraft["batch"]>) =>
    onChange({ ...draft, batch: { ...draft.batch, ...patch } });
  const setInbound = (patch: Partial<VoiceProviderDraft["inbound"]>) =>
    onChange({ ...draft, inbound: { ...draft.inbound, ...patch } });

  const report = (key: string, value: ImportReport) => setReports((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-5">
      <TimezoneOptions />
      <p className="text-xs text-muted-foreground">
        From your Sarvam workspace. Tringlo connects with its own Sarvam account; these say which agent and numbers
        belong to this workspace.
      </p>

      {/* ---------- A. one call at a time ---------- */}
      <section data-section="single outbound" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Single outbound calling</h3>
            <p className="text-[11px] text-muted-foreground">
              Calling one lead now, from the Leads page or a scheduled callback.
            </p>
          </div>
          <StatusChip state={status.single} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex h-full flex-col">
            <Label>Outbound agent ID</Label>
            <input value={draft.single.appId} onChange={(e) => setSingle({ appId: e.target.value })} placeholder="Conversatio-…" className={`${field} mt-auto`} autoFocus={autoFocus} />
          </label>
          <label className="flex h-full flex-col">
            <Label>Agent version</Label>
            <input value={draft.single.appVersion} onChange={(e) => setSingle({ appVersion: e.target.value })} inputMode="numeric" placeholder="4" className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col">
            <Label>Telephony connection ID</Label>
            <input value={draft.single.connectionId} onChange={(e) => setSingle({ connectionId: e.target.value })} className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col">
            <Label hint="What the customer sees.">Caller number</Label>
            <input value={draft.single.phoneNumber} onChange={(e) => setSingle({ phoneNumber: e.target.value })} placeholder="+91…" className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col sm:col-span-2">
            <Label hint="Exactly as the Sarvam agent declares them, comma separated. Sarvam refuses a whole call over one it does not declare. Leave empty if the agent takes none — the call still goes.">
              Agent variables
            </Label>
            <input
              value={draft.single.agentVariables}
              onChange={(e) => setSingle({ agentVariables: e.target.value })}
              placeholder="e.g. patient_name, appointment_date — or leave empty"
              className={`${field} mt-auto font-mono text-xs`}
            />
          </label>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={Boolean(draft.single.useOwnGreeting)}
              onChange={(e) => setSingle({ useOwnGreeting: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              Let the agent open the call its own way. Tringlo otherwise sends an opening line naming your company,
              which suits an outbound sales call and not an agent whose prompt greets differently.
            </span>
          </label>
        </div>

        <div className="rounded-lg border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium">Where each variable&apos;s value comes from</p>
          <VariableMapper
            mappings={draft.single.mappings}
            onChange={(mappings) => setSingle({ mappings })}
          />
        </div>

        <SnippetImport
          kind="instant_outbound"
          label="Import Sarvam Instant Outbound API Example"
          hint="From Sarvam's Instant Outbound page. Tringlo reads the agent, version, connection and caller number out of it; the webhook, agent variables and customer number are Tringlo's own and are never saved here."
          onResult={(result) => {
            const before = { ...draft.single };
            const after = {
              appId: result.fields.appId ? String(result.fields.appId) : before.appId,
              appVersion: result.fields.appVersion ? String(result.fields.appVersion) : before.appVersion,
              connectionId: result.fields.connectionId ? String(result.fields.connectionId) : before.connectionId,
              phoneNumber: result.fields.phoneNumber ? String(result.fields.phoneNumber) : before.phoneNumber,
            };
            setSingle(after);
            report("single", compare("Single outbound", before, after, result));
          }}
        />
        {reports.single && <ImportSummary report={reports.single} />}
      </section>

      {/* ---------- B. campaigns ---------- */}
      <section data-section="batch outbound" className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Batch outbound calling</h3>
            <p className="text-[11px] text-muted-foreground">
              Campaigns: a list of leads, dialled on a schedule, with retries.
            </p>
          </div>
          <StatusChip state={status.batch} />
        </div>

        <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-3">
          <input
            type="checkbox"
            checked={draft.batch.sameAsSingle}
            onChange={(event) => setBatch({ sameAsSingle: event.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium">Use the same agent and number as single calls</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              Copies the four values above. Uncheck to give campaigns their own agent, connection or a pool of numbers.
            </span>
          </span>
        </label>

        {!draft.batch.sameAsSingle && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex h-full flex-col">
              <Label>Campaign agent ID</Label>
              <input value={draft.batch.appId} onChange={(e) => setBatch({ appId: e.target.value })} className={`${field} mt-auto`} />
            </label>
            <label className="flex h-full flex-col">
              <Label>Campaign agent version</Label>
              <input value={draft.batch.appVersion} onChange={(e) => setBatch({ appVersion: e.target.value })} inputMode="numeric" className={`${field} mt-auto`} />
            </label>
            <label className="flex h-full flex-col">
              <Label>Campaign connection ID</Label>
              <input value={draft.batch.connectionId} onChange={(e) => setBatch({ connectionId: e.target.value })} className={`${field} mt-auto`} />
            </label>
            <label className="flex h-full flex-col">
              <Label hint="One number, or several separated by commas.">Numbers campaigns dial from</Label>
              <input value={draft.batch.phoneNumbers} onChange={(e) => setBatch({ phoneNumbers: e.target.value })} placeholder="+91…, +91…" className={`${field} mt-auto`} />
            </label>
            <label className="flex h-full flex-col sm:col-span-2">
              <Label hint="Exactly as this agent declares them, comma separated. A sheet column is only sent when it is on this list.">
                Agent variables
              </Label>
              <input
                value={draft.batch.agentVariables}
                onChange={(e) => setBatch({ agentVariables: e.target.value })}
                placeholder="customer_name, phone_number, company_name"
                className={`${field} mt-auto font-mono text-xs`}
              />
            </label>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex h-full flex-col">
            <Label hint="How fast a campaign dials.">Calls per second</Label>
            <input value={draft.batch.attemptsPerSecond} onChange={(e) => setBatch({ attemptsPerSecond: e.target.value })} inputMode="decimal" className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col">
            <Label hint="Per lead, when a call does not connect.">Retries</Label>
            <input value={draft.batch.maxRetries} onChange={(e) => setBatch({ maxRetries: e.target.value })} inputMode="numeric" className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col">
            <Label>Minutes between retries</Label>
            <input value={draft.batch.retryInterval} onChange={(e) => setBatch({ retryInterval: e.target.value })} inputMode="numeric" className={`${field} mt-auto`} />
          </label>
          <fieldset>
            <Label>Retry when</Label>
            <div className="flex gap-3 pt-1 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.batch.onBusy} onChange={(e) => setBatch({ onBusy: e.target.checked })} />
                Busy
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={draft.batch.onNoAnswer} onChange={(e) => setBatch({ onNoAnswer: e.target.checked })} />
                No answer
              </label>
            </div>
          </fieldset>
          <label className="flex h-full flex-col">
            <Label>Campaigns may call from</Label>
            <input type="time" value={draft.batch.startTime} onChange={(e) => setBatch({ startTime: e.target.value })} className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col">
            <Label>Until</Label>
            <input type="time" value={draft.batch.endTime} onChange={(e) => setBatch({ endTime: e.target.value })} className={`${field} mt-auto`} />
          </label>
          <label className="flex h-full flex-col sm:col-span-2">
            <Label>Timezone</Label>
            <input
              value={draft.batch.timezone}
              onChange={(e) => setBatch({ timezone: e.target.value })}
              list="dialo-timezones"
              className={`${field} mt-auto`}
            />
          </label>
          <fieldset className="sm:col-span-2">
            <Label>Days campaigns may call</Label>
            <DayPicker value={draft.batch.days} onPick={(days) => setBatch({ days })} />
          </fieldset>
        </div>

        <SnippetImport
          kind="create_campaign"
          label="Import Sarvam Create Campaign API Example"
          hint="Tringlo reads the agent, connection, numbers, call rate, retry rules and allowed hours. The campaign's name, dates and webhook belong to each campaign, not to the workspace."
          onResult={(result) => {
            const before = { ...draft.batch };
            const fields = result.fields;
            const retry = fields.retry as Record<string, unknown> | undefined;
            const schedule = fields.schedule as Record<string, unknown> | undefined;
            // An example that names its own agent means campaigns are not
            // simply reusing the single-call settings; that switch is made
            // here, visibly, and never silently either way.
            const ownAgent = Boolean(fields.appId || fields.connectionId || fields.phoneNumbers);
            const after = {
              ...before,
              sameAsSingle: ownAgent ? false : before.sameAsSingle,
              appId: fields.appId ? String(fields.appId) : before.appId,
              appVersion: fields.appVersion ? String(fields.appVersion) : before.appVersion,
              connectionId: fields.connectionId ? String(fields.connectionId) : before.connectionId,
              phoneNumbers: Array.isArray(fields.phoneNumbers) ? (fields.phoneNumbers as string[]).join(", ") : before.phoneNumbers,
              attemptsPerSecond: fields.attemptsPerSecond ? String(fields.attemptsPerSecond) : before.attemptsPerSecond,
              maxRetries: retry?.maxRetries !== undefined ? String(retry.maxRetries) : before.maxRetries,
              retryInterval: retry?.intervalMinutes !== undefined ? String(retry.intervalMinutes) : before.retryInterval,
              onBusy: retry ? Boolean(retry.onBusy) : before.onBusy,
              onNoAnswer: retry ? Boolean(retry.onNoAnswer) : before.onNoAnswer,
              startTime: schedule?.startTime ? String(schedule.startTime).slice(0, 5) : before.startTime,
              endTime: schedule?.endTime ? String(schedule.endTime).slice(0, 5) : before.endTime,
              timezone: schedule?.timezone ? String(schedule.timezone) : before.timezone,
              days: Array.isArray(schedule?.days) && schedule.days.length ? (schedule.days as string[]) : before.days,
            };
            setBatch(after);
            report("batch", compare("Batch outbound", before, after, result));
          }}
        />
        {reports.batch && <ImportSummary report={reports.batch} />}

        <SnippetImport
          kind="upload_cohort"
          label="Import Sarvam Upload Cohort API Example"
          hint="Checks the cohort endpoints. Direct Sarvam CSV upload is not enabled — it needs a transformation file whose format Sarvam does not publish. Tringlo submits leads through the supported Stream cohort API, up to 1000 at a time, from the sheet you upload per campaign."
          onResult={(result) => report("cohort", {
            section: "Upload cohort",
            extracted: [],
            preserved: [],
            missing: [],
            problems: result.problems,
            warnings: result.ok
              ? [
                  "Import recognised — direct Sarvam CSV upload is not enabled. Tringlo uses the supported Stream Cohort API for lead submission.",
                  ...result.warnings,
                ]
              : result.warnings,
          })}
        />
        {reports.cohort && (
          <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-semibold">Upload cohort</p>
            {reports.cohort.warnings.map((warning) => (
              <p key={warning} className="text-[11px] text-muted-foreground">{warning}</p>
            ))}
            {reports.cohort.problems.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Nothing from this example is stored. Lead submission is configured by Tringlo, not per workspace.
              </p>
            )}
          </div>
        )}

        <SnippetImport
          kind="pause_resume"
          label="Import Sarvam Pause / Resume API Example"
          hint="Confirms the campaign status endpoint. A campaign ID belongs to one campaign, so nothing from this example is saved as a workspace setting — pausing and resuming act on whichever campaign you choose."
          onResult={(result) => report("pauseResume", {
            section: "Pause / resume",
            extracted: [],
            preserved: [],
            missing: [],
            problems: result.problems,
            warnings: result.warnings,
          })}
        />
        {reports.pauseResume && (
          <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-semibold">Pause / resume</p>
            {reports.pauseResume.problems.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Endpoint recognised. Tringlo already pauses and resumes campaigns; the campaign ID stays with each
                campaign and is never saved here.
              </p>
            )}
            {reports.pauseResume.warnings.map((warning) => (
              <p key={warning} className="text-[11px] text-muted-foreground">{warning}</p>
            ))}
          </div>
        )}
      </section>

      {/* ---------- C. inbound ---------- */}
      <section data-section="inbound" className="space-y-3 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Inbound calling</h3>
            <p className="text-[11px] text-muted-foreground">Optional, and separate from outbound.</p>
          </div>
          <StatusChip
            state={status.inbound}
            label={draft.inbound.on ? (saved ? undefined : "Ready to save, stays off") : "Off"}
          />
        </div>

        <div className="rounded-lg border p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="text-xs font-medium">Configure inbound for this workspace</span>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Saving these settings never starts, replaces or stops a line. Switching inbound on is a separate step
                on the inbound card, and outbound and campaigns work the same whether this is on or off.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.inbound.on}
              aria-label="Configure inbound calling"
              onClick={() => setInbound({ on: !draft.inbound.on })}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.inbound.on ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${draft.inbound.on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>

          {draft.inbound.on && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex h-full flex-col">
                <Label hint="Leave empty to use the outbound agent.">Inbound agent ID</Label>
                <input value={draft.inbound.appId} onChange={(e) => setInbound({ appId: e.target.value })} className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col">
                <Label>Inbound agent version</Label>
                <input value={draft.inbound.appVersion} onChange={(e) => setInbound({ appVersion: e.target.value })} inputMode="numeric" className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col">
                <Label>Connection ID</Label>
                <input value={draft.inbound.connectionId} onChange={(e) => setInbound({ connectionId: e.target.value })} placeholder="Same as outbound" className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col">
                <Label hint="The number people will call.">Inbound number</Label>
                <input value={draft.inbound.phoneNumber} onChange={(e) => setInbound({ phoneNumber: e.target.value })} placeholder="+91…" className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col">
                <Label hint="Sarvam mints this when the deployment is created. Paste the response below, or type it in.">
                  Inbound Deployment ID
                </Label>
                <input value={draft.inbound.deploymentId} onChange={(e) => setInbound({ deploymentId: e.target.value })} className={`${field} mt-auto font-mono text-xs`} />
              </label>
              <label className="flex h-full flex-col">
                <Label hint="Where a caller asking for a person is sent.">Human handoff number</Label>
                <input value={draft.inbound.handoffNumber} onChange={(e) => setInbound({ handoffNumber: e.target.value })} placeholder="+91…" className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col">
                <Label>Answers from</Label>
                <input type="time" value={draft.inbound.startTime} onChange={(e) => setInbound({ startTime: e.target.value })} className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col">
                <Label>Until</Label>
                <input type="time" value={draft.inbound.endTime} onChange={(e) => setInbound({ endTime: e.target.value })} className={`${field} mt-auto`} />
              </label>
              <label className="flex h-full flex-col sm:col-span-2">
                <Label>Timezone</Label>
                <input
                  value={draft.inbound.timezone}
                  onChange={(e) => setInbound({ timezone: e.target.value })}
                  list="dialo-timezones"
                  className={`${field} mt-auto`}
                />
              </label>
              <fieldset className="sm:col-span-2">
                <Label>Days</Label>
                <DayPicker value={draft.inbound.days} onPick={(days) => setInbound({ days })} />
              </fieldset>
            </div>
          )}
        </div>

        {draft.inbound.on && (
          <>
            <SnippetImport
              kind="inbound_deployment"
              label="Import Sarvam Inbound Deployment API Example"
              hint="The request you sent Sarvam to create the deployment. Tringlo reads the inbound agent, connection, number and answering hours. The request does not contain the deployment ID — paste the response below for that."
              onResult={(result) => {
                const before = { ...draft.inbound };
                const fields = result.fields;
                const after = {
                  ...before,
                  appId: fields.appId ? String(fields.appId) : before.appId,
                  appVersion: fields.appVersion ? String(fields.appVersion) : before.appVersion,
                  connectionId: fields.connectionId ? String(fields.connectionId) : before.connectionId,
                  phoneNumber: fields.phoneNumber ? String(fields.phoneNumber) : before.phoneNumber,
                  deploymentId: fields.deploymentId ? String(fields.deploymentId) : before.deploymentId,
                  startTime: fields.startTime ? String(fields.startTime) : before.startTime,
                  endTime: fields.endTime ? String(fields.endTime) : before.endTime,
                  timezone: fields.timezone ? String(fields.timezone) : before.timezone,
                  days: Array.isArray(fields.days) && fields.days.length ? (fields.days as string[]) : before.days,
                };
                setInbound(after);
                const summary = offerDeploymentId(compare("Inbound deployment", before, after, result), result, setInbound);
                if (result.ok && !fields.deploymentId && !before.deploymentId) {
                  summary.warnings = [
                    ...summary.warnings,
                    "That request does not contain a deployment ID, and none was invented. Paste Sarvam's response below, or type the ID in.",
                  ];
                }
                report("inbound", summary);
              }}
            />
            {reports.inbound && <ImportSummary report={reports.inbound} />}

            <SnippetImport
              kind="deployment_response"
              label="Import Sarvam Deployment Response"
              hint="Sarvam's JSON answer when the deployment was created or fetched. This is the only place the deployment ID exists, so paste it here to replace a deployment without recreating the workspace."
              onResult={(result) => {
                const before = { ...draft.inbound };
                const fields = result.fields;
                const after = {
                  ...before,
                  deploymentId: fields.deploymentId ? String(fields.deploymentId) : before.deploymentId,
                  appId: fields.appId ? String(fields.appId) : before.appId,
                  appVersion: fields.appVersion ? String(fields.appVersion) : before.appVersion,
                  connectionId: fields.connectionId ? String(fields.connectionId) : before.connectionId,
                  phoneNumber: fields.phoneNumber ? String(fields.phoneNumber) : before.phoneNumber,
                  startTime: fields.startTime ? String(fields.startTime) : before.startTime,
                  endTime: fields.endTime ? String(fields.endTime) : before.endTime,
                  timezone: fields.timezone ? String(fields.timezone) : before.timezone,
                  days: Array.isArray(fields.days) && fields.days.length ? (fields.days as string[]) : before.days,
                };
                setInbound(after);
                report("response", offerDeploymentId(compare("Deployment response", before, after, result), result, setInbound));
              }}
            />
            {reports.response && <ImportSummary report={reports.response} />}

            {/* Adding known callers is a different operation on a different
                Sarvam service, so it gets its own area rather than sharing the
                deployment one. Pasting it checks the integration; the callers
                themselves are this workspace's own contacts, sent from the
                inbound card. */}
            <SnippetImport
              kind="known_callers"
              label="Import Sarvam Known-Caller List example"
              hint="The Stream Cohort request that adds known callers to a deployment. Tringlo checks the endpoint and takes the deployment ID when the example carries a real one. The example's callers are never imported — known callers are this workspace's own contacts, sent from the inbound card."
              onResult={(result) => {
                const before = { ...draft.inbound };
                const after = {
                  ...before,
                  deploymentId: result.fields.deploymentId ? String(result.fields.deploymentId) : before.deploymentId,
                };
                setInbound(after);
                const summary = compare("Known-caller list", before, after, result);
                const recognised = result.fields.recognisedFields as string[] | undefined;
                if (result.ok) {
                  summary.warnings = [
                    recognised?.length ? `Recognised: ${recognised.join(", ")}.` : "Endpoint recognised.",
                    ...summary.warnings,
                  ];
                  if (!after.deploymentId) {
                    summary.missing = [...summary.missing, "Deployment ID — set it above, or paste the deployment response"];
                  }
                }
                report("knownCallers", summary);
              }}
            />
            {reports.knownCallers && <ImportSummary report={reports.knownCallers} />}
          </>
        )}
      </section>
    </div>
  );
}
