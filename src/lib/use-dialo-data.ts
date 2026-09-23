"use client";

// ============================================================
// Dialo AI — Server State Hooks
// ============================================================
// Every screen reads the database through these hooks. There is no client-side
// cache of call results: a call outcome exists in exactly one place, and the UI
// renders it or renders nothing.
//
// Polling pauses while the tab is hidden and resumes with an immediate fetch, so
// coming back to a tab shows current state rather than the last frame before the
// person switched away.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthStore } from "@/lib/store";

import type { CallRecord, FollowUp, Lead } from "@/lib/types";
import type { SarvamConfigStatus } from "@/lib/providers/sarvam/types";
import type {
  CallMetrics,
  DailyPoint,
  HourlyPoint,
  OutcomeSlice,
  WeeklyPoint,
} from "@/lib/metrics";

/**
 * How many call records the web client pulls.
 *
 * Its tables and charts render the whole history, so it asks for a page large
 * enough to cover it rather than paging. The backend caps this at 200; the
 * Flutter client pages properly, and this client is being replaced by it.
 */
const RECORDS_PAGE_SIZE = 200;

export interface Resource<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load; a background refresh does not blank the screen. */
  isLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

function useResource<T>(url: string, intervalMs: number | null): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hasLoaded = useRef(false);

  const refresh = useCallback(async () => {
    if (hasLoaded.current) setIsRefreshing(true);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));

        // A rejected session is not a data error. Reporting it as one is how
        // every screen came to say "something went wrong" at once, when what
        // had actually happened was that nobody was signed in. Telling the
        // auth store instead sends the person to the login screen.
        if (response.status === 401) {
          useAuthStore.getState().handleUnauthorized();
          throw new Error("Your session has ended. Sign in again.");
        }

        // The API returns either { error: "..." } or { error: { message } }.
        const message =
          typeof body.error === "string"
            ? body.error
            : typeof body.error?.message === "string"
              ? body.error.message
              : `Request failed with status ${response.status}`;
        throw new Error(message);
      }
      setData((await response.json()) as T);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      hasLoaded.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [url]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalMs === null || timer !== null) return;
      timer = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    // Scheduled rather than called inline: the effect subscribes to the server,
    // and updating state synchronously inside it would cascade an extra render.
    const initial = setTimeout(refresh, 0);
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(initial);
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, intervalMs]);

  return { data, error, isLoading, isRefreshing, refresh };
}

// ------------------------------------------------------------

export function useCallRecords(intervalMs: number | null = 6000) {
  const resource = useResource<{ records: CallRecord[] }>(
    `/api/records?limit=${RECORDS_PAGE_SIZE}`,
    intervalMs
  );
  return { ...resource, records: resource.data?.records ?? [] };
}

export function useLeads(intervalMs: number | null = 15000) {
  const resource = useResource<{ leads: Lead[] }>("/api/leads", intervalMs);
  return { ...resource, leads: resource.data?.leads ?? [] };
}

export function useFollowUps(intervalMs: number | null = 10000) {
  const resource = useResource<{ followUps: FollowUp[] }>("/api/follow-ups", intervalMs);
  return { ...resource, followUps: resource.data?.followUps ?? [] };
}

export interface MetricsResponse {
  metrics: CallMetrics;
  outcomes: OutcomeSlice[];
  daily: DailyPoint[];
  weekly: WeeklyPoint[];
  hourly: HourlyPoint[];
  generatedAt: string;
}

export function useMetrics(intervalMs: number | null = 10000) {
  return useResource<MetricsResponse>("/api/metrics", intervalMs);
}

export interface ProviderStatus extends SarvamConfigStatus {
  providerConnectivity: "reachable" | "unreachable" | "not_tested";
  providerDetails: string | null;
}

/** Polled slowly: server configuration changes on deploy, not on a timer. */
export function useProviderStatus() {
  return useResource<ProviderStatus>("/api/integrations/sarvam/status", 120000);
}

/**
 * Watches a single call until the provider reports a terminal state.
 *
 * Polls the database rather than holding state in the component, so a refresh
 * mid-call picks the same call back up exactly where it is.
 */
export interface ReachabilityHistory {
  totalAttempts: number;
  failedAttempts: number;
  consecutiveFailures: number;
  everConnected: boolean;
  lastConnectedAt: string | null;
}

export function useCallWatch(callId: string | null, active: boolean) {
  const [record, setRecord] = useState<CallRecord | null>(null);
  const [reachability, setReachability] = useState<ReachabilityHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!callId || !active) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`/api/calls/${callId}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as {
          record: CallRecord;
          reachability?: ReachabilityHistory;
        };
        if (!cancelled) {
          setRecord(body.record);
          setReachability(body.reachability ?? null);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Lost contact with the server while waiting for the call result.");
      }
    };

    const initial = setTimeout(poll, 0);
    const timer = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [callId, active]);

  return { record, reachability, error };
}
