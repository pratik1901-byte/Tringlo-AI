// ============================================================
// Tringlo AI — Inbound calling service
// ============================================================
//
// Turning inbound on and off, keeping Tringlo's view of the Sarvam deployment
// honest, telling the deployment about known callers, and turning each
// finished inbound call into a call record on the right contact.
//
// Inbound is per workspace and OFF by default. Nothing here runs for a
// workspace that has not switched it on, and no deployment is ever created
// except by an explicit Enable: a Sarvam deployment answers calls the moment
// it exists.
// ============================================================

import { ownedByTenant } from "@/lib/auth/guard";
import { WEEKDAYS, type Weekday } from "@/lib/campaigns/types";
import { isPlaceholderName, normalisePhone } from "@/lib/customers/identity";
import {
  findInboundSettingsByDeployment,
  getAgentConfig,
  getAllInboundSettings,
  getCallRecord,
  getCallRecords,
  getCallingWindow,
  getInboundSettings,
  getLeads,
  getTenant,
  getWebhookBaseUrl,
  saveInboundSettings,
  saveLead,
  updateCallRecord,
} from "@/lib/db";
import { getContextForCall } from "@/lib/memory/service";
import {
  SarvamDeploymentError,
  createDeployment,
  getDeployment,
  listDeployments,
  listWebhookDeliveries,
  retryWebhookDeliveries,
  setDeploymentStatus,
  uploadDeploymentCohort,
  updateDeployment,
  type CohortUser,
  type DeploymentPayload,
  type DeploymentResponse,
} from "@/lib/providers/sarvam/deployments";
import { inboundCallRules } from "@/lib/providers/sarvam/call-rules";
import { buildSarvamAgentVariables, declaredVariableNames } from "@/lib/providers/sarvam/variables";
import { resolveMappings } from "@/lib/providers/variable-mapping";
import {
  callerAppointments,
  callerVariables,
  hospitalContext,
  hospitalContextVariables,
  intakeGuidance,
  isHospitalWorkspace,
} from "@/lib/hospital/context";
import { MAX_QUESTIONNAIRE_QUESTIONS } from "@/lib/hospital/records";
import { platformCredentials, platformProblems, resolveCallAgent, tryResolveInbound } from "@/lib/providers/config";
import type { CallAgent } from "@/lib/recordings";
import type { PlatformCredentials } from "@/lib/providers/types";
import { withWebhookToken } from "@/lib/security/webhook-auth";
import type { CallRecord, Lead } from "@/lib/types";

import { defaultInboundSettings, type DeploymentStatus, type InboundSettings } from "./types";

const WEBHOOK_PATH = "/api/webhooks/sarvam/inbound";

/** Tringlo's own Sarvam credentials, or a clear refusal when the server has none. */
function sarvamCredentials(): PlatformCredentials {
  const credentials = platformCredentials();
  if (!credentials) throw new SarvamDeploymentError(platformProblems()[0] ?? "Sarvam is not configured on this server.", 422, "missing_platform_credentials");
  return credentials;
}

/** Line facts the inbound agent can use, when its Sarvam app declares them. */
export const INBOUND_LINE_VARIABLES = [
  "call_direction",
  "caller_known",
  "business_hours",
  "human_handoff_number",
  "human_handoff_available",
  "after_hours_message",
] as const;

/**
 * The variables the inbound agent's Sarvam app declares. Sarvam refuses
 * variables an app has not declared, so nothing else is ever sent. Defaults to
 * the outbound agent's list when inbound uses the same agent.
 */
