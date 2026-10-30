// ============================================================
// Tringlo AI — the voice provider draft
// ============================================================
//
// The shape of the voice provider form, and everything that can be decided
// about it without a browser: what an empty one looks like, how a saved
// configuration becomes an editable one, what is still wrong with it, and what
// it turns into when it is saved.
//
// It lives apart from the component so that both the creation wizard and the
// Settings editor share exactly these rules, and so the rules can be tested
// without rendering anything.
// ============================================================

import type { ConfigStatus } from "@/lib/providers/types";
import type { AgentVariableMapping } from "@/lib/providers/variable-mapping";

export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** The shared input styling, so both screens look like one form. */
export const field =
  "w-full h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// ------------------------------------------------------------
// The draft
// ------------------------------------------------------------
//
// Everything is a string while it is being edited, exactly as typed. Numbers
// are only numbers once the draft becomes a payload, so a half-typed version
// never becomes a 0.

export interface VoiceProviderDraft {
  single: {
    appId: string;
    appVersion: string;
    connectionId: string;
    phoneNumber: string;
    /**
     * The variables this agent declares in Sarvam, comma separated and
     * verbatim — `customer_name` and `customerName` are different names, and
     * Sarvam refuses a whole call over one the agent does not declare. Empty
     * means Tringlo sends only the core few.
     */
    agentVariables: string;
    /** Where each declared variable's value comes from. */
    mappings: AgentVariableMapping[];
    /** Leave the agent's own opening line alone. */
    useOwnGreeting: boolean;
  };
  batch: {
    sameAsSingle: boolean;
    appId: string;
    appVersion: string;
    connectionId: string;
    phoneNumbers: string;
    /** As above, for a campaign agent that is not the single-call one. */
    agentVariables: string;
    mappings: AgentVariableMapping[];
    attemptsPerSecond: string;
    maxRetries: string;
    retryInterval: string;
    onBusy: boolean;
    onNoAnswer: boolean;
    startTime: string;
    endTime: string;
    days: string[];
    timezone: string;
  };
  inbound: {
    on: boolean;
    appId: string;
    appVersion: string;
    connectionId: string;
    phoneNumber: string;
    deploymentId: string;
    handoffNumber: string;
    startTime: string;
    endTime: string;
    days: string[];
    timezone: string;
  };
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

export function emptyDraft(): VoiceProviderDraft {
  return {
    single: {
      appId: "", appVersion: "", connectionId: "", phoneNumber: "",
      agentVariables: "", mappings: [], useOwnGreeting: false,
    },
    batch: {
      sameAsSingle: true, appId: "", appVersion: "", connectionId: "", phoneNumbers: "", agentVariables: "", mappings: [],
      attemptsPerSecond: "1", maxRetries: "2", retryInterval: "30", onBusy: true, onNoAnswer: true,
      startTime: "09:00", endTime: "19:00", days: [...WEEKDAYS], timezone: "Asia/Kolkata",
    },
    inbound: {
      on: false, appId: "", appVersion: "", connectionId: "", phoneNumber: "", deploymentId: "",
      handoffNumber: "", startTime: "09:00", endTime: "18:00", days: [...WEEKDAYS], timezone: "Asia/Kolkata",
    },
  };
}

/** What Settings is given: the workspace's saved configuration, ids only. */
export interface SavedProviderView {
  outbound: {
    appId: string; appVersion: number; connectionId: string; phoneNumber: string;
    agentVariables?: string[];
    variableMappings?: AgentVariableMapping[];
    useOwnGreeting?: boolean;
  } | null;
  batch: {
    appId: string; appVersion: number; connectionId: string; phoneNumbers: string[];
    agentVariables?: string[];
    variableMappings?: AgentVariableMapping[];
    attemptsPerSecond: number;
    retry: { maxRetries: number; intervalMinutes: number; onBusy: boolean; onNoAnswer: boolean };
    schedule: { timezone: string; startTime: string; endTime: string; days: string[] };
  } | null;
  inbound: { appId: string; appVersion: number; connectionId: string } | null;
  inboundSettings?: {
    enabled: boolean; deploymentId: string | null; phoneNumber: string | null; handoffNumber: string | null;
    startTime: string; endTime: string; days: string[]; timezone: string;
  } | null;
}

/**
 * The saved configuration, as an editable draft.
 *
 * A workspace with no campaign settings of its own shows the single-call ones
 * with "same as single calls" still ticked — which is what it is actually
 * doing, rather than a blank form implying nothing is configured.
 */
export function draftFromSaved(saved: SavedProviderView): VoiceProviderDraft {
  const draft = emptyDraft();
  const num = (value: number | undefined | null) => (value ? String(value) : "");

  if (saved.outbound) {
    draft.single = {
      appId: saved.outbound.appId ?? "",
      appVersion: num(saved.outbound.appVersion),
      connectionId: saved.outbound.connectionId ?? "",
      phoneNumber: saved.outbound.phoneNumber ?? "",
      agentVariables: (saved.outbound.agentVariables ?? []).join(", "),
      mappings: saved.outbound.variableMappings ?? [],
      useOwnGreeting: Boolean(saved.outbound.useOwnGreeting),
    };
  }

  if (saved.batch) {
    const b = saved.batch;
    const sameAsSingle =
      b.appId === saved.outbound?.appId &&
      b.appVersion === saved.outbound?.appVersion &&
      b.connectionId === saved.outbound?.connectionId &&
      b.phoneNumbers.length === 1 &&
      b.phoneNumbers[0] === saved.outbound?.phoneNumber;
    draft.batch = {
      sameAsSingle,
      appId: b.appId ?? "",
      appVersion: num(b.appVersion),
      connectionId: b.connectionId ?? "",
      phoneNumbers: (b.phoneNumbers ?? []).join(", "),
      agentVariables: (b.agentVariables ?? []).join(", "),
      mappings: b.variableMappings ?? [],
      attemptsPerSecond: num(b.attemptsPerSecond) || "1",
      maxRetries: String(b.retry?.maxRetries ?? 2),
      retryInterval: String(b.retry?.intervalMinutes ?? 30),
      onBusy: Boolean(b.retry?.onBusy),
      onNoAnswer: Boolean(b.retry?.onNoAnswer),
      startTime: b.schedule?.startTime ?? "09:00",
      endTime: b.schedule?.endTime ?? "19:00",
      days: b.schedule?.days?.length ? b.schedule.days : [...WEEKDAYS],
      timezone: b.schedule?.timezone ?? "Asia/Kolkata",
    };
  }

  const inboundSettings = saved.inboundSettings ?? null;
  if (saved.inbound || inboundSettings?.deploymentId || inboundSettings?.enabled) {
    draft.inbound = {
      on: true,
      appId: saved.inbound?.appId ?? "",
      appVersion: num(saved.inbound?.appVersion),
      connectionId: saved.inbound?.connectionId ?? "",
      phoneNumber: inboundSettings?.phoneNumber ?? "",
      deploymentId: inboundSettings?.deploymentId ?? "",
      handoffNumber: inboundSettings?.handoffNumber ?? "",
      startTime: inboundSettings?.startTime ?? "09:00",
      endTime: inboundSettings?.endTime ?? "18:00",
      days: inboundSettings?.days?.length ? inboundSettings.days : [...WEEKDAYS],
      timezone: inboundSettings?.timezone ?? "Asia/Kolkata",
    };
  }

  return draft;
}

/** Everything wrong with the draft, in the order someone would fix it. */
export function draftProblems(draft: VoiceProviderDraft): string[] {
  const problems: string[] = [];
  const { single, batch, inbound } = draft;

  if (!single.appId.trim()) problems.push("Single outbound: enter the agent ID from Sarvam.");
  if (!Number(single.appVersion)) problems.push("Single outbound: enter the agent version.");
  if (!single.connectionId.trim()) problems.push("Single outbound: enter the telephony connection ID.");
  if (!single.phoneNumber.trim()) problems.push("Single outbound: enter the number calls are placed from.");

  if (!batch.sameAsSingle) {
    if (!batch.appId.trim()) problems.push("Batch outbound: enter the campaign agent ID, or reuse the single-call one.");
    if (!Number(batch.appVersion)) problems.push("Batch outbound: enter the campaign agent version.");
    if (!batch.connectionId.trim()) problems.push("Batch outbound: enter the campaign connection ID.");
    if (!batch.phoneNumbers.trim()) problems.push("Batch outbound: enter at least one number campaigns dial from.");
  }
  if (!Number(batch.attemptsPerSecond)) problems.push("Batch outbound: set how many calls a second a campaign may place.");
  if (!batch.days.length) problems.push("Batch outbound: choose the days campaigns may call on.");
  if (batch.endTime <= batch.startTime) problems.push("Batch outbound: calling hours must end after they start.");

  if (inbound.on) {
    if (!inbound.phoneNumber.trim()) problems.push("Inbound: enter the number people will call, or switch inbound off.");
    if (!inbound.days.length) problems.push("Inbound: choose the days the line answers on.");
    if (inbound.endTime <= inbound.startTime) problems.push("Inbound: answering hours must end after they start.");
  }
  return problems;
}

/** The draft as the API wants it. Numbers become numbers only here. */
export function draftToPayload(draft: VoiceProviderDraft) {
  const { single, batch, inbound } = draft;
  const list = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);

