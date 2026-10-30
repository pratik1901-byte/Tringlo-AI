// ============================================================
// Tringlo AI — One-time data migrations
// ============================================================
//
// Run at server start, before anything serves a request. Each migration is
// guarded so running it twice changes nothing.
//
// The migration that matters here moves the original single-workspace
// configuration — the company profile, the calling window, and the Sarvam
// resource ids from the environment — into the one workspace that has been
// using them. After it runs, a workspace's configuration lives entirely in the
// database, and the environment holds only Tringlo's own Sarvam credentials.
//
// A workspace created later inherits NONE of this. It starts unconfigured and
// says so.
// ============================================================

import {
  getAgentConfigSingleton,
  getCallRecords,
  getAllProviderConfigs,
  getCallingWindowSingleton,
  getLegacyTenantId,
  getProviderConfig,
  getTenants,
  getWorkspaceProfile,
  saveProviderConfig,
  saveWorkspaceProfile,
  stampWebhookLogTenants,
  migrateMemberships,
  getTenant,
  getHospitalProfile,
  saveHospitalProfile,
} from "@/lib/db";
import { defaultHospitalProfile } from "@/lib/hospital/types";
import { SALES_AGENT_VARIABLES } from "@/lib/providers/sarvam/variables";
import { newWebhookToken, readEnv } from "@/lib/providers/config";
import type { OutboundProviderConfig, BatchProviderConfig, InboundProviderConfig, WorkspaceProviderConfig } from "@/lib/providers/types";
import fs from "fs";
import path from "path";

/** The workspace the original single-tenant data belongs to. */
function originalTenantId(): string | null {
  const legacy = getLegacyTenantId();
  if (legacy) return legacy;
  // A database that predates `legacyTenantId` but has exactly one workspace.
  const tenants = getTenants();
  return tenants.length === 1 ? tenants[0].id : null;
}

/** Moves the company profile and calling hours onto the original workspace. */
function migrateWorkspaceProfile(tenantId: string): boolean {
  if (getWorkspaceProfile(tenantId)) return false;
  const agentConfig = getAgentConfigSingleton();
  const callingWindow = getCallingWindowSingleton();
  if (!agentConfig && !callingWindow) return false;

  saveWorkspaceProfile({
    tenantId,
    agentConfig: agentConfig ?? {},
    callingWindow: callingWindow ?? null,
    updatedAt: new Date().toISOString(),
  });
  console.log(`MIGRATED_WORKSPACE_PROFILE tenant=${tenantId}`);
  return true;
}

/**
 * Moves the Sarvam resource ids out of the environment and onto the original
 * workspace. Only the resource ids: the API key, organisation and Sarvam
 * workspace stay in the environment as Tringlo's own credentials.
 */
function migrateProviderConfig(tenantId: string): boolean {
  if (getProviderConfig(tenantId)) return false;

  const appId = readEnv("SARVAM_APP_ID") || readEnv("SARVAM_AGENT_ID");
  const appVersion = Number(readEnv("SARVAM_APP_VERSION") || "0");
  const connectionId = readEnv("SARVAM_CONNECTION_ID");
  const phoneNumber = readEnv("SARVAM_AGENT_PHONE_NUMBER");
  if (!appId || !connectionId) return false;

  const inboundAppId = readEnv("SARVAM_INBOUND_APP_ID") || appId;
  const inboundVersion = Number(readEnv("SARVAM_INBOUND_APP_VERSION") || "0") || appVersion;
  const inboundConnection = readEnv("SARVAM_INBOUND_CONNECTION_ID") || connectionId;
  const declared = (name: string) => readEnv(name).split(",").map((item) => item.trim()).filter(Boolean);

  const now = new Date().toISOString();
  const config: WorkspaceProviderConfig = {
    tenantId,
    outbound: {
      appId,
      appVersion: Number.isInteger(appVersion) && appVersion > 0 ? appVersion : 1,
      connectionId,
      phoneNumber,
      agentName: readEnv("SARVAM_AGENT_NAME") || null,
      agentVariables: declared("SARVAM_AGENT_VARIABLES"),
    },
    inbound: {
      appId: inboundAppId,
      appVersion: Number.isInteger(inboundVersion) && inboundVersion > 0 ? inboundVersion : 1,
      connectionId: inboundConnection,
      agentVariables: declared("SARVAM_INBOUND_AGENT_VARIABLES"),
    },
    webhookToken: newWebhookToken(),
    seededFromEnv: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  };
  saveProviderConfig(config);
  console.log(`MIGRATED_PROVIDER_CONFIG tenant=${tenantId} outboundAgent=${appId} inboundAgent=${inboundAppId}`);
  return true;
}