export function inboundDeclaredVariables(tenantId: string): Set<string> {
  const resolved = tryResolveInbound(tenantId);
  return declaredVariableNames(resolved.ok ? resolved.value.inbound.agentVariables : null);
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------

export function inboundSettingsFor(tenantId: string): InboundSettings {
  return getInboundSettings(tenantId) ?? defaultInboundSettings(tenantId, getCallingWindow(tenantId).timezone || "Asia/Kolkata");
}

/**
 * What this workspace needs before its inbound line can exist: Tringlo's own
 * Sarvam credentials, the workspace's inbound agent, and a public address for
 * Sarvam to report calls to.
 */
export function inboundServerConfig(tenantId: string) {
  const base = getWebhookBaseUrl();
  const webhookBase = base && /^https:\/\//i.test(base) ? base.replace(/\/+$/, "") : null;

  const problems: string[] = [...platformProblems()];
  const resolved = tryResolveInbound(tenantId);
  if (!resolved.ok) problems.push(...resolved.problems);
  if (!webhookBase) problems.push("No public HTTPS address is registered, so Sarvam could not report inbound calls.");

  const inbound = resolved.ok ? resolved.value.inbound : null;

  // Not blocking: the line works without these, the agent just is not told.
  const declared = inboundDeclaredVariables(tenantId);
  const undeclared = INBOUND_LINE_VARIABLES.filter((name) => !declared.has(name));
  const advisories = undeclared.length
    ? [`The inbound agent does not declare ${undeclared.join(", ")}, so Tringlo cannot pass those facts to it. Add them to the agent in Sarvam, then list them in Settings.`]
    : [];

  return {
    ready: problems.length === 0,
    problems,
    advisories,
    appId: inbound?.appId ?? "",
    appVersion: inbound?.appVersion ?? 0,
    connectionId: inbound?.connectionId ?? "",
    webhookBase,
    credentials: resolved.ok ? resolved.value.credentials : null,
    webhookToken: resolved.ok ? resolved.value.webhookToken : null,
  };
}

export interface InboundSettingsInput {
  phoneNumber: string;
  startTime: string;
  endTime: string;
  days: Weekday[];
  timezone: string;
  handoffNumber: string | null;
  afterHoursMessage: string | null;
  /**
   * The Sarvam deployment that answers this workspace's line.
   *
   * Tringlo normally manages this itself — it creates one on Enable, adopts an
   * existing one on the same number, and follows a replacement. This field is
   * the override, for when an administrator has made a deployment in Sarvam's
   * dashboard and wants Tringlo pointed at that one. Undefined means "leave it
   * as it is"; empty means "forget it and manage it again".
   */
  deploymentId?: string | null;
}

/** Normalises and checks what the workspace entered. Returns problems, or the clean values. */
export function validateInboundInput(tenantId: string, input: InboundSettingsInput): { problems: string[]; clean?: InboundSettingsInput } {
  const problems: string[] = [];
  const phone = normalisePhone(input.phoneNumber);
  if (!phone.valid || !phone.e164) problems.push("Enter the inbound number as an Indian number, e.g. +91 80 1234 5678.");

  let handoff: string | null = null;
  if (input.handoffNumber && input.handoffNumber.trim()) {
    const parsed = normalisePhone(input.handoffNumber);
    if (!parsed.valid || !parsed.e164) problems.push("The human handoff number is not a valid Indian number.");
    else handoff = parsed.e164;
    if (handoff && phone.e164 && handoff === phone.e164) problems.push("The handoff number cannot be the inbound number itself.");
  }

  if (!HHMM.test(input.startTime) || !HHMM.test(input.endTime)) problems.push("Business hours must be HH:MM.");
  else if (input.endTime <= input.startTime) problems.push("Business hours must end after they start.");
  if (!input.days.length || input.days.some((day) => !WEEKDAYS.includes(day))) problems.push("Choose at least one day.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timezone });
  } catch {
    problems.push("Choose a valid timezone.");
  }
  const afterHours = (input.afterHoursMessage ?? "").trim();
  if (afterHours.length > 300) problems.push("Keep the after-hours message under 300 characters.");

  // One number, one workspace: a call to it must never be ambiguous.
  if (phone.e164) {
    const taken = getAllInboundSettings().find(
      (settings) => settings.tenantId !== tenantId && settings.phoneNumber === phone.e164 && (settings.enabled || settings.deploymentId)
    );
    if (taken) problems.push("That inbound number is already used by another workspace.");
  }

  let deploymentId: string | null | undefined;
  if (input.deploymentId !== undefined) {
    const value = (input.deploymentId ?? "").trim();
    if (value && !/^[A-Za-z0-9._-]{4,120}$/.test(value)) {
      problems.push("A deployment ID looks like Tringlo-AI-1a2b3c4d-5e6f — letters, numbers, dots, hyphens and underscores only.");
    }
    const takenBy = value
      ? getAllInboundSettings().find((settings) => settings.tenantId !== tenantId && settings.deploymentId === value)
      : undefined;
    if (takenBy) problems.push("That deployment already answers for another workspace.");
    deploymentId = value || null;
  }

  if (problems.length) return { problems };
  return {
    problems,
    clean: {
      ...(deploymentId === undefined ? {} : { deploymentId }),
      phoneNumber: phone.e164!,
      startTime: input.startTime,
      endTime: input.endTime,
      days: WEEKDAYS.filter((day) => input.days.includes(day)),
      timezone: input.timezone,
      handoffNumber: handoff,
      afterHoursMessage: afterHours || null,
    },
  };
}

/** Saves settings without touching Sarvam (inbound stays as it is). */
export function saveInboundDraft(tenantId: string, input: InboundSettingsInput): { ok: boolean; problems: string[]; settings?: InboundSettings } {
  const { problems, clean } = validateInboundInput(tenantId, input);
  if (!clean) return { ok: false, problems };

  const current = inboundSettingsFor(tenantId);
  const changedDeployment = clean.deploymentId !== undefined && clean.deploymentId !== current.deploymentId;

  const settings = saveInboundSettings({
    ...current,
    ...clean,
    // A newly pointed-at deployment has not been checked yet, and its webhook
    // is not Tringlo's until the next pass registers it.
    ...(changedDeployment
      ? { deploymentStatus: clean.deploymentId ? ("creating" as const) : ("inactive" as const), webhookUrl: null, lastSyncedAt: null, lastError: null }
      : {}),
  });
  if (changedDeployment) {
    console.log(`INBOUND_DEPLOYMENT_SET_BY_ADMIN tenant=${tenantId} deployment=${clean.deploymentId ?? "none"}`);
  }
  return { ok: true, problems: [], settings };
}

// ------------------------------------------------------------
// Deployment lifecycle
// ------------------------------------------------------------

function toStatus(remote: DeploymentResponse | null | undefined): DeploymentStatus | null {
  if (remote?.status === "active") return "active";
  if (remote?.status === "paused") return "paused";
  return null;
}

function payloadFor(settings: InboundSettings, config: ReturnType<typeof inboundServerConfig>): DeploymentPayload {
  const tenantName = getTenant(settings.tenantId)?.name ?? "Tringlo workspace";
  return {
    name: `Tringlo inbound ${tenantName}`.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 50).trim() || "Tringlo inbound",
    description: "Inbound line managed by Tringlo AI",
    app_id: config.appId,
    app_version: config.appVersion,
    connection_configs: [{ connection_id: config.connectionId, phone_numbers: [settings.phoneNumber!] }],
    inbound_config: {
      start_time: settings.startTime,
      end_time: settings.endTime,
      allowed_days: settings.days,
      timezone: settings.timezone,
    },
    webhook_config: {
      url: withWebhookToken(`${config.webhookBase}${WEBHOOK_PATH}`, config.webhookToken),
      metadata: { tringlo_tenant_id: settings.tenantId },
    },
  };
}

