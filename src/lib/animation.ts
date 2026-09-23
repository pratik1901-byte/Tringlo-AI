"use client";

// ============================================================
// Dialo AI — Motion
// ============================================================
// A small set of GSAP primitives shared by every page, so motion reads as one
// system rather than per-screen improvisation.
//
// Constraints this module enforces:
//   - Every animation honours `prefers-reduced-motion` and simply snaps to the
//     final state instead.
//   - Everything is scoped with `gsap.context` and reverted on unmount, so
//     React re-renders cannot leave a half-animated element behind.
//   - Elements animate from a visible baseline in CSS; motion never decides
//     whether content is readable.
// ============================================================

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";

/** Durations and easings, in one place, so the whole product moves alike. */
export const MOTION = {
  fast: 0.22,
  base: 0.42,
  slow: 0.62,
  stagger: 0.05,
  ease: "power2.out",
  easeInOut: "power2.inOut",
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `useLayoutEffect` on the client, `useEffect` on the server, to avoid the SSR warning. */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Reveals a section and staggers its direct children in.
 *
 * `selector` narrows which descendants stagger — pass it when the children that
 * should move are not the immediate ones (table rows inside a tbody, say).
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  selector?: string;
  delay?: number;
  distance?: number;
  /** Re-runs the reveal when any of these change — e.g. a filter tab. */
  deps?: unknown[];
  enabled?: boolean;
}) {
  const ref = useRef<T | null>(null);
  const {
    selector,
    delay = 0,
    distance = 14,
    deps = [],
    enabled = true,
  } = options ?? {};

  useIsomorphicLayoutEffect(() => {
    if (!ref.current || !enabled) return;
    if (prefersReducedMotion()) return;

    const context = gsap.context(() => {
      const targets = selector
        ? gsap.utils.toArray<HTMLElement>(selector)
        : gsap.utils.toArray<HTMLElement>(ref.current!.children);

      if (targets.length === 0) return;

      gsap.fromTo(
        targets,
        { opacity: 0, y: distance },
        {
          opacity: 1,
          y: 0,
          duration: MOTION.base,
          ease: MOTION.ease,
          delay,
          stagger: MOTION.stagger,
          clearProps: "transform",
        }
      );
    }, ref);

    return () => context.revert();
  }, [enabled, selector, delay, distance, ...deps]);

  return ref;
}

/**
 * Entrance for a single element — a page header, an empty state, a detail panel.
 */
export function useFadeIn<T extends HTMLElement = HTMLDivElement>(options?: {
  delay?: number;
  distance?: number;
  deps?: unknown[];
}) {
  const ref = useRef<T | null>(null);
  const { delay = 0, distance = 10, deps = [] } = options ?? {};

  useIsomorphicLayoutEffect(() => {
    if (!ref.current) return;
    if (prefersReducedMotion()) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: distance },
        { opacity: 1, y: 0, duration: MOTION.base, ease: MOTION.ease, delay, clearProps: "transform" }
      );
    }, ref);

    return () => context.revert();
  }, [delay, distance, ...deps]);

  return ref;
}

/**
 * Modal entrance: the backdrop fades while the panel lifts slightly.
 * Deliberately restrained — a dialog that bounces is a dialog that delays the
 * person trying to read it.
 */
export function useModalEntrance() {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotion()) return;

    const context = gsap.context(() => {
      const timeline = gsap.timeline();
      if (backdropRef.current) {
        timeline.fromTo(
          backdropRef.current,
          { opacity: 0 },
          { opacity: 1, duration: MOTION.fast, ease: MOTION.ease },
          0
        );
      }
      if (panelRef.current) {
        timeline.fromTo(
          panelRef.current,
          { opacity: 0, y: 16, scale: 0.985 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: MOTION.base,
            ease: MOTION.ease,
            clearProps: "transform",
          },
          0.04
        );
      }
    });

    return () => context.revert();
  }, []);

  return { backdropRef, panelRef };
}

/**
 * Cross-fades a region whenever its key changes — used for live call status, where
 * one honest state replaces another. The old content is not animated out first;
 * a state change should be visible immediately, not after an exit animation.
 */
export function useStateTransition<T extends HTMLElement = HTMLDivElement>(key: string) {
  const ref = useRef<T | null>(null);
  const previous = useRef<string | null>(null);

  useIsomorphicLayoutEffect(() => {
    if (!ref.current) return;
    if (previous.current === key) return;
    previous.current = key;
    if (prefersReducedMotion()) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        ref.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: MOTION.base, ease: MOTION.ease, clearProps: "transform" }
      );
    }, ref);

    return () => context.revert();
  }, [key]);

  return ref;
}

/**
 * Counts a metric up to its value.
 *
 * Returns the formatted string to render. When the value is null the hook does
 * nothing and the caller shows an em dash — a metric with no data must never
 * animate up from zero, which would read as a real measurement of zero.
 */
export function useCountUp(
  value: number | null,
  format: (value: number) => string,
  options?: { duration?: number }
): string {
  const [display, setDisplay] = useState<string>(() =>
    value === null ? "" : format(value)
  );
  const previous = useRef<number | null>(null);

  // Callers pass an inline formatter, so it is captured in a ref inside the effect
  // rather than listed as a dependency — otherwise every parent render would
  // restart the count-up from scratch.
  const formatRef = useRef(format);
  const durationRef = useRef(options?.duration);

  useEffect(() => {
    formatRef.current = format;
    durationRef.current = options?.duration;

    if (value === null) {
      previous.current = null;
      return;
    }

    if (prefersReducedMotion() || previous.current === value) {
      previous.current = value;
      setDisplay(formatRef.current(value));
      return;
    }

    const from = previous.current ?? 0;
    previous.current = value;

    const counter = { current: from };
    const tween = gsap.to(counter, {
      current: value,
      duration: durationRef.current ?? MOTION.slow,
      ease: MOTION.easeInOut,
      onUpdate: () => setDisplay(formatRef.current(counter.current)),
      onComplete: () => setDisplay(formatRef.current(value)),
    });

    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- format and duration are read through refs on purpose
  }, [value]);

  return display;
}

/** Draws attention to a row or panel that just changed underneath the reader. */
export function highlight(element: HTMLElement | null) {
  if (!element || prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { backgroundColor: "color-mix(in oklab, var(--accent) 60%, transparent)" },
    { backgroundColor: "transparent", duration: 1.1, ease: MOTION.easeInOut, clearProps: "backgroundColor" }
  );
}
