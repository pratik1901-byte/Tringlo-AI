"use client";

// ============================================================
// Tringlo AI — Live Clock
// ============================================================
//
// The current time, beside the theme toggle.
//
// Two decisions worth keeping:
//
//   - Nothing here is React state. The digits are written straight to the DOM
//     from GSAP's ticker, so the top bar does not re-render once a second and
//     drag the provider indicator's polling along with it.
//   - The first paint is `--:--:--` on the server and the client alike, and the
//     real time arrives on mount. A clock rendered on the server is already
//     wrong by the time it reaches the browser, and would mismatch on hydration.
//
// This shows the browser's own local time, labelled with its zone, rather than
// the calling window's zone. Tringlo dials in the window's timezone, so if an
// admin is elsewhere the two genuinely differ — better to state which one this
// is than to imply they are the same.
// ============================================================

import { useEffect, useRef } from "react";
import gsap from "gsap";

import { MOTION, prefersReducedMotion } from "@/lib/animation";

const PLACEHOLDER = "--";

/** Local zone abbreviation — "IST", "GMT+2". Empty if the browser won't say. */
function zoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function LiveClock() {
  const hoursRef = useRef<HTMLSpanElement | null>(null);
  const minutesRef = useRef<HTMLSpanElement | null>(null);
  const secondsRef = useRef<HTMLSpanElement | null>(null);
  const colonsRef = useRef<HTMLSpanElement[]>([]);
  const zoneRef = useRef<HTMLSpanElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const zone = zoneRef.current;
    if (zone) zone.textContent = zoneLabel();

    const reduced = prefersReducedMotion();
    // Last rendered value per unit, so a tween fires only on the unit that
    // actually changed — the hour does not flip every second.
    const shown = { hours: "", minutes: "", seconds: "" };

    const pad = (value: number) => String(value).padStart(2, "0");

    /** Writes one unit, animating it in only when its value changed. */
    const write = (
      element: HTMLSpanElement | null,
      value: string,
      key: keyof typeof shown
    ) => {
      if (!element || shown[key] === value) return;
      shown[key] = value;
      element.textContent = value;

      if (reduced) return;
      gsap.fromTo(
        element,
        { yPercent: -45, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          duration: MOTION.fast,
          ease: MOTION.ease,
          overwrite: "auto",
          clearProps: "transform",
        }
      );
    };

    const context = gsap.context(() => {
      const tick = () => {
        const now = new Date();
        write(hoursRef.current, pad(now.getHours()), "hours");
        write(minutesRef.current, pad(now.getMinutes()), "minutes");
        write(secondsRef.current, pad(now.getSeconds()), "seconds");
      };

      tick();

      // The ticker runs per frame, which is far more often than the clock
      // changes — `write` compares first, so all but one frame a second do
      // nothing but two string comparisons.
      gsap.ticker.add(tick);

      if (!reduced && colonsRef.current.length > 0) {
        // The separators breathe once a second. This is the only thing that
        // marks the passing of time between digit changes, and it is the reason
        // the clock reads as live rather than as a timestamp.
        gsap.to(colonsRef.current, {
          opacity: 0.25,
          duration: 0.5,
          ease: MOTION.easeInOut,
          repeat: -1,
          yoyo: true,
        });
      }

      return () => gsap.ticker.remove(tick);
    }, rootRef);

    return () => context.revert();
  }, []);

  const colonClass = "px-px text-muted-foreground";

  return (
    <div
      ref={rootRef}
      // `tabular-nums` keeps the width fixed, so neighbouring controls do not
      // shuffle sideways as the digits change.
      className="flex items-baseline gap-1.5 text-xs tabular-nums text-muted-foreground"
      // A screen reader announcing every second would be unusable; the time is
      // ambient here, and the OS clock remains the accessible source.
      aria-hidden="true"
    >
      <span className="font-medium text-foreground">
        <span ref={hoursRef} className="inline-block">
          {PLACEHOLDER}
        </span>
        <span
          ref={(node) => {
            if (node) colonsRef.current[0] = node;
          }}
          className={colonClass}
        >
          :
        </span>
        <span ref={minutesRef} className="inline-block">
          {PLACEHOLDER}
        </span>
        <span
          ref={(node) => {
            if (node) colonsRef.current[1] = node;
          }}
          className={colonClass}
        >
          :
        </span>
        <span ref={secondsRef} className="inline-block">
          {PLACEHOLDER}
        </span>
      </span>
      <span ref={zoneRef} className="text-[10px] font-medium uppercase tracking-wide" />
    </div>
  );
}
