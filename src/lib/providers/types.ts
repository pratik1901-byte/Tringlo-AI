// ============================================================
// Tringlo AI — Voice provider configuration
// ============================================================
//
// Tringlo runs one Sarvam organisation, one Sarvam workspace and one API key.
// Inside it, each Tringlo workspace has its own agent, connection and numbers.
//
//   platform credentials  → who Tringlo is to Sarvam   (server, environment)
//   workspace config      → which agent answers for this customer (database)
//
// The credential is never workspace data and never reaches a browser. The
// resource ids are ordinary configuration a workspace administrator edits.
// ============================================================

import type { AgentVariableMapping } from "./variable-mapping";

/** Tringlo's own Sarvam account. Shared by every workspace, server-side only. */
export interface PlatformCredentials {
  apiKey: string;
  orgId: string;
  workspaceId: string;
}

/** The agent Tringlo calls out with for one workspace. */
export interface OutboundProviderConfig {
  appId: string;
  appVersion: number;
  connectionId: string;
  /** The number the customer sees. */
  phoneNumber: string;
  /** What the agent calls itself; used to label transcript turns. */
  agentName: string | null;
  /**
   * The variables this agent declares in Sarvam, exactly as spelled there.
   * Sarvam rejects anything it has not declared, so Tringlo sends only these.
   * Empty means the agent takes no custom variables — not "use a default
   * list", because no list is right for every agent.
   */
  agentVariables: string[];
  /**
   * Where each declared variable's value comes from. When present this is
   * authoritative and nothing else is sent; when absent, a workspace
   * configured before mappings existed keeps the behaviour it had.
   */
  variableMappings?: AgentVariableMapping[];
  /**
   * How Tringlo knows what this agent accepts. The four states are distinct
   * and must not be confused:
   *
   *   undefined        configured before this existed; left to the migration
   *   "legacy_default" was relying on the built-in sales list, now written down
   *   "declared"       an administrator listed what the agent declares
   *   "none"           the agent takes no custom variables
   */
  variableSchemaSource?: "legacy_default" | "declared" | "none";
  /**
   * Leave the agent's own opening line alone. Tringlo otherwise sends an
   * opening that names the workspace's company, which is right for an outbound
   * sales call and wrong for an agent whose prompt opens its own way.
   */
  useOwnGreeting?: boolean;
}

/**
 * How this workspace runs a campaign.
 *
 * Separate from the single-call settings on purpose: a workspace may dial
 * campaigns from a pool of numbers, at a different rate, or even with a
 * different agent. When it does not, the form copies the single-call values
 * across — but it copies them, rather than Tringlo assuming they are the same.
 */
export interface BatchProviderConfig {
  appId: string;
  appVersion: number;
  /** Sarvam's app_type; "agent" unless an example says otherwise. */
  appType: string;
  connectionId: string;
  /** The numbers campaigns dial from. One is normal; a pool spreads the load. */
  phoneNumbers: string[];
  attemptsPerSecond: number;
  /** How the leads are handed over. Streaming is the proven path. */
  cohortMode: "stream" | "upload";
  /**
   * The variables this campaign agent declares in Sarvam. A campaign inherits
   * the single-call agent's list only when it runs the same agent and version;
   * a different agent declares its own, and borrowing would be a guess.
   */
  agentVariables: string[];
  /** Where each of them comes from, including `csv.<column>` sources. */
  variableMappings?: AgentVariableMapping[];
  /** Defaults a launch starts from; each campaign may still change them. */
  retry: {
    maxRetries: number;
    intervalMinutes: number;
    onBusy: boolean;
    onNoAnswer: boolean;
    onFailed: boolean;
    onShortDuration: boolean;
    shortDurationSeconds: number;
  };
  schedule: {
    timezone: string;
    startTime: string;
    endTime: string;
    days: string[];
  };
}

/** The agent that answers for one workspace. Only meaningful when inbound is on. */
export interface InboundProviderConfig {
  appId: string;
  appVersion: number;
  connectionId: string;
  /** What the agent that answers this line declares. Empty means none. */
  agentVariables: string[];
  /** Where each one comes from. Authoritative when present. */
  variableMappings?: AgentVariableMapping[];
}

/**
 * What a piece of configuration actually amounts to. These are deliberately
 * distinct: "saved" is not "working", and only a check that really reached
 * Sarvam may say "verified".
 *
 *  incomplete   — required values are missing.
 *  parsed       — structurally valid, nothing written yet (the creation wizard).
 *  saved        — stored for this workspace and valid as far as Tringlo can tell.
 *  verified     — a provider check actually succeeded, and nothing changed since.
 *  unavailable  — stored and valid, but the operation cannot run today.
 *  error        — stored, but something in it is wrong.
 *  off          — deliberately not enabled.
 *  inherited    — no settings of its own; using the single-call ones.
 */
export type ConfigStatus =
  | "incomplete"
  | "parsed"
  | "saved"
  | "verified"
  | "unavailable"
  | "error"
  | "off"
  | "inherited";

export interface WorkspaceProviderConfig {
  tenantId: string;
  outbound: OutboundProviderConfig | null;
  /**
   * Campaign settings. Null on a workspace configured before campaigns were
   * set up here, which falls back to the single-call settings — the behaviour
   * it already had.
   */
  batch?: BatchProviderConfig | null;
  inbound: InboundProviderConfig | null;
  /**
   * This workspace's webhook token. Sarvam sends it back on every delivery, so
   * a webhook can be tied to the workspace that registered it. Never leaves
   * the server.
   */
  webhookToken: string;
  /** True when this row was created by the one-time migration from the environment. */
  seededFromEnv?: boolean;
  /**
   * When a provider check last actually succeeded against Sarvam. Editing the
   * configuration leaves this behind, so a check only counts as current while
   * it is newer than updatedAt. Nothing local or mocked may set it.
   */
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

/** Everything one outbound call needs, resolved for a single workspace. */
export interface ResolvedOutbound {
  credentials: PlatformCredentials;
  outbound: OutboundProviderConfig;
  webhookToken: string;
}

/** Everything one inbound line needs, resolved for a single workspace. */
export interface ResolvedInbound {
  credentials: PlatformCredentials;
  inbound: InboundProviderConfig;
  webhookToken: string;
}

/**
 * Why a workspace cannot place or answer a call. Carried rather than thrown so
 * every caller reports the same sentence instead of inventing its own.
 */
export class ProviderNotConfiguredError extends Error {
  readonly code = "provider_not_configured";
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems[0] ?? "Voice provider is not configured for this workspace.");
    this.name = "ProviderNotConfiguredError";
    this.problems = problems;
  }
}

export const NOT_CONFIGURED = "Voice provider is not configured for this workspace.";