/**
 * Writes down the variables each existing workspace's agent declares.
 *
 * Until now an empty list meant "send the sales agent's thirty variables".
 * That is right for the workspaces built alongside that agent and wrong for
 * every other one — a healthcare agent that declares none of them has its
 * calls refused outright (Sarvam 422, no call placed). The fallback is now the
 * core few, so this stamps the old list onto the workspaces that were relying
 * on it: they keep sending exactly what they sent before, now written down
 * where it can be read and edited.
 *
 * Strictly workspaces that predate the change, identified by having no
 * `variableSchemaSource` at all: every workspace saved since records which of
 * the four states it is in. A workspace that says "none" means it, and a
 * hospital or school agent saved today is never swept into a sales schema it
 * does not declare — which is exactly how a 422 was manufactured before.
 */
function recordDeclaredVariables(): number {
  let stamped = 0;
  for (const config of getAllProviderConfigs()) {
    const outbound = config.outbound;
    if (!outbound) continue;
    // A hospital's agent is explicitly not a sales agent. Stamping the sales
    // schema onto it is exactly how a 422 was manufactured, so a workspace
    // that has been turned into a hospital is left entirely alone here.
    if (getHospitalProfile(config.tenantId)?.enabled) {
      if (outbound.variableSchemaSource === undefined) {
        saveProviderConfig({ ...config, outbound: { ...outbound, variableSchemaSource: "none" } });
      }
      continue;
    }
    // Saved since per-agent variables existed: whatever it says, it means.
    if (outbound.variableSchemaSource !== undefined) continue;
    // Already lists its own, or maps them: nothing to migrate.
    if (outbound.agentVariables.length > 0 || (outbound.variableMappings ?? []).length > 0) {
      saveProviderConfig({ ...config, outbound: { ...outbound, variableSchemaSource: "declared" } });
      stamped += 1;
      continue;
    }
    saveProviderConfig({
      ...config,
      outbound: {
        ...outbound,
        agentVariables: [...SALES_AGENT_VARIABLES],
        variableSchemaSource: "legacy_default",
      },
    });
    stamped += 1;
    console.log(`MIGRATED_AGENT_VARIABLES tenant=${config.tenantId} count=${SALES_AGENT_VARIABLES.length}`);
  }
  return stamped;
}

/** Gives every workspace that somehow lacks one its own webhook token. */
function ensureWebhookTokens(): number {
  let added = 0;
  for (const config of getAllProviderConfigs()) {
    if (config.webhookToken) continue;
    saveProviderConfig({ ...config, webhookToken: newWebhookToken() });
    added++;
  }
  return added;
}

/**
 * Gives existing webhook deliveries the workspace of the call they settled.
 *
 * Only where it can be established from the attempt id. A delivery that
 * matches no call keeps a null workspace — it belonged to nobody, and
 * guessing would be worse than leaving it unscoped.
 */
function backfillWebhookLogTenants(): { events: number; receipts: number; unmapped: number } {
  const byAttempt = new Map<string, string>();
  for (const record of getCallRecords()) {
    if (record.providerAttemptId && record.tenantId) byAttempt.set(record.providerAttemptId, record.tenantId);
  }
  const result = stampWebhookLogTenants(byAttempt);
  if (result.events || result.receipts) {
    console.log(
      `MIGRATED_WEBHOOK_LOG_TENANTS events=${result.events} receipts=${result.receipts} unmapped=${result.unmapped}`
    );
  }
  return result;
}

/**
 * Turns the named workspaces into hospitals, by exact id, from configuration.
 *
 * Demo/operations setup: `TRINGLO_HOSPITAL_WORKSPACES` is a comma-separated
 * list of tenant ids. Each gets `enabled: true` on its hospital profile, so
 * selecting it from the workspace screen opens the hospital panel. This is the
 * explicit enablement the panel's own gate requires — it is NOT the old bug
 * where reading a profile created one, because nothing here runs unless an
 * administrator has listed the id. A workspace not in the list is never
 * enabled, so TenWeb stays a general workspace.
 */
