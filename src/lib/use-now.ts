"use client";

import { useEffect, useState } from "react";

/**
 * A clock that ticks, for anything whose correctness depends on the current time.
 *
 * Reading `Date.now()` during render makes a component impure: it returns a
 * different result on every re-render, and an "overdue" badge computed that way
 * only updates when something unrelated happens to re-render the tree. This hook
 * keeps the current time in state so the value is stable within a render and
 * genuinely refreshes on its own.
 *
 * Starts at 0 so the server and the first client render agree; the real time
 * arrives on the first tick after mount.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
