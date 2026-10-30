"use client";

// ============================================================
// Public website — the opening
// ============================================================
//
// Two full-screen openings, layered over the site without touching it:
//
//   welcome — the first load of a browsing session: twelve greetings, each in
//             its own script, rolling one into the next, then the logo.
//   reload  — any reload inside the same session: a waveform rolling while
//             the page finishes loading, settling, then the logo.
//
// Both end the same way: the logo blooms where the eye already is, and the
// overlay lifts like a curtain, with the page's own entrance starting as it
// goes rather than after.
//
// Which one plays (if either) is decided before first paint by the inline
// script in the site layout, which writes `data-site-intro` on <html>. CSS
// keeps this markup hidden unless that attribute is there, so a browser that
// never runs the script — or one where this module fails to load — simply
// shows the website. The overlay is decorative and aria-hidden throughout.
// ============================================================

import { useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/site/header";
import { gsap, registerSiteGsap } from "@/components/site/motion";
import { prefersReducedMotion } from "@/lib/animation";

/** In the order asked for, each in its own script and nothing else. */
const GREETINGS = [
  "Hello",
  "नमस्ते",
  "ನಮಸ್ಕಾರ",
  "नमस्कार",
  "നമസ്കാരം",
  "নমস্কার",
  "வணக்கம்",
  "నమస్కారం",
  "નમસ્તે",
  "ਸਤ ਸ੍ਰੀ ਅਕਾਲ",
  "ନମସ୍କାର",
  "নমস্কাৰ",
];

/** How far a greeting travels, as a share of its own height: enough to clear
 *  the padded mask completely, so no part of the next one is ever showing. */
const ROLL = 180;

/** One roll from a greeting to the next. The leaving and arriving greetings
 *  share this time and this curve, so they stay a full roll apart. */
const ROLL_TIME = 0.28;
const ROLL_EASE = "power2.inOut";

/**
 * How long each greeting rests once it has arrived. A cadence, not a metronome:
 * it lingers on the first, quickens through the middle, and eases off again
 * before the logo, so the sequence breathes like an introduction rather than
 * ticking like a slideshow.
 */
const REST = [0.2, 0.08, 0.05, 0.03, 0.02, 0.02, 0.02, 0.02, 0.03, 0.05, 0.08, 0.14];

/** Softens a greeting at the edges of its travel, like motion blur. */
const BLUR = "blur(5px)";

const BAR_COUNT = 56;
const BAR_STEP = 6;
const BAR_WIDTH = 2.6;

/** Tapers the waveform toward both ends, so it reads as one shape. */
const bell = (i: number) => Math.sin((Math.PI * (i + 0.5)) / BAR_COUNT);

/** The calm pattern the waveform settles into before the logo appears. */
const settledHeight = (i: number) => 0.07 + 0.42 * bell(i) * (0.55 + 0.45 * Math.cos(i * 0.9));

/** Set once the opening has finished, so a remount never replays it. */
let played = false;

/**
 * True while an opening is still covering the page — false once it has begun
 * to lift away. Parts of the page that hold their own entrance for the
 * opening (the hero, the side rail) wait on this, so they start as the
 * curtain rises instead of behind it.
 */
export function introCovering(): boolean {
  const html = document.documentElement;
  return html.hasAttribute("data-site-intro") && !html.hasAttribute("data-site-intro-leaving");
}

/** The attributes worth watching to know when introCovering() changes. */
export const INTRO_ATTRIBUTES = ["data-site-intro", "data-site-intro-leaving"];

export function SiteIntro() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const html = document.documentElement;
    const mode = html.getAttribute("data-site-intro");

    /** Hands the website back: the attributes go, the markup goes with them. */
    const release = () => {
      html.removeAttribute("data-site-intro-leaving");
      html.removeAttribute("data-site-intro");
      played = true;
      setDone(true);
    };

    if (!mode) return;
    if (!root || played) {
      release();
      return;
    }

    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number, run: () => void) => {
      timers.push(setTimeout(run, ms));
    };
    let removeLoad: (() => void) | undefined;
    let removeTick: (() => void) | undefined;

    // Reduced motion: no sequence at all, just the logo, briefly.
    if (prefersReducedMotion()) {
      root.setAttribute("data-static", "");
      wait(950, release);
      return () => timers.forEach(clearTimeout);
    }

    let ctx: gsap.Context | undefined;
    try {
      registerSiteGsap();
      ctx = gsap.context(() => {
        const q = gsap.utils.selector(root);
        const stage = q("[data-intro-stage]");
        const mark = q("[data-intro-mark]");
        const badge = q("[data-intro-mark] .brand-badge");
        const logo = q("[data-intro-mark] .brand-logo");
        const rule = q("[data-intro-rule]");
        const status = root.querySelector<HTMLElement>("[data-intro-status]");

        gsap.set(root, { clipPath: "inset(0% 0% 0% 0%)" });

        /**
         * The curtain. The overlay's lower edge rises and the page shows from
         * the bottom up; the logo drifts up and away ahead of it. Part-way
         * through, the page is told it is on show, so its own entrance meets
         * the curtain instead of waiting for it.
         */
        const leave = () => {
          gsap
            .timeline({ onComplete: release })
            .to(stage, { y: -32, opacity: 0, duration: 0.55, ease: "power2.in" }, 0)
            .to(root, { clipPath: "inset(0% 0% 100% 0%)", duration: 0.95, ease: "expo.inOut" }, 0.05)
            .call(() => html.setAttribute("data-site-intro-leaving", ""), undefined, 0.36);
        };

        /** The mark pops in, the wordmark wipes on beside it, the rule draws.
         *  `speed` lets the reload, which should be brief, play it quicker. */
        const signOff = (hold: number, speed = 1) =>
          gsap
            .timeline()
            .timeScale(speed)
            .set(mark, { opacity: 1 })
            .fromTo(
              badge,
              { scale: 0.45, rotate: -14, opacity: 0 },
              { scale: 1, rotate: 0, opacity: 1, duration: 0.7, ease: "back.out(1.9)" },
              0
            )
            .fromTo(
              logo,
              { clipPath: "inset(0% 100% 0% 0%)", x: -10 },
              { clipPath: "inset(0% 0% 0% 0%)", x: 0, duration: 0.8, ease: "power3.out" },
              0.14
            )
            .fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: 0.6, ease: "expo.out" }, 0.24)
            .call(leave, undefined, `+=${hold}`);

        if (mode === "welcome") {
          const words = q("[data-intro-word]");
          const track = q("[data-intro-progress]");
          const fill = q("[data-intro-progress-fill]");
          const master = gsap.timeline();

          // Every greeting waits below its mask, softened, until its turn.
          gsap.set(words, { yPercent: ROLL, opacity: 0, filter: BLUR });

          let at = 0.12;
          master
            .to(track, { opacity: 1, duration: 0.5, ease: "power1.out" }, 0)
            .to(words[0], { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: 0.5, ease: "expo.out" }, at);
          at += 0.5 + REST[0];

          // The roll: the greeting leaving and the one arriving move together,
          // so they stay a full roll apart and never overlap. Each softens and
          // fades at the edge of its travel, which reads as motion, not a cut.
          for (let i = 1; i < words.length; i += 1) {
            master
              .to(words[i - 1], { yPercent: -ROLL, opacity: 0, filter: BLUR, duration: ROLL_TIME, ease: ROLL_EASE }, at)
              .to(words[i], { yPercent: 0, opacity: 1, filter: "blur(0px)", duration: ROLL_TIME, ease: ROLL_EASE }, at);
            at += ROLL_TIME + REST[i];
          }

          master
            .to(words[words.length - 1], { yPercent: -ROLL, opacity: 0, filter: BLUR, duration: 0.4, ease: "power2.in" }, at)
            // The hairline fills across exactly the time the greetings take.
            .fromTo(fill, { scaleX: 0 }, { scaleX: 1, duration: at + 0.2, ease: "none" }, 0)
            .to(track, { opacity: 0, duration: 0.35, ease: "power1.in" }, at + 0.1)
            .add(signOff(0.22), at + 0.12);
        } else {
          const bars = q("[data-intro-bar]");
          const waveEl = q("[data-intro-wave]");
          gsap.set(bars, { transformOrigin: "50% 50%", scaleY: 0.04 });
          gsap.set(waveEl, { opacity: 1 });

          // One continuous wave rolling through the bars, drawn every frame
          // from a single phase — so it moves as one smooth shape, never as
          // fifty-six bars jittering independently. `amp` brings it in, `calm`
          // morphs it into the settled pattern, `flat` lays it down to a line.
          const setters = bars.map((bar) => gsap.quickSetter(bar, "scaleY"));
          const wave = { phase: 0, amp: 0, calm: 0, flat: 0 };
          const draw = (_time: number, deltaTime: number) => {
            wave.phase += deltaTime * 0.0062;
            for (let i = 0; i < setters.length; i += 1) {
              const travelling = 0.5 + 0.5 * Math.sin(wave.phase - i * 0.3);
              const live = 0.05 + wave.amp * bell(i) * (0.2 + 0.8 * travelling);
              const shaped = live * (1 - wave.calm) + settledHeight(i) * wave.calm;
              setters[i](shaped * (1 - wave.flat) + 0.03 * wave.flat);
            }
          };
          gsap.ticker.add(draw);
          removeTick = () => gsap.ticker.remove(draw);

          gsap
            .timeline()
            .to(wave, { amp: 1, duration: 0.85, ease: "power2.out" }, 0)
            .fromTo(status, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.18);

          let ended = false;
          /** The waveform comes to rest, lies down to a line, and the logo
           *  takes its place. */
          const settle = () => {
            if (ended) return;
            ended = true;
            gsap
              .timeline()
              .to(wave, { calm: 1, duration: 0.4, ease: "power2.inOut" }, 0)
              .to(status, { opacity: 0, y: -6, duration: 0.22, ease: "power1.in" }, 0.05)
              .call(() => {
                if (status) status.textContent = "Ready";
              })
              .to(status, { opacity: 1, y: 0, duration: 0.28, ease: "power2.out" })
              .to(wave, { flat: 1, duration: 0.32, ease: "power3.inOut" }, 0.45)
              .to(waveEl, { opacity: 0, duration: 0.24, ease: "power1.in" }, 0.6)
              .call(() => removeTick?.())
              .add(signOff(0.15, 1.25), 0.68);
          };

          // Driven by the page being ready, not by a fixed wait — with a floor
          // so the waveform is never a flicker, and a ceiling so a resource
          // that never arrives cannot trap anyone behind it.
          const ready =
            document.readyState === "complete"
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  const onLoad = () => resolve();
                  window.addEventListener("load", onLoad, { once: true });
                  removeLoad = () => window.removeEventListener("load", onLoad);
                });
          const floor = new Promise<void>((resolve) => wait(900, () => resolve()));
          void Promise.all([ready, floor]).then(settle);
          wait(2200, settle);
        }
      }, root);
    } catch {
      // GSAP could not start: the website should not be held up for it.
      removeTick?.();
      release();
      return () => timers.forEach(clearTimeout);
    }

    return () => {
      timers.forEach(clearTimeout);
      removeLoad?.();
      removeTick?.();
      ctx?.revert();
    };
  }, []);

  if (done) return null;

  return (
    <div ref={rootRef} className="site-intro">
      <div data-intro-stage className="site-intro-stage" aria-hidden="true">
        {/* welcome */}
        <div className="site-intro-greetings">
          {GREETINGS.map((word, i) => (
            <span key={i} className="site-intro-line">
              <span data-intro-word className="site-intro-word">
                {word}
              </span>
            </span>
          ))}
        </div>

        {/* reload */}
        <div data-intro-wave className="site-intro-wave">
          <svg viewBox={`0 0 ${BAR_COUNT * BAR_STEP} 100`} preserveAspectRatio="none" className="site-intro-wave-svg">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <rect
                key={i}
                data-intro-bar
                x={i * BAR_STEP}
                y={0}
                width={BAR_WIDTH}
                height={100}
                rx={BAR_WIDTH / 2}
                fill={i % 9 === 4 ? "var(--color-iris)" : "var(--color-ink)"}
                opacity={i % 9 === 4 ? 0.9 : 0.75}
              />
            ))}
          </svg>
          <p data-intro-status className="site-intro-status mono-label">
            Preparing your experience
          </p>
        </div>

        <div data-intro-mark className="site-intro-mark">
          <Wordmark />
          <span data-intro-rule className="site-intro-rule" />
        </div>
      </div>

      <span data-intro-progress className="site-intro-progress" aria-hidden="true">
        <span data-intro-progress-fill className="site-intro-progress-fill" />
      </span>
    </div>
  );
}
