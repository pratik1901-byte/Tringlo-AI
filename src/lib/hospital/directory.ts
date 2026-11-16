// ============================================================
// Tringlo AI — The provider directory, cached
// ============================================================
//
// Who consults, when, and for how long per patient. It belongs to the hospital
// and is read through the integration adapter — Tringlo has no doctor
// management and no doctor directory of its own.
//
// It is cached, and that is a deliberate design decision rather than an
// optimisation. The agent's context is assembled synchronously at the moment a
// call connects: if that assembly called the hospital's API, every inbound
// call would wait on somebody else's server, and an outage over there would
// become dead air over here. So the directory is refreshed out of band — when
// the panel loads, and on the server's own timer — and the context reads the
// copy, which carries the time it was taken so staleness is visible rather
// than assumed away.
//
// When a refresh fails, the previous copy is kept and `problem` is set. A
// day-old directory with a warning on it is far better than no doctors at all,
// which would have the agent telling callers the hospital has no clinics.
// ============================================================

import {
  getHospitalProfile,
  getHospitalProfiles as hospitalProfiles,
  readProviderDirectory,
  writeProviderDirectory,
} from "@/lib/db";
import { hospitalServer, integrationConfig, type HisProvider } from "./his";
import { demoProviders } from "./his/demo";

/** A workspace's last known provider directory. */
export interface ProviderDirectory {
  tenantId: string;
  providers: HisProvider[];
  fetchedAt: string;
  source: "demo" | "live";
  /** Why the last refresh failed, when it did. The providers are the old ones. */
  problem: string | null;
}

/** Older than this and the panel says so. */
export const STALE_AFTER_MS = 15 * 60_000;

export type RefreshResult =
  | { ok: true; directory: ProviderDirectory; count: number }
  | { ok: false; problem: string; directory: ProviderDirectory | null };

/** Asks the hospital for its provider directory and keeps the answer. */
export async function refreshProviderDirectory(tenantId: string): Promise<RefreshResult> {
  const server = hospitalServer(tenantId);
  const previous = readProviderDirectory(tenantId) ?? null;

  if (!server.supports("providers_read")) {
    const problem = "The hospital's API does not offer a provider directory, so no doctors can be listed.";
    if (previous) writeProviderDirectory({ ...previous, problem });
    return { ok: false, problem, directory: previous };
  }

  const result = await server.listProviders();
  if (!result.ok) {
    // The old copy stays. Losing the directory because of one failed request
    // would take the hospital's clinics off the air.
    if (previous) writeProviderDirectory({ ...previous, problem: result.problem });
    return { ok: false, problem: result.problem, directory: previous };
  }

  const directory = writeProviderDirectory({
    tenantId,
    providers: result.data,
    fetchedAt: new Date().toISOString(),
    source: server.mode,
    problem: null,
  });
  return { ok: true, directory, count: result.data.length };
}

/**
 * The directory as it stands, without waiting for the hospital.
 *
 * In demonstration mode an empty cache is filled on the spot, because the
 * stand-in's answer comes from this installation and costs nothing. A live
 * hospital is never called from here — that would put a network request back
 * into the synchronous path this cache exists to keep clear.
 */
export function providerDirectory(tenantId: string): ProviderDirectory {
  const server = hospitalServer(tenantId);
  if (server.mode === "demo") {
    // Always read on the spot, never from the stored copy. The stand-in's
    // directory is local records, so there is nothing to wait for — and a
    // stored copy would go on offering a schedule an administrator has since
    // changed by any route that forgot to refresh it.
    return {
      tenantId,
      providers: demoProviders(tenantId),
      fetchedAt: new Date().toISOString(),
      source: "demo",
      problem: null,
    };
  }

  const stored = readProviderDirectory(tenantId);
  if (stored) return stored;

  return {
    tenantId,
    providers: [],
    fetchedAt: new Date(0).toISOString(),
    source: "live",
    problem: "The provider directory has not been read from the hospital server yet.",
  };
}

/**
 * Refreshes every live hospital's directory, for the server's own timer.
 *
 * Only the ones that actually talk to a hospital server: a demonstration
 * workspace reads its stand-in directly and has nothing to fetch. One
 * hospital's failure does not stop the next one's refresh.
 */
export async function refreshHospitalDirectories(): Promise<{ refreshed: number; failed: number }> {
  let refreshed = 0;
  let failed = 0;

  for (const profile of hospitalProfiles()) {
    if (integrationConfig(profile.tenantId).mode !== "live") continue;
    const directory = readProviderDirectory(profile.tenantId);
    if (directory && !isStale(directory)) continue;
    try {
      const result = await refreshProviderDirectory(profile.tenantId);
      if (result.ok) refreshed += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  if (refreshed || failed) {
    console.log(`HOSPITAL_DIRECTORY refreshed=${refreshed} failed=${failed}`);
  }
  return { refreshed, failed };
}

export function providers(tenantId: string): HisProvider[] {
  return providerDirectory(tenantId).providers;
}

/** Only those taking appointments. */
export function consultingProviders(tenantId: string): HisProvider[] {
  return providers(tenantId).filter((provider) => provider.accepting);
}

export function providerFor(tenantId: string, providerId: string): HisProvider | undefined {
  return providers(tenantId).find((provider) => provider.id === providerId);
}

export function isStale(directory: ProviderDirectory): boolean {
  return Date.now() - new Date(directory.fetchedAt).getTime() > STALE_AFTER_MS;
}

/** What the panel shows about where its doctor list came from. */
export function directoryStatus(tenantId: string) {
  const directory = providerDirectory(tenantId);
  const profile = getHospitalProfile(tenantId);
  return {
    source: directory.source,
    count: directory.providers.length,
    fetchedAt: directory.fetchedAt === new Date(0).toISOString() ? null : directory.fetchedAt,
    stale: isStale(directory),
    problem: directory.problem,
    timezone: profile?.timezone ?? "Asia/Kolkata",
  };
}
