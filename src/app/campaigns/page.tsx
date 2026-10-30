"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Loader2, Megaphone, Plus, Upload } from "lucide-react";

import { EmptyState, ErrorState, PageHeader, SkeletonBlock, Tag } from "@/components/ui/data-display";
import { useApi } from "@/lib/use-tringlo-data";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type CampaignStatsView, type CampaignStatus } from "@/components/campaigns/shared";

// ------------------------------------------------------------
// API shapes
// ------------------------------------------------------------

interface CampaignListItem {
  id: string;
  name: string;
  status: CampaignStatus;
  createdAt: string;
  launchedAt: string | null;
  schedule: { start: string; end: string; timezone: string };
  failureReason: string | null;
  stats: CampaignStatsView;
}

interface ConfigView {
  ready: boolean;
  problems: string[];
  agent: { name: string | null; company: string | null; version: number | null; configured: boolean };
  phoneNumbers: string[];
  webhookReachable: boolean;
  cohortMode: "upload" | "stream";
  variables: string[];
  defaultTimezone: string;
}

interface ValidationView {
  columns: Array<{ name: string; role: string; note: string }>;
  phoneColumn: string | null;
  fileErrors: string[];
  counts: { rows: number; empty: number; valid: number; invalid: number; duplicates: number; warnings: number; existingLeads: number; returningCustomers: number };
  preview: Array<{ row: number; phone: string; name: string; variables: Record<string, string> }>;
  invalid: Array<{ row: number; field: string | null; message: string }>;
  duplicates: Array<{ row: number; phone: string; firstRow: number }>;
  warnings: Array<{ row: number; field: string | null; message: string }>;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; message: string; problems: string[] }> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) useAuthStore.getState().handleUnauthorized();
    if (!response.ok) {
      return { ok: false, message: data?.error?.message ?? `Request failed (${response.status}).`, problems: data?.error?.problems ?? [] };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, message: "Could not reach the server.", problems: [] };
  }
}