export interface InboundActionResult {
  ok: boolean;
  settings: InboundSettings;
  problems: string[];
}

/**
 * Turns inbound on, or applies changed settings to a running line.
 *
 * Creates the Sarvam deployment the first time; afterwards updates the same
 * one. Sarvam only accepts updates while a deployment is paused, so a running
 * line is paused, updated and resumed — a gap of a second or two.
 */
export async function enableInbound(tenantId: string, input: InboundSettingsInput): Promise<InboundActionResult> {
  const { problems, clean } = validateInboundInput(tenantId, input);
  const current = inboundSettingsFor(tenantId);
  if (!clean) return { ok: false, settings: current, problems };

  const config = inboundServerConfig(tenantId);
  if (!config.ready) return { ok: false, settings: current, problems: config.problems };

  let settings = saveInboundSettings({ ...current, ...clean, enabled: true, deploymentStatus: "creating", lastError: null });
  const payload = payloadFor(settings, config);

  try {
    // A number can be served by one deployment only. If the workspace already
    // made one for this number in Sarvam's dashboard, Tringlo takes it over
    // (adds its webhook, applies these settings) rather than creating a rival.
    if (!settings.deploymentId) {
      const adopted = await findDeploymentForNumber(settings.phoneNumber!);
      if (adopted) {
        settings = saveInboundSettings({ ...settings, deploymentId: adopted.deployment_id });
        console.log(`INBOUND_DEPLOYMENT_LINKED tenant=${tenantId} deployment=${adopted.deployment_id}`);
      }
    }

    let remote: DeploymentResponse;
    if (settings.deploymentId) {
      const existing = await getDeployment(sarvamCredentials(), settings.deploymentId);
      if (existing.status === "active") await setDeploymentStatus(sarvamCredentials(), settings.deploymentId, "pause");
      // The name, description and agent version are the workspace's to choose
      // in Sarvam (a new agent version is published there) — Tringlo never
      // moves a running line to a different version.
      const { app_id: _appId, app_version: _appVersion, name: _name, description: _description, ...changes } = payload;
      void _appId;
      void _appVersion;
      void _name;
      void _description;
      await updateDeployment(sarvamCredentials(), settings.deploymentId, changes);
      remote = await setDeploymentStatus(sarvamCredentials(), settings.deploymentId, "resume");
    } else {
      remote = await createDeployment(sarvamCredentials(), payload);
    }
    // The status Sarvam reports — confirmed by reading it back if it said nothing.
    const status = toStatus(remote) ?? toStatus(await getDeployment(sarvamCredentials(), remote.deployment_id));
    settings = saveInboundSettings({
      ...settings,
      deploymentId: remote.deployment_id,
      deploymentStatus: status ?? "failed",
      lastError: status ? null : "Sarvam did not report the deployment's status.",
      webhookUrl: `${config.webhookBase}${WEBHOOK_PATH}`,
      lastSyncedAt: new Date().toISOString(),
    });
    console.log(`INBOUND_ENABLED tenant=${tenantId} deployment=${remote.deployment_id} status=${status ?? "unknown"}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sarvam rejected the deployment.";
    // Whatever state the line is really in, find out rather than guess.
    let status: DeploymentStatus = "failed";
    if (settings.deploymentId) {
      try {
        status = toStatus(await getDeployment(sarvamCredentials(), settings.deploymentId)) ?? "failed";
        // Paused for an update that then failed: put the line back as it was.
        if (status === "paused") status = toStatus(await setDeploymentStatus(sarvamCredentials(), settings.deploymentId, "resume")) ?? status;
      } catch {
        status = "failed";
      }
    }
    settings = saveInboundSettings({ ...settings, deploymentStatus: status, lastError: message });
    return { ok: false, settings, problems: [message] };
  }

  // Known callers are a bonus, not a precondition: unknown callers reach the
  // agent regardless. A failure here is recorded, not fatal.
  await syncKnownCallers(tenantId).catch(() => undefined);
  return { ok: true, settings: getInboundSettings(tenantId) ?? settings, problems: [] };
}

/** The deployment already serving this number in the Sarvam workspace, if any. */
async function findDeploymentForNumber(e164: string): Promise<DeploymentResponse | null> {
  const list = await listDeployments(sarvamCredentials(), );
  const wanted = normalisePhone(e164).national;
  const match = (list.items ?? []).find((deployment) => {
    const numbers = [
      ...(deployment.phone_numbers ?? []),
      ...(deployment.connection_configs ?? []).flatMap((config) => config.phone_numbers ?? []),
    ];
    return numbers.some((number) => normalisePhone(number).national === wanted);
  });
  if (!match) return null;
  // Another Tringlo workspace's line is never taken over.
  const owner = getAllInboundSettings().find((other) => other.deploymentId === match.deployment_id);
  return owner ? null : match;
}

/** "HH:MM:SS" from Sarvam → "HH:MM", Tringlo's form. */
function hhmm(value: string | undefined, fallback: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : fallback;
}

/** Turns inbound off: the deployment is paused at Sarvam, and Tringlo records what Sarvam reports. */
export async function disableInbound(tenantId: string): Promise<InboundActionResult> {
  let settings = saveInboundSettings({ ...inboundSettingsFor(tenantId), enabled: false });
  const deploymentId = settings.deploymentId;
  if (!deploymentId) {
    settings = saveInboundSettings({ ...settings, deploymentStatus: "inactive", lastError: null });
    return { ok: true, settings, problems: [] };
  }
  try {
    const remote = await setDeploymentStatus(sarvamCredentials(), deploymentId, "pause");
    settings = saveInboundSettings({
      ...settings,
      deploymentStatus: toStatus(remote) ?? "paused",
      lastError: null,
      lastSyncedAt: new Date().toISOString(),
    });
    console.log(`INBOUND_DISABLED tenant=${tenantId} deployment=${deploymentId}`);
    return { ok: true, settings, problems: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sarvam did not pause the deployment.";
    if (error instanceof SarvamDeploymentError && error.status === 404) {
      // The deployment no longer exists at Sarvam: nothing is answering.
      settings = saveInboundSettings({ ...settings, deploymentId: null, deploymentStatus: "inactive", lastError: null });
      return { ok: true, settings, problems: [] };
    }
    let status: DeploymentStatus = settings.deploymentStatus;
    try {
      status = toStatus(await getDeployment(sarvamCredentials(), deploymentId)) ?? status;
    } catch {
      // keep what we had
    }
    settings = saveInboundSettings({ ...settings, deploymentStatus: status, lastError: message });
    return { ok: false, settings, problems: [message] };
  }
}

/**
 * Takes over the deployment now serving the line's number, as it is — its
 * hours and agent version kept. It gets Tringlo's webhook and the known-caller
 * list on the next pass. Null when no deployment serves the number.
 */
async function adoptDeploymentOnNumber(settings: InboundSettings): Promise<InboundSettings | null> {
  if (!settings.phoneNumber) return null;
  const replacement = await findDeploymentForNumber(settings.phoneNumber).catch(() => null);
  if (!replacement) return null;
  const config = replacement.inbound_config;
  console.log(`INBOUND_DEPLOYMENT_REPLACED tenant=${settings.tenantId} from=${settings.deploymentId ?? "none"} to=${replacement.deployment_id}`);
  return saveInboundSettings({
    ...settings,
    deploymentId: replacement.deployment_id,
    deploymentStatus: toStatus(replacement) ?? "active",
    startTime: hhmm(config?.start_time, settings.startTime),
    endTime: hhmm(config?.end_time, settings.endTime),
    days: config?.allowed_days?.length ? config.allowed_days : settings.days,
    timezone: config?.timezone || settings.timezone,
    webhookUrl: null,
    lastError: null,
    lastSyncedAt: new Date().toISOString(),
    // Known callers belong to a deployment: send them to the new one.
    knownCallersCohortId: null,
    knownCallersCount: 0,
    knownCallersSyncedAt: null,
    knownCallersAttemptAt: null,
    knownCallersError: null,
  });
}

/** Refreshes the deployment status from Sarvam. Throttled; never throws. */
export async function syncInboundStatus(settings: InboundSettings, force = false): Promise<InboundSettings> {
  const last = settings.lastSyncedAt ? new Date(settings.lastSyncedAt).getTime() : 0;
  if (!force && Date.now() - last < 30_000) return settings;

  // Inbound is on but its deployment was deleted in Sarvam: keep looking for
  // the one that replaces it (it is often created a minute later).
  if (!settings.deploymentId) {
    if (!settings.enabled) return settings;
    return (await adoptDeploymentOnNumber(settings)) ?? saveInboundSettings({ ...settings, lastSyncedAt: new Date().toISOString() });
  }

  try {
    const remote = await getDeployment(sarvamCredentials(), settings.deploymentId);
    return saveInboundSettings({
      ...settings,
      deploymentStatus: toStatus(remote) ?? settings.deploymentStatus,
      lastSyncedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof SarvamDeploymentError && error.status === 404) {
      // Replaced in Sarvam's dashboard (e.g. to run a new agent version)?
      if (settings.enabled) {
        const adopted = await adoptDeploymentOnNumber(settings);
        if (adopted) return adopted;
      }
      // Nothing answers the number now. Inbound stays switched on, so the
      // next deployment made for this number is picked up automatically;
      // Disable in Settings stops that.
      return saveInboundSettings({
        ...settings,
        deploymentId: null,
        deploymentStatus: "inactive",
        lastError: settings.enabled
          ? "The deployment was deleted in Sarvam. Waiting for a new one on this number."
          : "The deployment no longer exists at Sarvam.",
        lastSyncedAt: new Date().toISOString(),
      });
    }
    return settings;
  }
}

/**
 * Keeps the deployment's webhook pointed at Tringlo's current public address.
 *
 * A dev tunnel that restarts changes address; results posted to the old one
 * are lost. When the registered address changes, the deployment is updated
 * (paused for the edit and resumed) and any deliveries that failed in the
 * meantime are re-sent by Sarvam to the new address.
 */
export async function ensureInboundWebhookCurrent(settings: InboundSettings): Promise<void> {
  if (!settings.enabled || !settings.deploymentId || settings.deploymentStatus !== "active") return;
  const config = inboundServerConfig(settings.tenantId);
  if (!config.webhookBase || !config.credentials) return;
  const wanted = `${config.webhookBase}${WEBHOOK_PATH}`;
  if (settings.webhookUrl === wanted) return;

  try {
    await setDeploymentStatus(sarvamCredentials(), settings.deploymentId, "pause");
    await updateDeployment(sarvamCredentials(), settings.deploymentId, {
      webhook_config: { url: withWebhookToken(wanted, config.webhookToken), metadata: { tringlo_tenant_id: settings.tenantId } },
    });
    const remote = await setDeploymentStatus(sarvamCredentials(), settings.deploymentId, "resume");
    saveInboundSettings({ ...settings, webhookUrl: wanted, deploymentStatus: toStatus(remote) ?? "active", lastError: null });
    console.log(`INBOUND_WEBHOOK_UPDATED tenant=${settings.tenantId}`);

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const failed = await listWebhookDeliveries(sarvamCredentials(), settings.deploymentId, "failed", since);
    const ids = (failed.items ?? []).map((item) => item.attempt_id).filter(Boolean);
    if (ids.length) {
      await retryWebhookDeliveries(sarvamCredentials(), settings.deploymentId, ids);
      console.log(`INBOUND_WEBHOOK_REDELIVERED tenant=${settings.tenantId} count=${ids.length}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the webhook address.";
    let status: DeploymentStatus = settings.deploymentStatus;
    try {
      const remote = await getDeployment(sarvamCredentials(), settings.deploymentId);
      status = toStatus(remote) ?? status;
      // Never leave the line paused because of our own maintenance.
      if (status === "paused" && settings.enabled) {
        status = toStatus(await setDeploymentStatus(sarvamCredentials(), settings.deploymentId, "resume")) ?? status;
      }
    } catch {
      // reported below
    }
    saveInboundSettings({ ...settings, deploymentStatus: status, lastError: message });
  }
}

// ------------------------------------------------------------
// Caller context (known callers + on-start hook)
// ------------------------------------------------------------

function findLeadByPhone(tenantId: string, phone: string): Lead | undefined {
  const national = normalisePhone(phone).national;
  if (!national) return undefined;
  return getLeads()
    .filter((lead) => ownedByTenant(lead, tenantId) && normalisePhone(lead.phone).national === national)
    .sort((a, b) => (isPlaceholderName(a.name) ? 1 : 0) - (isPlaceholderName(b.name) ? 1 : 0))[0];
}

function businessHoursText(settings: InboundSettings): string {
  const days = settings.days.map((day) => day.slice(0, 3)).join(", ");
  return `${days}, ${settings.startTime}–${settings.endTime} (${settings.timezone})`;
}

/**
 * The agent variables for one caller: the workspace's company context, the
 * inbound line's facts (hours, handoff), and — for a known caller — their
 * name and relevant memory. An unknown caller gets no personal details at all.
 */
export function variablesForCaller(
  settings: InboundSettings,
  callerPhone: string,
  options: { forHook?: boolean } = {}
): Record<string, string> {
  const lead = findLeadByPhone(settings.tenantId, callerPhone);
  const agentConfig = getAgentConfig(settings.tenantId);
  const known = Boolean(lead && !lead.suppressed);
  const memory = known ? getContextForCall(settings.tenantId, lead!, { isFollowUp: false }) : null;

  // Built for the agent that answers this line, not the one that dials out:
  // the two may be different agents declaring different variables, and an
  // inbound agent that declares none is sent none.
  const inboundAgent = tryResolveInbound(settings.tenantId);
  const inboundVariables = inboundAgent.ok ? inboundAgent.value.inbound.agentVariables : null;
  const inboundMappings = inboundAgent.ok ? inboundAgent.value.inbound.variableMappings : null;

  const { variables } = buildSarvamAgentVariables({
    lead: known ? lead! : { name: "", phone: callerPhone },
    agentConfig,
    declaredVariables: inboundVariables,
    normalizedPhone: normalisePhone(callerPhone).e164 ?? callerPhone,
    companyName: (agentConfig.companyName || "").trim(),
    productName: agentConfig.productName || agentConfig.productsServices,
    previousInteraction: memory?.previousInteraction ?? "",
    customVariables: {
      ...(memory && !memory.isEmpty
        ? {
            customer_id: memory.customerId ?? "",
            customer_memory_context: memory.customerMemoryContext,
            last_call_summary: memory.lastCallSummary ?? "",
          }
        : {}),
    },
  });

  const declared = declaredVariableNames(inboundVariables);
  const lineFacts: Record<string, string> = {
    call_direction: "inbound",
    caller_known: known ? "yes" : "no",
    business_hours: businessHoursText(settings),
    human_handoff_number: settings.handoffNumber ?? "",
    human_handoff_available: settings.handoffNumber ? "yes" : "no",
    after_hours_message: settings.afterHoursMessage ?? "",
  };
  // An inbound agent with its own mapping is authoritative, exactly as for a
  // dialled call: those names, from those sources, and nothing else.
  const mapped = (inboundMappings ?? []).length
    ? resolveMappings(inboundMappings, {
        lead: known ? { name: lead!.name, phone: callerPhone, company: lead!.company, notes: lead!.notes } : { phone: callerPhone },
        workspace: { company: agentConfig.companyName, product: agentConfig.productName, industry: agentConfig.industry },
        call: { previousInteraction: memory?.previousInteraction ?? "" },
      }).variables
    : null;

  const merged: Record<string, unknown> = { ...(mapped ?? variables) };
  // A pushed list must hold only declared variables (Sarvam rejects the rest).
  // The on-start hook's answer is mapped field by field in Sarvam, so it
  // carries everything, including a ready-to-say greeting.
  for (const [key, value] of Object.entries(lineFacts)) {
    if (options.forHook || declared.has(key)) merged[key] = value;
  }
  if (options.forHook) merged.inbound_greeting = greetingFor(settings.tenantId, known ? lead! : null);

  // A hospital workspace answers with what its directory says right now:
  // which doctors consult, when, the hospital's own hours and its FAQs. The
  // panel writes to the database and the next caller hears the change — no
  // prompt is edited, because none of this lives in the prompt.
  if (isHospitalWorkspace(settings.tenantId)) {
    const context = hospitalContext(settings.tenantId);
    for (const [name, value] of Object.entries(hospitalContextVariables(settings.tenantId, declared))) {
      merged[name] = value;
    }
    if (options.forHook) {
      // The hook's answer is mapped field by field in Sarvam, so it may carry
      // the whole picture even where the agent declares no variable for it.
      merged.hospital_name = context.hospitalName;
      merged.hospital_hours = context.openingHours;
      merged.hospital_specialties = context.specialties.join(", ");
      merged.hospital_doctors = context.doctors
        .map((doctor) => `${doctor.name} (${doctor.specialty}), ${doctor.days} ${doctor.hours}`)
        .join("; ");
      if (context.faqs.length) {
        merged.hospital_faqs = context.faqs
          .map((faq) => `Q: ${faq.question} A: ${faq.answer}`)
          .join("\n");
      }
      merged.hospital_intake_rules = intakeGuidance(settings.tenantId);
      merged.hospital_questionnaire_limit = String(MAX_QUESTIONNAIRE_QUESTIONS);
      if (context.staffContact) merged.hospital_staff_contact = context.staffContact;
      if (context.escalationProtocol) merged.hospital_escalation = context.escalationProtocol;

      // Only this caller's own bookings, found from the number that rang.
      const booked = callerAppointments(settings.tenantId, known ? lead!.id : null);
      if (booked.length) {
        merged.caller_appointments = booked
          .map((appointment) => `${appointment.date} ${appointment.time} with ${appointment.doctor} (${appointment.status})`)
          .join("; ");
      }
    }

    // At the start of a call the only identifier is the number that rang, and
    // a number is not identity — so every caller starts unverified, and the
    // agent is told what to ask for. Identity is settled mid-call through
    // /api/hospital/identity, which asks the hospital's own system. This is
    // not a shortcut around the lookup: a phone number could never have
    // produced a match, so "unverified" is the correct answer here.
    for (const [name, value] of Object.entries(
      callerVariables(
        settings.tenantId,
        options.forHook ? new Set(["patient_status", "patient_verification_needed"]) : declared,
        {
          status: "unverified",
          canonicalPatientId: null,
          hasHistory: false,
          needs: ["the patient's date of birth", "or the hospital patient number, if they have it"],
        },
        known ? lead!.id : null
      )
    )) {
      merged[name] = value;
    }
  }

  // The call's instructions travel on the goal variable the agent already
  // reads; for inbound they replace the outbound pitch rules entirely.
  if ("proposedNextStepDefault" in merged || declared.has("proposedNextStepDefault")) {
    merged.proposedNextStepDefault = inboundCallRules({
      callerName: known ? lead!.name.trim() : null,
      companyName: (agentConfig.companyName || "").trim(),
      businessHours: businessHoursText(settings),
      handoffAvailable: Boolean(settings.handoffNumber),
      afterHoursMessage: settings.afterHoursMessage,
    });
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === "string" ? value : String(value);
    if (text.trim()) out[key] = text;
  }
  // An unknown caller is never given a name.
  if (!known) delete out.customer_name;
  return out;
}

/**
 * The first thing the agent says to a registered caller — by name, as the
 * company. Replaces the agent's outbound opening for that caller only.
 */
export function greetingFor(tenantId: string, lead: Lead | null): string {
  const agentConfig = getAgentConfig(tenantId);
  const company = (agentConfig.companyName || "").trim();
  const agent = (agentConfig.agentName || "").trim();
  const intro = agent && company ? `this is ${agent} from ${company}` : company ? `welcome to ${company}` : "thanks for calling";
  if (!lead) return `Hello, ${intro}. How can I help you today?`;
  const first = lead.name.trim().split(/\s+/)[0];
  return `Hi ${first}, ${intro}. Good to hear from you — how can I help you today?`;
}

/** The workspace an on-start lookup belongs to: by deployment, then by the number dialled. */
export function inboundSettingsForCall(deploymentId: string | null, dialledNumber: string | null): InboundSettings | undefined {
  if (deploymentId) {
    const byDeployment = findInboundSettingsByDeployment(deploymentId);
    if (byDeployment) return byDeployment;
  }
  if (dialledNumber) {
    const e164 = normalisePhone(dialledNumber).e164;
    return getAllInboundSettings().find((settings) => settings.enabled && settings.phoneNumber === e164);
  }
  return undefined;
}

/**
 * Pushes the workspace's known contacts to the deployment, so a known caller
 * is greeted with their context. Not a dial list: the deployment never calls
 * these numbers.
 */
export async function syncKnownCallers(tenantId: string): Promise<{ count: number }> {
  const settings = getInboundSettings(tenantId);
  if (!settings?.deploymentId || !settings.enabled) return { count: 0 };
  const seen = new Set<string>();
  const users: CohortUser[] = [];
  for (const lead of getLeads()) {
    if (!ownedByTenant(lead, tenantId) || lead.suppressed || isPlaceholderName(lead.name)) continue;
    const e164 = normalisePhone(lead.phone).e164;
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    // Only variables the agent declares: Sarvam rejects the rest.
    const declared = inboundDeclaredVariables(tenantId);
    const variables = Object.fromEntries(
      Object.entries(variablesForCaller(settings, e164)).filter(([key]) => declared.has(key))
    );
    users.push({
      user_phone_number: e164,
      app_variables: variables,
      app_overrides: { initial_bot_message: greetingFor(settings.tenantId, lead) },
    });
  }
  if (users.length === 0) {
    saveInboundSettings({ ...settings, knownCallersCount: 0, knownCallersSyncedAt: new Date().toISOString() });
    return { count: 0 };
  }
  let cohortId: string | null = null;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const attemptAt = new Date().toISOString();
  try {
    const response = await uploadDeploymentCohort(sarvamCredentials(), settings.deploymentId, `known-callers-${stamp}`, users);
    cohortId = response.cohort_id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sarvam did not accept the contacts.";
    saveInboundSettings({ ...(getInboundSettings(tenantId) ?? settings), knownCallersAttemptAt: attemptAt, knownCallersError: message });
    console.error(`INBOUND_KNOWN_CALLERS_FAILED tenant=${tenantId} reason=${message}`);
    throw error;
  }
  saveInboundSettings({
    ...(getInboundSettings(tenantId) ?? settings),
    knownCallersAttemptAt: attemptAt,
    knownCallersError: null,
    knownCallersStale: false,
    knownCallersCohortId: cohortId,
    knownCallersCount: users.length,
    knownCallersSyncedAt: new Date().toISOString(),
  });
  console.log(`INBOUND_KNOWN_CALLERS_SYNCED tenant=${tenantId} count=${users.length}`);
  return { count: users.length };
}

// ------------------------------------------------------------
// Webhook support: the call record for an inbound call
// ------------------------------------------------------------

/**
 * The record for an inbound call Tringlo has not seen before.
 *
 * The workspace comes from the deployment that answered (never from the
 * payload's own claims). The caller is matched to an existing contact by
 * normalised number; an unknown number becomes a new contact named
 * "Unknown caller" — no personal detail is invented.
 */
export function recordForInboundCall(payload: {
  interaction_id?: string | null;
  deployment_id?: string;
  user_phone_number?: string;
  agent_phone_number?: string;
  start_datetime?: string | null;
}): CallRecord | null {
  if (!payload.deployment_id || !payload.interaction_id) return null;
  const settings = findInboundSettingsByDeployment(payload.deployment_id);
  if (!settings) return null;
  const caller = normalisePhone(payload.user_phone_number);
  const callerPhone = caller.e164 ?? (payload.user_phone_number ?? "").trim();
  if (!callerPhone) return null;

  const now = new Date().toISOString();
  let lead = findLeadByPhone(settings.tenantId, callerPhone);
  if (!lead) {
    lead = saveLead({
      id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: settings.tenantId,
      name: "Unknown caller",
      phone: callerPhone,
      source: "inbound",
      callingDate: now.slice(0, 10),
      callingTime: "",
      timezone: settings.timezone,
      createdAt: now,
      status: "queued",
      suppressed: false,
    } as Lead);
    console.log(`INBOUND_NEW_CONTACT tenant=${settings.tenantId} lead=${lead.id}`);
  }

  return {
    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: settings.tenantId,
    leadId: lead.id,
    lead,
    status: "calling",
    startedAt: null,
    endedAt: null,
    requestedAt: payload.start_datetime ?? now,
    connectedAt: null,
    duration: null,
    attempts: 1,
    transcript: null,
    transcriptTurns: null,
    aiSummary: null,
    aiResult: null,
    lastContactedAt: null,
    nextAction: null,
    humanHandoffStatus: "none",
    provider: "sarvam",
    direction: "inbound",
    providerAttemptId: payload.interaction_id,
    providerInteractionId: payload.interaction_id,
    providerDeploymentId: payload.deployment_id,
    inboundNumber: normalisePhone(payload.agent_phone_number).e164 ?? payload.agent_phone_number ?? null,
  } as CallRecord;
}

// ------------------------------------------------------------
// Human handoff: confirmed from Sarvam's own record
// ------------------------------------------------------------

/**
 * Whether the call was actually transferred, from Sarvam's analytics record
 * of the interaction (`ended_by` is CALL_TRANSFER when it was). The webhook
 * alone cannot say; the agent saying "I'll transfer you" proves nothing.
 * Checked a few times, because analytics lag the webhook.
 */
export function verifyTransferLater(callId: string, delaysMs = [30_000, 120_000, 600_000]) {
  const [delay, ...rest] = delaysMs;
  if (delay === undefined) return;
  const timer = setTimeout(async () => {
    const record = getCallRecord(callId);
    if (!record?.providerInteractionId || record.direction !== "inbound") return;
    const agent = resolveCallAgent(record);
    if (!agent) return;
    const endedBy = await fetchEndedBy(agent, record.providerInteractionId);
    if (endedBy === null) {
      if (rest.length) verifyTransferLater(callId, rest);
      else if (record.humanHandoffStatus === "requested") updateCallRecord(callId, { humanHandoffStatus: "transfer_failed" });
      return;
    }
    const settings = record.tenantId ? getInboundSettings(record.tenantId) : undefined;
    if (/TRANSFER/i.test(endedBy)) {
      updateCallRecord(callId, {
        humanHandoffStatus: "transferred",
        transferredTo: settings?.handoffNumber ?? null,
        resolutionStatus: "escalated",
      });
      console.log(`INBOUND_TRANSFER_CONFIRMED call=${callId}`);
    } else if (record.humanHandoffStatus === "requested") {
      updateCallRecord(callId, { humanHandoffStatus: "transfer_failed" });
      console.log(`INBOUND_TRANSFER_NOT_COMPLETED call=${callId} ended_by=${endedBy}`);
    }
  }, delay);
  timer.unref?.();
}

async function fetchEndedBy(agent: CallAgent, interactionId: string): Promise<string | null> {
  const { apiKey, orgId: org, workspaceId: workspace } = agent.credentials;
  const app = agent.appId;
  if (!apiKey || !org || !workspace || !app) return null;
  const from = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const filter = JSON.stringify([{ id: "1", field: "interaction_id", operator: "equals", value: interactionId }]);
  try {
    const response = await fetch(
      `https://apps.sarvam.ai/api/analytics/v1/${encodeURIComponent(org)}/${encodeURIComponent(workspace)}/${encodeURIComponent(app)}/interactions` +
        `?start_datetime=${encodeURIComponent(from)}&end_datetime=${encodeURIComponent(to)}&limit=5&filter_conditions=${encodeURIComponent(filter)}`,
      { headers: { "X-API-Key": apiKey }, signal: AbortSignal.timeout(15_000), cache: "no-store" }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: Array<{ interaction_id?: string; ended_by?: string | null }> };
    const item = (body.items ?? []).find((entry) => entry.interaction_id === interactionId);
    const endedBy = item?.ended_by;
    return endedBy && !/^NO_[A-Z_]+$/.test(endedBy) ? endedBy : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Background maintenance, from the scheduler tick
// ------------------------------------------------------------

let maintaining = false;

export async function maintainInbound(now = Date.now()): Promise<void> {
  if (maintaining) return;
  maintaining = true;
  try {
    for (const original of getAllInboundSettings()) {
      if (!original.enabled) continue;
      const settings = await syncInboundStatus(original);
      if (!settings.deploymentId) continue; // still waiting for a deployment on the number
      await ensureInboundWebhookCurrent(settings);
      const lastAttempt = settings.knownCallersAttemptAt ?? settings.knownCallersSyncedAt;
      const lastSync = lastAttempt ? new Date(lastAttempt).getTime() : 0;
      // Memory changes with every call: re-send once a call has finished and
      // its memory has had a moment to be written (and at least daily).
      const latestCallEnd = getCallRecords()
        .filter((record) => ownedByTenant(record, settings.tenantId) && record.endedAt)
        .reduce((latest, record) => Math.max(latest, new Date(record.endedAt!).getTime()), 0);
      const memoryChanged =
        (latestCallEnd > lastSync && now - latestCallEnd > 90_000 && now - lastSync > 120_000) ||
        (settings.knownCallersStale === true && now - lastSync > 30_000);
      if (settings.deploymentStatus === "active" && (memoryChanged || now - lastSync > 24 * 60 * 60 * 1000)) {
        await syncKnownCallers(settings.tenantId).catch(() => undefined); // recorded on the settings
      }
    }
  } finally {
    maintaining = false;
  }
}
