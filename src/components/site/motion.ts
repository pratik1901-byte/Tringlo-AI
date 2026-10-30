"use client";

// ============================================================
// Public website — motion
// ============================================================
//
// One way to animate across the site:
//
//   useSiteMotion(scopeRef, (scope, ctx) => { ...gsap code... })
//
// registers the plugins once, scopes selectors to the section, reverts every
// tween, ScrollTrigger and SplitText when the section unmounts, and runs only
// when the visitor has not asked for reduced motion.
//
// The rule every helper here follows: the markup is the finished, readable
// page. Motion may only ever hide something at the instant it starts
// animating it back in. A trigger that never fires costs an animation, never
// the content — which is exactly what went wrong once already, when twelve
// blocks on the landing page were left at opacity 0.
// ============================================================

import { useEffect, useLayoutEffect, type RefObject } from "react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

let registered = false;

export function registerSiteGsap() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin, MotionPathPlugin, SplitText);
  registered = true;
}

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export const REDUCED = "(prefers-reduced-motion: reduce)";
export const MOTION_OK = "(prefers-reduced-motion: no-preference)";
/** Large screens with motion welcome: where scroll-driven layouts switch on. */
export const DESKTOP_MOTION = "(min-width: 1024px) and (prefers-reduced-motion: no-preference)";

/** The ease the whole site moves with, so sections feel like one hand. */
export const EASE = "expo.out";

/**
 * Runs `build` inside a gsap.matchMedia scoped to `scopeRef`, only when motion
 * is welcome. Anything it creates is reverted on unmount or when the
 * preference changes.
 */
export function useSiteMotion(
  scopeRef: RefObject<HTMLElement | null>,
  build: (scope: HTMLElement, ctx: gsap.Context) => void | (() => void),
  deps: unknown[] = []
) {
  useIsoLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    registerSiteGsap();
    const media = gsap.matchMedia(scope);
    media.add(MOTION_OK, (context) => build(scope, context));
    // Triggers are measured when they are created, which on first paint is
    // before fonts have settled and, in development, before React's second
    // StrictMode pass has finished. A refresh on the next frame re-measures.
    const frame = requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => {
      cancelAnimationFrame(frame);
      media.revert();
    };
  }, deps);
}

/** Runs once web fonts are ready — line breaks depend on the final font. */
function afterFonts(run: () => void) {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (fonts?.ready) void fonts.ready.then(run);
  else run();
}

/**
 * Calls `play` the first time `trigger` reaches the bottom of the viewport.
 *
 * Starting at "top bottom" means anything `play` hides is hidden while it is
 * still at the very edge of the screen, so the reader never sees it vanish.
 */
export function onFirstView(trigger: Element, ctx: gsap.Context, play: () => void, start = "top bottom-=40") {
  ScrollTrigger.create({
    trigger,
    start,
    once: true,
    onEnter: () => ctx.add(play),
  });
}

/**
 * A scroll-triggered entrance that cannot hide content: the element is left
 * as the markup renders it until the trigger fires.
 */
export function scrollReveal(
  targets: gsap.TweenTarget,
  from: gsap.TweenVars,
  to: gsap.TweenVars,
  trigger: ScrollTrigger.Vars
) {
  return gsap.fromTo(targets, from, {
    ...to,
    immediateRender: false,
    scrollTrigger: { once: true, ...trigger },
  });
}

/** Standard entrance for copy blocks marked [data-reveal]. */
export function revealChildren(scope: HTMLElement, selector = "[data-reveal]") {
  gsap.utils.toArray<HTMLElement>(selector, scope).forEach((element) => {
    scrollReveal(
      element,
      { y: 28, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.1, ease: EASE },
      { trigger: element, start: "top bottom-=40" }
    );
  });
}

/**
 * Headings marked [data-split] rise line by line out of a mask.
 *
 * Splitting happens up front, inside the context, so it is undone on unmount;
 * the lines are only pushed below their masks at the moment the heading
 * enters, so a heading that is never reached is never hidden.
 */
export function revealHeadings(scope: HTMLElement, ctx: gsap.Context, selector = "[data-split]") {
  let disposed = false;
  afterFonts(() => {
    if (disposed) return;
    ctx.add(() => {
      gsap.utils.toArray<HTMLElement>(selector, scope).forEach((heading) => {
        const split = SplitText.create(heading, { type: "lines", mask: "lines", linesClass: "split-line" });
        onFirstView(heading, ctx, () => {
          gsap.from(split.lines, { yPercent: 108, duration: 1.15, ease: EASE, stagger: 0.09 });
        });
      });
    });
  });
  return () => {
    disposed = true;
  };
}

/**
 * Words brighten from a dim ink to full ink as the paragraph is scrolled
 * through. Dim, never invisible: if scrolling stops halfway the text is still
 * legible, and with motion off it is simply the paragraph.
 */
export function scrubWords(scope: HTMLElement, ctx: gsap.Context, selector = "[data-scrub]") {
  let disposed = false;
  afterFonts(() => {
    if (disposed) return;
    ctx.add(() => {
      gsap.utils.toArray<HTMLElement>(selector, scope).forEach((paragraph) => {
        const split = SplitText.create(paragraph, { type: "words" });
        gsap.fromTo(
          split.words,
          { opacity: 0.2 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.12,
            scrollTrigger: { trigger: paragraph, start: "top 82%", end: "bottom 42%", scrub: 0.6 },
          }
        );
      });
    });
  });
  return () => {
    disposed = true;
  };
}

export { gsap, ScrollTrigger, SplitText };
