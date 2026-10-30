"use client";

// ============================================================
// Wellness Hospital — reading the hospital's records
// ============================================================
//
// One fetch helper and one hook, for the hospital panel's own pages.
//
// The panel used to be a separate application on its own port, reaching the
// platform through a server-side proxy. It is now a section of the platform,
// so it calls the platform's API directly: same origin, same session cookie,
// no proxy hop and no workspace to pin — the workspace is simply the one the
// person has open, which is the one whose hospital they are looking at.
// ============================================================

import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      body?.error?.message ??
      body?.error ??
      (response.status === 401
        ? "Your session has ended. Sign in again."
        : "That did not work. Try again.");
    throw new ApiError(String(message), response.status);
  }
  return body as T;
}

/**
 * Loads on mount, and again whenever `path` changes.
 *
 * The path is the whole key — a filter, a date range or a chosen row all show
 * up in the query string, so there is no separate dependency list to keep in
 * step with it. A page that wants different data asks for a different path.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** Bumped to ask for the same path again after something was changed. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    let active = true;

    // State is set inside the closure, after the request — never in the body
    // of the effect itself, which would render again before the request had
    // even gone out. A result that arrives after this page moved on is
    // dropped rather than written over whatever replaced it.
    void (async () => {
      try {
        const answer = await api<T>(path);
        if (!active) return;
        setData(answer);
        setError(null);
        setStatus(null);
      } catch (problem) {
        if (!active) return;
        setError(problem instanceof Error ? problem.message : "Something went wrong.");
        setStatus(problem instanceof ApiError ? problem.status : null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [path, attempt]);

  const reload = useCallback(async () => {
    setAttempt((previous) => previous + 1);
  }, []);

  return { data, error, status, loading, reload };
}

/** A date as the hospital writes it. */
export function formatDate(value: string | null | undefined, timezone = "Asia/Kolkata"): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(value: string | null | undefined, timezone = "Asia/Kolkata"): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
}

export function formatWhen(value: string | null | undefined, timezone = "Asia/Kolkata"): string {
  if (!value) return "—";
  return `${formatDate(value, timezone)} · ${formatTime(value, timezone)}`;
}

/** "in 3 hours", "yesterday" — for a column where the exact minute is noise. */
export function relative(value: string | null | undefined): string {
  if (!value) return "—";
  const diff = new Date(value).getTime() - Date.now();
  const minutes = Math.round(diff / 60000);
  const absolute = Math.abs(minutes);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (absolute < 60) return formatter.format(minutes, "minute");
  if (absolute < 1440) return formatter.format(Math.round(minutes / 60), "hour");
  return formatter.format(Math.round(minutes / 1440), "day");
}

/**
 * Which workspace this panel is showing, and the agent that speaks for it.
 *
 * `pinned` is the one to read when something looks wrong: false means the
 * panel is following whichever workspace the signed-in session has open,
 * which is how another workspace's calls end up on screen.
 */
export interface WorkspaceInfo {
  /** Whether this workspace runs the hospital panel at all. */
  isHospital: boolean;
  workspace: { id: string; name: string };
  hospital: { name: string; timezone: string };
  agent: { name: string; configured: boolean };
}

export function useWorkspace() {
  return useApi<WorkspaceInfo>("hospital/workspace");
}

/** Today, in the hospital's timezone, as "YYYY-MM-DD". */
export function todayIn(timezone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}
