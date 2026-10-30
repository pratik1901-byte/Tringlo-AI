"use client";

// ============================================================
// Settings & Hospital Server Integration
// ============================================================
//
// The hospital's own facts, its confirmation-call policy, its escalation
// procedure, and how Tringlo reaches the hospital's system.
//
// Two things on this page are deliberately blunt about not working:
//
//   - Confirmation calling is off until somebody turns it on here. That switch
//     stands between a schedule and real phones ringing, so it says plainly
//     what turning it on means.
//   - The integration says "demonstration" when it is one. There is no state
//     in which this page implies a hospital server is connected when none is,
//     and the credential field is write-only — it is never read back out.
// ============================================================

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Server } from "lucide-react";

import { api, formatWhen, useApi } from "@/lib/hospital/panel-api";
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

interface Capability {
  capability: string;
  label: string;
  available: boolean;
  reason: string | null;
}

interface IntegrationStatus {
  mode: "demo" | "live";
  label: string;
  configured: boolean;
  baseUrl: string | null;
  hasCredential: boolean;
  reportDestination: "hospital_server" | "panel_review";
  timeoutMs: number;
  capabilities: Capability[];
  lastCheck: { at: string; ok: boolean; detail: string } | null;
  outstanding: string[];
}

interface Settings {
  profile: {
    name: string;
    timezone: string;
    remindersEnabled: boolean;
    reminderLeadHours: number;
    reminderMaxAttempts: number;
    escalationProtocol: string | null;
    staffContact: string | null;
    address: string | null;
    helpline: string | null;
  };
  integration: IntegrationStatus;
  audit: Array<{ id: string; at: string; actor: string; action: string; subject: string; detail: string | null }>;
  agentRules: string;
}

interface IntegrationPayload {
  status: IntegrationStatus;
  config: {
    mode: "demo" | "live";
    baseUrl: string | null;
    capabilities: string[];
    endpoints: Record<string, string>;
    timeoutMs: number;
    reportDestination: "hospital_server" | "panel_review";
  };
  allCapabilities: string[];
  required: string[];
}