/** A datetime-local value for "now + minutes", in the browser's clock. */
function localInput(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  date.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

export default function CampaignsPage() {
  const [creating, setCreating] = useState(false);
  const list = useApi<{ campaigns: CampaignListItem[] }>("/api/campaigns", 10_000);

  if (creating) return <CampaignWizard onCancel={() => setCreating(false)} />;

  const campaigns = list.data?.campaigns ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Campaigns"
        description="Call a list of leads through Sarvam's campaign scheduler, with retries and calling hours handled for you"
        actions={
          <button
            onClick={() => setCreating(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New campaign
          </button>
        }
      />

      {list.error && <ErrorState message={list.error} onRetry={list.refresh} />}

      {list.isLoading ? (
        <SkeletonBlock rows={3} columns={4} />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Upload a sheet of leads and Sarvam will call them within the hours you choose. Every number on this page comes from real call results."
          action={
            <button
              onClick={() => setCreating(true)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Create campaign
            </button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/campaigns/${campaign.id}`}
                className="block rounded-lg border bg-card p-5 transition-colors hover:border-foreground/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h2 className="truncate font-heading text-base font-semibold tracking-tight">{campaign.name}</h2>
                      <Tag tone={STATUS_TONE[campaign.status]}>{STATUS_LABEL[campaign.status]}</Tag>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(campaign.schedule.start).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} –{" "}
                      {new Date(campaign.schedule.end).toLocaleDateString("en-IN", { dateStyle: "medium" })} · {campaign.schedule.timezone}
                    </p>
                    {campaign.failureReason && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-400">{campaign.failureReason}</p>
                    )}
                  </div>
                  <dl className="grid grid-cols-4 gap-5 text-right text-sm">
                    <div><dt className="text-xs text-muted-foreground">Leads</dt><dd className="font-medium tabular-nums">{campaign.stats.totalLeads}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Connected</dt><dd className="font-medium tabular-nums">{campaign.stats.connected}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Interested</dt><dd className="font-medium tabular-nums">{campaign.stats.interested}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Done</dt><dd className="font-medium tabular-nums">{Math.round(campaign.stats.progress * 100)}%</dd></div>
                  </dl>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${campaign.stats.progress * 100}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Wizard
// ------------------------------------------------------------

const STEPS = ["Campaign", "Agent", "Leads", "Preview", "Schedule", "Review"] as const;

function CampaignWizard({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const config = useApi<ConfigView>("/api/campaigns/config");
  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [cohortName, setCohortName] = useState("batch-1");
  const [attemptsPerSecond, setAttemptsPerSecond] = useState(1);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState("");
  const [validation, setValidation] = useState<ValidationView | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [start, setStart] = useState(() => localInput(10));
  const [end, setEnd] = useState(() => localInput(7 * 24 * 60));
  const [timezone, setTimezone] = useState<string | null>(null);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("19:00");
  const [days, setDays] = useState<string[]>(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

  const [maxRetries, setMaxRetries] = useState(3);
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [onBusy, setOnBusy] = useState(true);
  const [onNoAnswer, setOnNoAnswer] = useState(true);
  const [onFailed, setOnFailed] = useState(false);
  // Off by default: a customer who answers and says "call me at 3" in a few
  // seconds is a short call too, and Sarvam would ring them back long before 3.
  const [onShortDuration, setOnShortDuration] = useState(false);
  const [shortDurationSeconds, setShortDurationSeconds] = useState(25);

  const [skipInvalid, setSkipInvalid] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchProblems, setLaunchProblems] = useState<string[]>([]);

  const tz = timezone ?? config.data?.defaultTimezone ?? "Asia/Kolkata";

  const readFile = async (file: File) => {
    setValidationError(null);
    setValidation(null);
    if (!/\.csv$/i.test(file.name)) {
      setValidationError("Choose a .csv file. Export Excel sheets as CSV (UTF-8) first.");
      return;
    }
    if (file.size > 5_000_000) {
      setValidationError("The file is larger than 5 MB.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    setValidating(true);
    const result = await postJson<ValidationView>("/api/campaigns/validate", { csv: text });
    setValidating(false);
    if (!result.ok) setValidationError(result.message);
    else {
      setValidation(result.data);
      setSkipInvalid(false);
    }
  };

  const stepProblems = useMemo(() => {
    const problems: string[] = [];
    if (step === 0) {
      if (!name.trim()) problems.push("Give the campaign a name.");
      if (!/^[A-Za-z0-9 _-]{1,50}$/.test(cohortName.trim())) problems.push("Cohort name: 1–50 letters, numbers, spaces, _ or -.");
    }
    if (step === 1) {
      if (!(attemptsPerSecond >= 0.1 && attemptsPerSecond <= 500)) problems.push("Calling rate must be 0.1–500 per second.");
    }
    if (step === 2 && !validation) problems.push("Upload a CSV of leads.");
    if (step === 3 && validation) {
      if (validation.fileErrors.length) problems.push(...validation.fileErrors);
      if (validation.counts.valid === 0) problems.push("There are no valid leads.");
    }
    if (step === 4) {
      if (!start || !end || new Date(end) <= new Date(start)) problems.push("The end must be after the start.");
      if (endTime <= startTime) problems.push("Calling hours must end after they start.");
      if (days.length === 0) problems.push("Choose at least one day.");
      if (maxRetries < 0 || maxRetries > 20) problems.push("Max retries must be 0–20.");
      if (maxRetries > 0 && !(onBusy || onNoAnswer || onFailed || onShortDuration)) problems.push("Choose which outcomes to retry.");
    }
    return problems;
  }, [step, name, cohortName, attemptsPerSecond, validation, start, end, startTime, endTime, days, maxRetries, onBusy, onNoAnswer, onFailed, onShortDuration]);

  const launch = async () => {
    setLaunching(true);
    setLaunchProblems([]);
    const result = await postJson<{ campaign: { id: string } }>("/api/campaigns", {
      name,
      cohortName,
      csv,
      attemptsPerSecond,
      skipInvalidRows: skipInvalid,
      schedule: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        timezone: tz,
        startTime,
        endTime,
        days: DAYS.filter((day) => days.includes(day)),
      },
      retry: { maxRetries, intervalMinutes, onBusy, onNoAnswer, onFailed, onShortDuration, shortDurationSeconds },
    });
    setLaunching(false);
    setConfirmLaunch(false);
    if (!result.ok) {
      setLaunchProblems(result.problems.length ? result.problems : [result.message]);
      return;
    }
    router.push(`/campaigns/${result.data.campaign.id}`);
  };

  const input = "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  const label = "text-[13px] font-medium text-foreground";

  return (
    <div className="space-y-5">
      <PageHeader
        title="New campaign"
        description="Nothing is sent to Sarvam until you launch from the review step"
        actions={
          <button onClick={onCancel} className="inline-flex h-9 items-center rounded-md border px-3.5 text-sm hover:bg-muted">
            Discard
          </button>
        }
      />

      <ol className="flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((title, index) => (
          <li key={title}>
            <span
              aria-current={index === step ? "step" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium",
                index === step ? "border-primary bg-primary/10 text-primary" : index < step ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {index < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="tabular-nums">{index + 1}</span>}
              {title}
            </span>
          </li>
        ))}
      </ol>

      <section className="rounded-lg border bg-card p-6">
        {step === 0 && (
          <div className="grid max-w-xl gap-5">
            <div>
              <label htmlFor="c-name" className={label}>Campaign name</label>
              <input id="c-name" className={cn(input, "mt-1.5")} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="October follow-up" />
            </div>
            <div>
              <label htmlFor="c-cohort" className={label}>Cohort name</label>
              <input id="c-cohort" className={cn(input, "mt-1.5")} value={cohortName} onChange={(e) => setCohortName(e.target.value)} maxLength={50} />
              <p className="mt-1 text-xs text-muted-foreground">How this batch of leads is named at Sarvam.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-5">
            {config.isLoading ? (
              <SkeletonBlock rows={2} columns={2} />
            ) : config.data ? (
              <>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-md border p-4">
                    <dt className="text-xs text-muted-foreground">Voice agent</dt>
                    <dd className="mt-1 font-medium">{config.data.agent.name ?? "Configured agent"}{config.data.agent.version ? ` · v${config.data.agent.version}` : ""}</dd>
                    <p className="mt-1 text-xs text-muted-foreground">Set on the server; edit the agent’s details in AI Agent.</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <dt className="text-xs text-muted-foreground">Calls from</dt>
                    <dd className="mt-1 font-medium tabular-nums">{config.data.phoneNumbers.join(", ") || "Not set"}</dd>
                  </div>
                  <div className="rounded-md border p-4">
                    <dt className="text-xs text-muted-foreground">Results webhook</dt>
                    <dd className="mt-1 font-medium">{config.data.webhookReachable ? "Public address registered" : "Not reachable"}</dd>
                  </div>
                </dl>
                {!config.data.ready && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                    <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Campaigns can’t be launched yet</p>
                    <ul className="mt-2 list-disc space-y-1 pl-6">{config.data.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
                  </div>
                )}
                <div className="max-w-xs">
                  <label htmlFor="c-rate" className={label}>Calling rate (calls started per second)</label>
                  <input id="c-rate" type="number" min={0.1} max={500} step={0.1} className={cn(input, "mt-1.5")} value={attemptsPerSecond} onChange={(e) => setAttemptsPerSecond(Number(e.target.value))} />
                  <p className="mt-1 text-xs text-muted-foreground">Start low (1 or less) with a small first batch.</p>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Variables your agent accepts ({config.data.variables.length})</summary>
                  <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">{config.data.variables.join(", ")}</p>
                </details>
              </>
            ) : (
              <ErrorState message={config.error ?? "Could not load the campaign setup."} onRetry={config.refresh} />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              A CSV with a <code className="rounded bg-muted px-1">mobile</code> or <code className="rounded bg-muted px-1">phone_number</code> column. Other columns named after your agent’s variables — <code className="rounded bg-muted px-1">customer_name</code>, <code className="rounded bg-muted px-1">lead_notes</code>, … — are sent under the same names.
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-sm transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              {validating ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
              <span className="font-medium">{fileName ?? "Choose a CSV file"}</span>
              <span className="text-xs text-muted-foreground">{validating ? "Checking every row…" : "Up to 10,000 rows, 5 MB"}</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            {validationError && <ErrorState message={validationError} />}
            {validation && (
              <p className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                {validation.counts.rows} rows read · {validation.counts.valid} valid · {validation.counts.invalid} invalid · {validation.counts.duplicates} duplicates
              </p>
            )}
          </div>
        )}

        {step === 3 && validation && <PreviewStep validation={validation} />}

        {step === 4 && (
          <div className="grid gap-6 lg:grid-cols-2">
            <fieldset className="grid gap-4">
              <legend className="mb-2 text-sm font-semibold">When to call</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="c-start" className={label}>Starts</label><input id="c-start" type="datetime-local" className={cn(input, "mt-1.5")} value={start} onChange={(e) => setStart(e.target.value)} /></div>
                <div><label htmlFor="c-end" className={label}>Ends</label><input id="c-end" type="datetime-local" className={cn(input, "mt-1.5")} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              </div>
              <div>
                <label htmlFor="c-tz" className={label}>Timezone</label>
                <select id="c-tz" className={cn(input, "mt-1.5")} value={tz} onChange={(e) => setTimezone(e.target.value)}>
                  {[...new Set([tz, ...TIMEZONES])].map((zone) => <option key={zone}>{zone}</option>)}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="c-from" className={label}>Calling hours from</label><input id="c-from" type="time" className={cn(input, "mt-1.5")} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
                <div><label htmlFor="c-to" className={label}>until</label><input id="c-to" type="time" className={cn(input, "mt-1.5")} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
              </div>
              <div>
                <p className={label}>Days</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <label key={day} className={cn("inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs", days.includes(day) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
                      <input type="checkbox" className="sr-only" checked={days.includes(day)} onChange={(e) => setDays((current) => (e.target.checked ? [...current, day] : current.filter((d) => d !== day)))} />
                      {day.slice(0, 3)}
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            <fieldset className="grid content-start gap-4">
              <legend className="mb-2 text-sm font-semibold">Retries (by Sarvam)</legend>
              <p className="text-xs text-muted-foreground">
                For leads who don’t answer. A customer who answers and asks to be called later gets a scheduled follow-up instead — that is separate.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="c-retries" className={label}>Max retries</label><input id="c-retries" type="number" min={0} max={20} className={cn(input, "mt-1.5")} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value))} /></div>
                <div><label htmlFor="c-interval" className={label}>Minutes between attempts</label><input id="c-interval" type="number" min={1} className={cn(input, "mt-1.5")} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} disabled={maxRetries === 0} /></div>
              </div>
              <div className="grid gap-2 text-sm">
                {[
                  ["Busy", onBusy, setOnBusy],
                  ["No answer", onNoAnswer, setOnNoAnswer],
                  ["Failed to connect", onFailed, setOnFailed],
                  ["Short call (connected but ended quickly)", onShortDuration, setOnShortDuration],
                ].map(([text, value, set]) => (
                  <label key={text as string} className="flex items-center gap-2">
                    <input type="checkbox" checked={value as boolean} disabled={maxRetries === 0} onChange={(e) => (set as (v: boolean) => void)(e.target.checked)} />
                    Retry on {(text as string).toLowerCase()}
                  </label>
                ))}
              </div>
              {onShortDuration && maxRetries > 0 && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  A customer who quickly says “call me at 3” is a short call too — Sarvam will ring them back after the retry interval,
                  before the time they asked for. Use this only if dropped calls are common.
                </p>
              )}
              {onShortDuration && maxRetries > 0 && (
                <div className="max-w-[220px]">
                  <label htmlFor="c-short" className={label}>Short means under (seconds)</label>
                  <input id="c-short" type="number" min={1} max={600} className={cn(input, "mt-1.5")} value={shortDurationSeconds} onChange={(e) => setShortDurationSeconds(Number(e.target.value))} />
                </div>
              )}
            </fieldset>
          </div>
        )}

        {step === 5 && validation && (
          <div className="grid gap-5">
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["Campaign", name],
                ["Cohort", cohortName],
                ["Agent", `${config.data?.agent.name ?? "Configured agent"}${config.data?.agent.version ? ` · v${config.data.agent.version}` : ""}`],
                ["Calls from", config.data?.phoneNumbers.join(", ") ?? "—"],
                ["Leads to call", `${validation.counts.valid}${validation.counts.returningCustomers ? ` (${validation.counts.returningCustomers} returning, with memory)` : ""}`],
                ["Starts", `${new Date(start).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} (this browser’s time)`],
                ["Ends", new Date(end).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })],
                ["Timezone", tz],
                ["Calling hours", `${startTime}–${endTime}`],
                ["Days", DAYS.filter((day) => days.includes(day)).map((day) => day.slice(0, 3)).join(", ")],
                ["Retries", maxRetries === 0 ? "None — each lead is called once" : `Up to ${maxRetries}, every ${intervalMinutes} min, on ${[onBusy && "busy", onNoAnswer && "no answer", onFailed && "failed", onShortDuration && `calls under ${shortDurationSeconds}s`].filter(Boolean).join(", ")}`],
                ["Calling rate", `${attemptsPerSecond} per second`],
              ].map(([term, value]) => (
                <div key={term} className="flex justify-between gap-4 border-b py-2">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>

            {validation.counts.invalid > 0 && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <input type="checkbox" className="mt-0.5" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} />
                Launch without the {validation.counts.invalid} invalid row(s). They will not be called.
              </label>
            )}
            {config.data && !config.data.ready && <ErrorState message={config.data.problems.join(" ")} />}
            {launchProblems.length > 0 && (
              <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                <p className="font-medium">The campaign was not launched</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">{launchProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
              </div>
            )}

            {confirmLaunch ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/40 bg-primary/5 p-4">
                <p className="flex-1 text-sm">
                  This creates a real campaign at Sarvam. It will call <strong>{validation.counts.valid}</strong> people from{" "}
                  {new Date(start).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}. Continue?
                </p>
                <button onClick={() => setConfirmLaunch(false)} className="h-9 rounded-md border px-3.5 text-sm hover:bg-muted">Go back</button>
                <button onClick={launch} disabled={launching} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">
                  {launching && <Loader2 className="h-4 w-4 animate-spin" />}
                  {launching ? "Launching…" : "Yes, launch"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmLaunch(true)}
                disabled={!config.data?.ready || (validation.counts.invalid > 0 && !skipInvalid) || validation.counts.valid === 0}
                className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Megaphone className="h-4 w-4" />
                Launch campaign
              </button>
            )}
          </div>
        )}

        {stepProblems.length > 0 && step !== 5 && (
          <ul className="mt-5 space-y-1 text-sm text-amber-700 dark:text-amber-300">
            {stepProblems.map((problem) => <li key={problem}>• {problem}</li>)}
          </ul>
        )}
      </section>

      <div className="flex justify-between">
        <button onClick={() => (step === 0 ? onCancel() : setStep(step - 1))} className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm hover:bg-muted">
          <ArrowLeft className="h-4 w-4" />
          {step === 0 ? "Cancel" : "Back"}
        </button>
        {step < STEPS.length - 1 && (
          <button
            onClick={() => setStep(step + 1)}
            disabled={stepProblems.length > 0 || validating}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

const ROLE_TEXT: Record<string, { label: string; tone: "positive" | "neutral" | "warning" | "pending" }> = {
  phone: { label: "Phone number", tone: "positive" },
  sent: { label: "Sent", tone: "positive" },
  identifier: { label: "Kept", tone: "neutral" },
  output_not_sent: { label: "Not sent", tone: "warning" },
  undeclared_not_sent: { label: "Not sent", tone: "warning" },
};

function PreviewStep({ validation }: { validation: ValidationView }) {
  const counts = validation.counts;
  return (
    <div className="grid gap-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Valid leads", counts.valid, "text-emerald-600 dark:text-emerald-400"],
          ["Invalid", counts.invalid, counts.invalid ? "text-red-600 dark:text-red-400" : ""],
          ["Duplicates", counts.duplicates, counts.duplicates ? "text-amber-600 dark:text-amber-400" : ""],
          ["Warnings", counts.warnings, counts.warnings ? "text-amber-600 dark:text-amber-400" : ""],
          ["Returning customers", counts.returningCustomers, ""],
        ].map(([term, value, tone]) => (
          <div key={term as string} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{term}</dt>
            <dd className={cn("mt-2 text-[28px] font-serif leading-none tracking-[-0.01em] [font-variant-numeric:lining-nums_tabular-nums]", tone as string)}>{value}</dd>
          </div>
        ))}
      </dl>

      {validation.fileErrors.length > 0 && <ErrorState message={validation.fileErrors.join(" ")} />}

      <div>
        <h3 className="text-sm font-semibold">Columns</h3>
        <ul className="mt-2 divide-y rounded-md border text-sm">
          {validation.columns.map((column) => (
            <li key={column.name} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <code className="min-w-[160px] font-mono text-xs">{column.name}</code>
              <Tag tone={ROLE_TEXT[column.role]?.tone ?? "neutral"}>{ROLE_TEXT[column.role]?.label ?? column.role}</Tag>
              <span className="flex-1 text-xs text-muted-foreground">{column.note}</span>
            </li>
          ))}
        </ul>
      </div>

      {(validation.invalid.length > 0 || validation.duplicates.length > 0 || validation.warnings.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-3">
          {[
            ["Invalid rows", validation.invalid.map((issue) => `Row ${issue.row}: ${issue.message}`)],
            ["Duplicates (first kept)", validation.duplicates.map((dup) => `Row ${dup.row}: ${dup.phone} — same as row ${dup.firstRow}`)],
            ["Warnings", validation.warnings.map((issue) => `Row ${issue.row}: ${issue.message}`)],
          ].map(([title, lines]) =>
            (lines as string[]).length ? (
              <div key={title as string}>
                <h3 className="text-sm font-semibold">{title}</h3>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border p-3 text-xs text-muted-foreground">
                  {(lines as string[]).map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            ) : null
          )}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">First {validation.preview.length} valid leads</h3>
        <div className="mt-2 overflow-x-auto rounded-md border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Row</th><th className="px-3 py-2 font-medium">Phone</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Variables sent</th></tr>
            </thead>
            <tbody className="divide-y">
              {validation.preview.map((row) => (
                <tr key={row.row}>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.row}</td>
                  <td className="px-3 py-2 font-mono">{row.phone}</td>
                  <td className="px-3 py-2">{row.name || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{Object.keys(row.variables).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