  return {
    outbound: {
      appId: single.appId.trim(),
      appVersion: Number(single.appVersion),
      connectionId: single.connectionId.trim(),
      phoneNumber: single.phoneNumber.trim(),
      agentVariables: list(single.agentVariables),
      variableMappings: single.mappings,
      useOwnGreeting: single.useOwnGreeting,
    },
    batch: {
      appId: (batch.sameAsSingle ? single.appId : batch.appId).trim(),
      appVersion: Number(batch.sameAsSingle ? single.appVersion : batch.appVersion),
      appType: "agent",
      connectionId: (batch.sameAsSingle ? single.connectionId : batch.connectionId).trim(),
      phoneNumbers: batch.sameAsSingle ? [single.phoneNumber.trim()] : list(batch.phoneNumbers),
      // The same agent means the same declared variables; a different one gets
      // its own list, set beside its agent ID.
      agentVariables: batch.sameAsSingle ? list(single.agentVariables) : list(batch.agentVariables),
      variableMappings: batch.sameAsSingle ? single.mappings : batch.mappings,
      attemptsPerSecond: Number(batch.attemptsPerSecond),
      cohortMode: "stream" as const,
      retry: {
        maxRetries: Number(batch.maxRetries),
        intervalMinutes: Number(batch.retryInterval),
        onBusy: batch.onBusy,
        onNoAnswer: batch.onNoAnswer,
        onFailed: false,
        onShortDuration: false,
        shortDurationSeconds: 25,
      },
      schedule: {
        timezone: batch.timezone,
        startTime: batch.startTime,
        endTime: batch.endTime,
        days: batch.days,
      },
    },
    inbound: inbound.on
      ? {
          appId: inbound.appId.trim() || single.appId.trim(),
          appVersion: Number(inbound.appVersion) || Number(single.appVersion),
          connectionId: inbound.connectionId.trim() || single.connectionId.trim(),
          phoneNumber: inbound.phoneNumber.trim(),
          deploymentId: inbound.deploymentId.trim() || null,
          handoffNumber: inbound.handoffNumber.trim() || null,
          startTime: inbound.startTime,
          endTime: inbound.endTime,
          days: inbound.days,
          timezone: inbound.timezone,
        }
      : null,
  };
}

/** Where each section stands. Nothing here may claim a provider check passed. */
export function draftStatus(draft: VoiceProviderDraft, saved: boolean): {
  single: ConfigStatus;
  batch: ConfigStatus;
  inbound: ConfigStatus;
} {
  const ready = saved ? "saved" : "parsed";
  const { single, batch, inbound } = draft;
  const singleOk = Boolean(single.appId.trim() && Number(single.appVersion) && single.connectionId.trim() && single.phoneNumber.trim());
  const batchOwn = Boolean(batch.appId.trim() && Number(batch.appVersion) && batch.connectionId.trim() && batch.phoneNumbers.trim());
  const batchOk = (batch.sameAsSingle ? singleOk : batchOwn) && Boolean(Number(batch.attemptsPerSecond)) && batch.days.length > 0 && batch.endTime > batch.startTime;
  return {
    single: singleOk ? ready : "incomplete",
    batch: batchOk ? (batch.sameAsSingle ? "inherited" : ready) : "incomplete",
    inbound: !inbound.on ? "off" : inbound.phoneNumber.trim() ? ready : "incomplete",
  };
}