function enableHospitalWorkspaces(): number {
  const ids = (readEnv("TRINGLO_HOSPITAL_WORKSPACES") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  let enabled = 0;
  for (const id of ids) {
    const tenant = getTenant(id);
    if (!tenant) {
      console.warn(`HOSPITAL_ENABLE_SKIPPED id=${id} reason=no_such_workspace`);
      continue;
    }
    const profile = getHospitalProfile(id) ?? defaultHospitalProfile(id, tenant.name);
    if (profile.enabled) continue;
    saveHospitalProfile({ ...profile, enabled: true });
    enabled += 1;
    console.log(`HOSPITAL_ENABLED tenant=${id}`);
  }
  return enabled;
}

/**
 * Restores the caller-name variable for the named workspaces, by exact id.
 *
 * `TRINGLO_CALLER_NAME_WORKSPACES` lists tenant ids whose agent should be sent
 * the caller's name again — the behaviour that was lost when the workspace was
 * set to declare no variables. It declares `customer_name` (and its common
 * aliases) and nothing else, so the agent is handed who it is calling without
 * being forced into a whole sales schema it may not declare. It does not
 * touch any other workspace, and it never changes the agent id or version.
 */
function restoreCallerNameVariables(): number {
  const ids = (readEnv("TRINGLO_CALLER_NAME_WORKSPACES") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  // Only the canonical name variable. Sending extra name aliases an agent
  // does not declare would be rejected (422); `customer_name` is the one the
  // request builder fills from the lead, and the safest single choice.
  const names = ["customer_name"];
  let restored = 0;
  for (const id of ids) {
    const config = getProviderConfig(id);
    if (!config?.outbound) {
      console.warn(`CALLER_NAME_RESTORE_SKIPPED id=${id} reason=no_outbound_config`);
      continue;
    }
    const already = new Set(config.outbound.agentVariables);
    if (names.every((name) => already.has(name))) continue;
    saveProviderConfig({
      ...config,
      outbound: {
        ...config.outbound,
        agentVariables: [...new Set([...config.outbound.agentVariables, ...names])],
        variableSchemaSource: "declared",
      },
    });
    restored += 1;
    console.log(`CALLER_NAME_RESTORED tenant=${id} names=${names.join(",")}`);
  }
  return restored;
}

/**
 * Sets the hospital agent's display name, by configuration.
 *
 * `TRINGLO_HOSPITAL_AGENT_NAME` (e.g. "Maya") is applied to every workspace in
 * `TRINGLO_HOSPITAL_WORKSPACES`: its outbound agent name and its company
 * profile's agent name. It renames only the DISPLAY name and the spoken
 * greeting — never the Sarvam agent id, which identifies a provider resource
 * and is left exactly as it was. Idempotent, and it touches no other
 * workspace, so TenWeb's Priya is untouched.
 */
function renameHospitalAgents(): number {
  const name = (readEnv("TRINGLO_HOSPITAL_AGENT_NAME") || "").trim();
  if (!name) return 0;
  const ids = (readEnv("TRINGLO_HOSPITAL_WORKSPACES") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  let renamed = 0;
  for (const id of ids) {
    const config = getProviderConfig(id);
    if (config?.outbound && config.outbound.agentName !== name) {
      saveProviderConfig({ ...config, outbound: { ...config.outbound, agentName: name } });
      renamed += 1;
    }
    const profile = getWorkspaceProfile(id);
    if (profile && profile.agentConfig?.agentName !== name) {
      saveWorkspaceProfile({ ...profile, agentConfig: { ...profile.agentConfig, agentName: name } });
    }
  }
  if (renamed) console.log(`HOSPITAL_AGENT_RENAMED count=${renamed} name=${name}`);
  return renamed;
}

/**
 * Applies the exact Sarvam identifiers recorded in data/workspace-setup.json.
 *
 * This is how precise, per-workspace provider configuration is set without a
 * live edit racing the running server's cache: the values are written down in
 * a gitignored file (no credential ever lives there — only Sarvam app,
 * connection and version ids), and applied here, once, on the next start.
 *
 * Each section is MERGED, not replaced: only the listed fields change, so a
 * workspace's agent variables, variable mappings, campaign retry rules,
 * schedule and any existing deployment id survive untouched. A section the
 * file does not mention is left exactly as it is — which is how Maya's
 * outbound and batch are left alone while only her inbound is set. It is
 * idempotent: a value already in place is not rewritten, and it scopes every
 * change to the one workspace id the file names, so one workspace's settings
 * can never land in another.
 */
function applyWorkspaceSetup(): number {
  const file = path.join(process.cwd(), "data", "workspace-setup.json");
  let setup: { workspaces?: Record<string, Record<string, Record<string, unknown>>> };
  try {
    if (!fs.existsSync(file)) return 0;
    setup = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    console.warn(`WORKSPACE_SETUP_UNREADABLE ${error instanceof Error ? error.message : "parse error"}`);
    return 0;
  }

  const pick = (source: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
    return out;
  };

  let changed = 0;
  for (const [tenantId, sections] of Object.entries(setup.workspaces ?? {})) {
    const config = getProviderConfig(tenantId);
    if (!config) {
      console.warn(`WORKSPACE_SETUP_SKIPPED tenant=${tenantId} reason=no_provider_config`);
      continue;
    }
    let next = config;
    const touched: string[] = [];

    if (sections.outbound && next.outbound) {
      const merged = { ...next.outbound, ...pick(sections.outbound, ["appId", "appVersion", "connectionId", "phoneNumber", "agentVariables"]) } as OutboundProviderConfig;
      if (JSON.stringify(next.outbound) !== JSON.stringify(merged)) { next = { ...next, outbound: merged }; touched.push("outbound"); }
    }
    if (sections.batch && next.batch) {
      const merged = { ...next.batch, ...pick(sections.batch, ["appId", "appVersion", "connectionId", "phoneNumbers", "agentVariables"]) } as BatchProviderConfig;
      if (JSON.stringify(next.batch) !== JSON.stringify(merged)) { next = { ...next, batch: merged }; touched.push("batch"); }
    }
    if (sections.inbound && next.inbound) {
      const merged = { ...next.inbound, ...pick(sections.inbound, ["appId", "appVersion", "connectionId"]) } as InboundProviderConfig;
      if (JSON.stringify(next.inbound) !== JSON.stringify(merged)) { next = { ...next, inbound: merged }; touched.push("inbound"); }
    }

    if (touched.length) {
      saveProviderConfig(next);
      changed += 1;
      // Section names only — never a value, so no id is logged.
      console.log(`WORKSPACE_SETUP_APPLIED tenant=${tenantId} sections=${touched.join(",")}`);
    }
  }
  return changed;
}

let migrationsRun = false;

export function runStartupMigrations(): void {
  if (migrationsRun) return;
  migrationsRun = true;

  const tenantId = originalTenantId();
  if (tenantId) {
    migrateWorkspaceProfile(tenantId);
    migrateProviderConfig(tenantId);
  }
  // Hospitals are enabled before variables are recorded, so a hospital agent
  // is already recognised as one when the sales-schema skip runs.
  const hospitals = enableHospitalWorkspaces();
  if (hospitals) console.log(`HOSPITALS_ENABLED count=${hospitals}`);
  renameHospitalAgents();
  recordDeclaredVariables();
  const callerNames = restoreCallerNameVariables();
  if (callerNames) console.log(`CALLER_NAMES_RESTORED count=${callerNames}`);
  const setup = applyWorkspaceSetup();
  if (setup) console.log(`WORKSPACE_SETUP count=${setup}`);
  const tokens = ensureWebhookTokens();
  if (tokens) console.log(`MIGRATED_WEBHOOK_TOKENS count=${tokens}`);
  backfillWebhookLogTenants();

  // Gives every existing account a membership in the workspace it was created
  // in — the access it already had, written down in the model that now grants
  // it. Idempotent, and it never invents access it cannot justify.
  const memberships = migrateMemberships();
  if (memberships.granted > 0) {
    console.log(`MIGRATED_MEMBERSHIPS granted=${memberships.granted} existing=${memberships.alreadyPresent}`);
  }
  for (const problem of memberships.skipped) {
    console.warn(`MEMBERSHIP_MIGRATION_SKIPPED ${problem}`);
  }
}

/** For tests: lets the guard be reset between scratch databases. */
export function resetMigrationGuardForTests(): void {
  migrationsRun = false;
}