export default function SettingsPage() {
  const { data, error, loading, reload } = useApi<Settings>("hospital/settings");
  const { data: integration, reload: reloadIntegration } = useApi<IntegrationPayload>("hospital/integration");
  // Keyed on what the server last said, so the forms below start from it and
  // are replaced wholesale when it changes — rather than an effect reaching in
  // to overwrite whatever somebody was halfway through typing.
  const version = data
    ? [
        data.profile.name,
        data.profile.timezone,
        data.profile.address,
        data.profile.helpline,
        data.profile.escalationProtocol,
        data.profile.staffContact,
        data.profile.reminderLeadHours,
        data.profile.reminderMaxAttempts,
      ].join("|")
    : "loading";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const save = async (changes: Record<string, unknown>) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await api("hospital/settings", { method: "PUT", body: JSON.stringify(changes) });
      await reload();
      setNotice("Saved.");
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    if (
      !confirm(
        "Load the demonstration hospital? It gives the demonstration hospital server a provider directory, a patient directory and some appointments, all marked as demo. Nothing already here is changed."
      )
    ) {
      return;
    }
    setSeeding(true);
    try {
      const report = await api<{ seeded: { doctors: number; appointments: number; faqs: number; hisPatients: number } }>(
        "hospital/settings",
        { method: "POST", body: JSON.stringify({ action: "seed" }) }
      );
      const { doctors, appointments, faqs, hisPatients } = report.seeded;
      setNotice(
        doctors || appointments || faqs || hisPatients
          ? `Added ${doctors} doctors, ${hisPatients} hospital patient records, ${appointments} appointments and ${faqs} FAQs.`
          : "The demonstration data is already loaded — nothing was added."
      );
      await reload();
      await reloadIntegration();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "The demonstration data could not be loaded.");
    } finally {
      setSeeding(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hospital"
        title="Settings & Hospital Server Integration"
        description="How this hospital runs, what it allows the agent to do, and how Tringlo reaches the hospital's own system."
      />

      {error && <Problem message={error} onRetry={reload} />}
      {problem && <Problem message={problem} />}
      {notice && <p className="rounded-xl border border-sage/30 bg-sage-soft px-4 py-3 text-[13px] text-sage-ink">{notice}</p>}

      {integration && (
        <HospitalServer
          key={`integration:${integration.config.mode}:${integration.config.baseUrl ?? ""}:${integration.config.capabilities.join(",")}`}
          payload={integration}
          onChanged={async () => {
            await reloadIntegration();
            await reload();
          }}
        />
      )}

      {data && <HospitalFacts key={`facts:${version}`} profile={data.profile} busy={busy} onSave={save} />}

      {data && <Escalation key={`escalation:${version}`} profile={data.profile} busy={busy} onSave={save} />}

      <Card>
        <CardHead
          title="Confirmation calls"
          note="Placed by the server, whether or not this panel is open"
          actions={
            <Status
              label={data?.profile.remindersEnabled ? "On" : "Off"}
              tone={data?.profile.remindersEnabled ? "good" : "neutral"}
            />
          }
        />
        <div className="space-y-4 p-5">
          {!data?.profile.remindersEnabled && (
            <NotConfigured
              what="No confirmation call is being placed"
              how="Calls are still scheduled and shown, so you can see what would happen. Turning this on lets the server ring patients to confirm their appointments."
            />
          )}

          {data && <CallPolicy key={`policy:${version}`} profile={data.profile} busy={busy} onSave={save} />}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={data?.profile.remindersEnabled ? "danger" : "plain"}
              disabled={busy}
              onClick={() => {
                const turningOn = !data?.profile.remindersEnabled;
                if (
                  turningOn &&
                  !confirm(
                    "Turn confirmation calling on? The server will ring patients about their appointments. Demonstration appointments are never called, and anyone who has opted out is never called."
                  )
                ) {
                  return;
                }
                void save({ remindersEnabled: turningOn });
              }}
            >
              {data?.profile.remindersEnabled ? "Turn confirmation calling off" : "Turn confirmation calling on"}
            </Button>
          </div>

          <ul className="space-y-1 text-[12.5px] leading-relaxed text-ink-muted">
            <li>· A demonstration appointment is never dialled, whatever this is set to.</li>
            <li>· A patient who has opted out is never dialled.</li>
            <li>· A patient already asked about one appointment is not rung about it again.</li>
            <li>· An appointment with an open cancellation request is not rung about.</li>
            <li>· The appointment is marked confirmed only if the patient says so.</li>
          </ul>
        </div>
      </Card>

      <Card>
        <CardHead title="What the agent is told" note="Assembled at the start of each call, not written into a prompt" />
        <p className="whitespace-pre-line px-5 py-4 text-[12.5px] leading-relaxed text-ink-soft">{data?.agentRules}</p>
      </Card>

      <Card>
        <CardHead title="Demonstration data" note="Fictional records, clearly marked" />
        <div className="space-y-3 p-5">
          <p className="text-[13px] leading-relaxed text-ink-soft">
            Gives the demonstration hospital server twenty fictional doctors with schedules, a patient directory with
            dates of birth so identity can be verified the way a hospital verifies it, some appointments and a few FAQs
            — every one marked as demonstration data. It adds nothing twice, changes nothing you have entered, and its
            appointments never trigger a real call.
          </p>
          <Button onClick={seed} disabled={seeding}>
            {seeding ? "Loading…" : "Load demonstration data"}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHead title="Recent activity" note="Appointments, histories, cancellations, FAQs and settings" />
        {!data?.audit.length ? (
          <p className="px-5 py-6 text-center text-sm text-ink-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y text-[13px]">
            {data.audit.slice(0, 25).map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-4 px-5 py-2.5">
                <span className="min-w-0">
                  <span className="block text-ink">{entry.action.replace(/[._]/g, " ")}</span>
                  {entry.detail && <span className="block text-[11.5px] text-ink-muted">{entry.detail}</span>}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-muted">{formatWhen(entry.at, data.profile.timezone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------
// The integration
// ------------------------------------------------------------

/**
 * How Tringlo reaches the hospital's own system.
 *
 * Every operation is listed with whether it is actually available and, when it
 * is not, why — not recorded as supported, no path entered, nothing
 * configured. That list is the honest answer to "is this integrated yet",
 * which is a question that otherwise gets answered by a green dot.
 */
function HospitalServer({
  payload,
  onChanged,
}: {
  payload: IntegrationPayload;
  onChanged: () => Promise<void> | void;
}) {
  // Initialised from what the server last said. The component is keyed on
  // that in the parent, so a saved change replaces it wholesale rather than an
  // effect reaching in to overwrite half-typed input.
  const [form, setForm] = useState(() => ({
    mode: payload.config.mode as string,
    baseUrl: payload.config.baseUrl ?? "",
    token: "",
    timeoutMs: payload.config.timeoutMs,
    reportDestination: payload.config.reportDestination as string,
  }));
  const [capabilities, setCapabilities] = useState<string[]>(() => payload.config.capabilities);
  const [endpoints, setEndpoints] = useState<Record<string, string>>(() => payload.config.endpoints);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; detail: string; count?: number } | null>(null);

  const status = payload.status;

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api("hospital/integration", {
        method: "PUT",
        body: JSON.stringify({
          mode: form.mode,
          baseUrl: form.baseUrl,
          // Omitted when blank, so saving the form does not wipe a stored
          // credential that this page was never shown.
          ...(form.token.trim() ? { token: form.token.trim() } : {}),
          capabilities,
          endpoints,
          timeoutMs: form.timeoutMs,
          reportDestination: form.reportDestination,
        }),
      });
      setForm({ ...form, token: "" });
      await onChanged();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setProblem(null);
    setCheck(null);
    try {
      const result = await api<{ ok: boolean; detail: string; directory: { ok: boolean; count?: number; problem?: string } }>(
        "hospital/integration",
        { method: "POST" }
      );
      setCheck({ ok: result.ok, detail: result.detail, count: result.directory.count });
      await onChanged();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "The check did not run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHead
        title="Hospital server"
        note="Tringlo is a voice layer in front of the hospital's own system. Patient identity, appointments and records belong to it."
        actions={
          status.mode === "demo" ? (
            <Status label="Demonstration" tone="warn" />
          ) : status.configured ? (
            <Status label="Configured" tone="good" />
          ) : (
            <Status label="Not configured" tone="bad" />
          )
        }
      />
      <div className="space-y-5 p-5">
        {problem && <Problem message={problem} />}

        {status.mode === "demo" ? (
          <NotConfigured
            what="No hospital server is connected"
            how="Everything runs against a demonstration stand-in with its own fictional records, marked as demonstration data throughout. Nothing leaves this installation. Switch to a hospital server below once you have its API details."
          />
        ) : status.outstanding.length > 0 ? (
          <div className="rounded-xl border border-alert/30 bg-alert-soft px-5 py-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-ink">
              <AlertTriangle className="h-4 w-4 shrink-0 text-alert" />
              The hospital server is not usable yet
            </p>
            <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-ink-soft">
              {status.outstanding.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
              Until it is, patient lookups return no result rather than a guess, and nothing is reported as submitted.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-xl border border-sage/30 bg-sage-soft px-5 py-4 text-[13px] text-sage-ink">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Configured against {status.baseUrl}.
          </p>
        )}

        {check && (
          <p
            className={`rounded-xl border px-4 py-3 text-[13px] ${
              check.ok ? "border-sage/30 bg-sage-soft text-sage-ink" : "border-alert/30 bg-alert-soft text-ink"
            }`}
          >
            {check.detail}
            {typeof check.count === "number" && ` ${check.count} doctors read from the directory.`}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source of record" hint="Demonstration connects to nothing at all.">
            <select className={inputClass} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="demo">Demonstration stand-in</option>
              <option value="live">Hospital server</option>
            </select>
          </Field>
          <Field label="Where history reports go" hint="Submitted only when the destination confirms receipt.">
            <select
              className={inputClass}
              value={form.reportDestination}
              onChange={(e) => setForm({ ...form, reportDestination: e.target.value })}
            >
              <option value="panel_review">Review here in the panel</option>
              <option value="hospital_server">Submit to the hospital server</option>
            </select>
          </Field>
          <Field label="Base URL" hint="From the hospital's API documentation. Must be HTTPS.">
            <input
              className={inputClass}
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://…"
            />
          </Field>
          <Field
            label="Credential"
            hint={
              status.hasCredential
                ? "A credential is stored. Leave blank to keep it; it is never shown."
                : "Stays on the server and is never sent to this page."
            }
          >
            <input
              type="password"
              className={inputClass}
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              placeholder={status.hasCredential ? "••••••••" : "Paste the token"}
              autoComplete="off"
            />
          </Field>
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-medium text-ink">What the hospital&rsquo;s API supports</p>
          <p className="mb-3 text-[12px] leading-relaxed text-ink-muted">
            Tick an operation only if the hospital&rsquo;s documentation describes it, and give its path. Nothing is guessed:
            an operation with no path is reported unavailable rather than attempted.
          </p>
          <ul className="space-y-2">
            {status.capabilities.map((capability) => {
              const ticked = capabilities.includes(capability.capability);
              return (
                <li key={capability.capability} className="rounded-lg border px-3.5 py-2.5">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={ticked}
                      disabled={form.mode === "demo"}
                      onChange={(event) =>
                        setCapabilities(
                          event.target.checked
                            ? [...capabilities, capability.capability]
                            : capabilities.filter((entry) => entry !== capability.capability)
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] text-ink">{capability.label}</span>
                        {capability.available ? (
                          <Status label="Available" tone="good" />
                        ) : (
                          <Status label="Unavailable" tone="neutral" />
                        )}
                      </span>
                      {!capability.available && capability.reason && (
                        <span className="mt-0.5 block text-[11.5px] text-ink-muted">{capability.reason}</span>
                      )}
                    </span>
                  </label>
                  {ticked && form.mode === "live" && (
                    <input
                      className={`${inputClass} mt-2`}
                      value={endpoints[capability.capability] ?? ""}
                      onChange={(event) =>
                        setEndpoints({ ...endpoints, [capability.capability]: event.target.value })
                      }
                      placeholder="Path from the hospital's documentation, e.g. v1/patients/match"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={save} disabled={busy}>
            Save integration
          </Button>
          <Button onClick={test} disabled={busy}>
            Test the connection
          </Button>
          {status.lastCheck && (
            <span className="text-[12px] text-ink-muted">
              Last checked {formatWhen(status.lastCheck.at)} — {status.lastCheck.ok ? "answered" : "did not answer"}
            </span>
          )}
        </div>

        <div className="border-t pt-4">
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <Server className="h-3.5 w-3.5 shrink-0" />
            To finish the integration, the hospital needs to provide
          </p>
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-muted">
            {payload.required.map((item) => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// The forms
// ------------------------------------------------------------
//
// Each one starts from what the server last said and is keyed on it in the
// parent, so a save replaces the whole form rather than an effect writing over
// whatever somebody is halfway through typing.

interface ProfileFields {
  name: string;
  timezone: string;
  address: string | null;
  helpline: string | null;
  escalationProtocol: string | null;
  staffContact: string | null;
  reminderLeadHours: number;
  reminderMaxAttempts: number;
}

type SaveFn = (changes: Record<string, unknown>) => Promise<void>;

function HospitalFacts({ profile, busy, onSave }: { profile: ProfileFields; busy: boolean; onSave: SaveFn }) {
  const [form, setForm] = useState(() => ({
    name: profile.name,
    timezone: profile.timezone,
    address: profile.address ?? "",
    helpline: profile.helpline ?? "",
  }));

  return (
    <Card>
      <CardHead title="The hospital" note="Only what somebody has entered. Nothing here is filled in with a guess." />
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <Field label="Name" hint="What the agent calls this hospital on a call.">
          <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Timezone" hint="All appointment times are shown and reasoned about in this zone.">
          <input className={inputClass} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
        </Field>
        <Field label="Address" hint="Left blank, the agent says it will have it confirmed rather than guessing.">
          <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Helpline" hint="The number the agent may give out.">
          <input className={inputClass} value={form.helpline} onChange={(e) => setForm({ ...form, helpline: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Button variant="primary" onClick={() => onSave(form)} disabled={busy}>
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Escalation({ profile, busy, onSave }: { profile: ProfileFields; busy: boolean; onSave: SaveFn }) {
  const [form, setForm] = useState(() => ({
    escalationProtocol: profile.escalationProtocol ?? "",
    staffContact: profile.staffContact ?? "",
  }));

  return (
    <Card>
      <CardHead
        title="Escalation and handoff"
        note="What the agent does when a call is beyond it"
        actions={
          profile.escalationProtocol ? <Status label="Configured" tone="good" /> : <Status label="Not configured" tone="warn" />
        }
      />
      <div className="space-y-4 p-5">
        {!profile.escalationProtocol && (
          <NotConfigured
            what="No escalation procedure has been entered"
            how="Until the hospital writes one, the agent is told to stop and direct the caller to a qualified member of staff. Tringlo does not supply a clinical escalation procedure of its own — it is a safety document, and it has to be yours."
          />
        )}
        <Field
          label="Escalation procedure"
          hint="In the hospital's own words. Given to the agent verbatim, and recorded on any conversation it stops."
        >
          <textarea
            className="min-h-[110px] w-full rounded-lg border px-3 py-2 text-sm text-ink outline-none focus-visible:border-sage"
            value={form.escalationProtocol}
            onChange={(e) => setForm({ ...form, escalationProtocol: e.target.value })}
            placeholder="If a caller describes…, the agent should…"
          />
        </Field>
        <Field label="Reception contact for handoff" hint="Offered when the agent has no approved answer.">
          <input
            className={inputClass}
            value={form.staffContact}
            onChange={(e) => setForm({ ...form, staffContact: e.target.value })}
            placeholder="Reception, or a number"
          />
        </Field>
        <Button variant="primary" disabled={busy} onClick={() => onSave(form)}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function CallPolicy({ profile, busy, onSave }: { profile: ProfileFields; busy: boolean; onSave: SaveFn }) {
  const [form, setForm] = useState(() => ({
    reminderLeadHours: profile.reminderLeadHours,
    reminderMaxAttempts: profile.reminderMaxAttempts,
  }));

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Call this many hours before" hint="24 means a call the day before.">
          <input
            type="number"
            min={1}
            max={168}
            className={inputClass}
            value={form.reminderLeadHours}
            onChange={(e) => setForm({ ...form, reminderLeadHours: Number(e.target.value) })}
          />
        </Field>
        <Field label="Attempts at most" hint="A failed call stops after this many tries.">
          <input
            type="number"
            min={1}
            max={5}
            className={inputClass}
            value={form.reminderMaxAttempts}
            onChange={(e) => setForm({ ...form, reminderMaxAttempts: Number(e.target.value) })}
          />
        </Field>
      </div>
      <Button variant="primary" disabled={busy} onClick={() => onSave(form)}>
        Save policy
      </Button>
    </>
  );
}
