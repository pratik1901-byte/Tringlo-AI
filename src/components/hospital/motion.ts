"use client";

// Wellness Hospital — motion. Scoped to the panel; the public site has its own.
// The markup is always the finished page: motion only animates *from* an
// offset back to it, and nothing runs when reduced motion is requested.

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import gsap from "gsap";

const MOTION_OK = "(prefers-reduced-motion: no-preference)";
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Staggers a page's top-level blocks in, once per route. */
export function usePageEntrance(scope: RefObject<HTMLElement | null>, key: string) {
  // Compared by route, not by a "has run" flag: development runs effects twice
  // on mount, and the second run must still count as the first load.
  const landedOn = useRef(key);
  useIsoLayoutEffect(() => {
    const root = scope.current;
    if (!root) return;
    const initial = key === landedOn.current;
    if (!initial) landedOn.current = "";
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      // On first load the page inside may still be hydrating, and touching its
      // elements then makes React report a mismatch. The wrapper is the
      // shell's own, so that is what moves; later navigations stagger blocks.
      if (initial) {
        gsap.from(root, { y: 12, opacity: 0, duration: 0.5, ease: "expo.out", clearProps: "transform,opacity" });
        return;
      }
      const page = root.firstElementChild;
      const blocks = page ? Array.from(page.children).slice(0, 8) : [];
      if (!blocks.length) return;
      gsap.from(blocks, { y: 12, opacity: 0, duration: 0.5, ease: "expo.out", stagger: 0.06, clearProps: "transform,opacity" });
    });
    return () => mm.revert();
  }, [key]);
}

/** Counts a figure up to its value the first time it is shown. */
export function useCountUp(value: number | null) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || value === null || done.current || value <= 0) return;
    done.current = true;
    if (!window.matchMedia(MOTION_OK).matches) return;
    const counter = { n: 0 };
    const tween = gsap.to(counter, {
      n: value,
      duration: 0.7,
      ease: "power2.out",
      onUpdate: () => { el.textContent = String(Math.round(counter.n)); },
      onComplete: () => { el.textContent = String(value); },
    });
    return () => { tween.kill(); el.textContent = String(value); };
  }, [value]);
  return ref;
}
