"use client";

// ============================================================
// Public website — hero
// ============================================================
//
// Two things side by side, and the relationship between them is the point:
// on the left, what Tringlo is in one sentence; on the right, a single call
// running from the first line of conversation to the record it leaves behind.
// A visitor who reads nothing else should still see "a call happens, and
// something structured comes out of it".
//
// The call is illustrative and labelled as such — the name and dialogue are
// examples. Every field it fills in is one the product really records.
// ============================================================

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef } from "react";
import { Check, PhoneCall } from "lucide-react";

import { EASE, ScrollTrigger, SplitText, gsap, useSiteMotion } from "@/components/site/motion";
import { INTRO_ATTRIBUTES, introCovering } from "@/components/site/site-intro";

// The WebGL wave field stays: it is the site's texture, and it is quiet enough
// to sit behind type. Loaded only in the browser, and skipped for reduced motion.
const HeroWaves = dynamic(() => import("@/components/site/hero-waves"), { ssr: false });

/**
 * Bar heights for the waveform. Computed, not random, so the server and the
 * browser render exactly the same markup.
 */
const BARS = Array.from({ length: 44 }, (_, i) =>
  Math.round(18 + 78 * Math.abs(Math.sin(i * 1.71) * Math.cos(i * 0.37 + 0.6)))
);

const TRANSCRIPT = [
  { who: "Agent", text: "Hi Ananya, this is the team you enquired with last week. Is now a good time?" },
  { who: "Customer", text: "Not really — could you call me tomorrow at five?" },
  { who: "Agent", text: "Of course. Tomorrow at 5 PM, and I’ll pick up from your question on pricing." },
  { who: "Customer", text: "Perfect, thanks." },
];

/** When Ananya answers: the ring runs until here, the conversation from here. */
const PICKUP = 2.05;

const OUTCOME = [
  { label: "Interest", value: "Interested" },
  { label: "Next step", value: "Callback" },
  { label: "When", value: "Tomorrow, 5:00 PM" },
  { label: "Remembered", value: "Asked about pricing" },
];

export function Hero({ signedIn }: { signedIn: boolean }) {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root) => {
    const q = gsap.utils.selector(root);
    const heading = root.querySelector<HTMLElement>("[data-hero-title]");
    const split = heading ? SplitText.create(heading, { type: "lines", mask: "lines", linesClass: "split-line" }) : null;

    // Everything marked [data-intro] is held at opacity 0 by CSS until now.
    gsap.set(q("[data-intro]"), { opacity: 1 });

    const tl = gsap.timeline({ defaults: { ease: EASE } });
    tl.from(q("[data-hero-eyebrow]"), { y: 14, opacity: 0, duration: 0.8 }, 0.05);
    if (split) tl.from(split.lines, { yPercent: 108, duration: 1.25, stagger: 0.11 }, 0.12);
    tl.from(q("[data-hero-lede]"), { y: 20, opacity: 0, duration: 1 }, 0.55)
      .from(q("[data-hero-cta] > *"), { y: 16, opacity: 0, duration: 0.9, stagger: 0.08 }, 0.7)
      .from(q("[data-hero-facts] > *"), { opacity: 0, duration: 0.8, stagger: 0.06 }, 0.85)
      // The call card arrives as the headline settles, then plays its call.
      .from(q("[data-call-card]"), { y: 48, opacity: 0, rotate: -1.2, duration: 1.3 }, 0.35);

    // The call is placed before it is answered: it rings — tring, tring — and
    // only once Ananya picks up does the line go live and the talking begin.
    const state = root.querySelector<HTMLElement>("[data-call-state]");
    const dot = root.querySelector<HTMLElement>("[data-call-dot]");
    const clock = root.querySelector<HTMLElement>("[data-call-clock]");
    if (state) state.textContent = "Ringing";
    if (clock) clock.textContent = "00:00";
    if (dot) {
      dot.style.background = "var(--color-iris)";
      dot.style.setProperty("--pulse-rgb", "92 105 248");
    }

    tl.set(q("[data-wave]"), { opacity: 0 }, 0)
      .set(clock, { opacity: 0 }, 0)
      .fromTo(q("[data-ringing]"), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, 0.62)
      // Two rings leaving the handset, twice over — the sound, drawn.
      .fromTo(
        q("[data-ring-wave]"),
        { scale: 0.75, opacity: 0.85 },
        { scale: 2, opacity: 0, duration: 1.05, stagger: 0.34, repeat: 1, ease: "power2.out" },
        0.68
      )
      .to(q("[data-ring-icon]"), { rotate: 13, duration: 0.085, yoyo: true, repeat: 11, ease: "sine.inOut" }, 0.72)
      // Answered.
      .call(
        () => {
          if (state) state.textContent = "Live";
          if (dot) {
            dot.style.background = "var(--color-lime)";
            dot.style.removeProperty("--pulse-rgb");
          }
        },
        undefined,
        PICKUP
      )
      .to(q("[data-ringing]"), { opacity: 0, y: -12, duration: 0.38, ease: "power2.in" }, PICKUP - 0.16)
      .to(q("[data-wave]"), { opacity: 1, duration: 0.4 }, PICKUP)
      .to(clock, { opacity: 1, duration: 0.35 }, PICKUP)
      .from(q("[data-call-bar]"), { scaleY: 0.08, duration: 0.9, stagger: { each: 0.012, from: "center" } }, PICKUP)
      .from(q("[data-line]"), { y: 10, opacity: 0, duration: 0.6, stagger: 0.16 }, PICKUP + 0.2)
      .from(q("[data-outcome]"), { y: 8, opacity: 0, duration: 0.55, stagger: 0.08 }, PICKUP + 0.7)
      .from(q("[data-chip]"), { y: 14, scale: 0.94, opacity: 0, duration: 0.7, stagger: 0.12, ease: "back.out(1.6)" }, PICKUP + 0.85);

    // The call clock counts from the moment the call is answered.
    const time = { s: 0 };
    tl.to(time, {
      s: 134,
      duration: 2,
      ease: "power1.out",
      onUpdate: () => {
        if (!clock) return;
        const total = Math.round(time.s);
        clock.textContent = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
      },
    }, PICKUP);

    // The waveform keeps breathing while it is on screen, and rests when not.
    const breathe = gsap.to(q("[data-call-bar]"), {
      scaleY: () => gsap.utils.random(0.25, 1.05),
      duration: 0.42,
      ease: "sine.inOut",
      stagger: { each: 0.02, repeat: -1, yoyo: true, repeatRefresh: true },
      delay: PICKUP + 1.1,
    });
    ScrollTrigger.create({
      trigger: root,
      start: "top bottom",
      end: "bottom top",
      onToggle: (self) => (self.isActive ? breathe.resume() : breathe.pause()),
    });

    // A gentle drift of the card against the copy as the page starts to move:
    // depth, without asking the reader to do anything.
    gsap.to(q("[data-call-stack]"), {
      yPercent: -6,
      ease: "none",
      scrollTrigger: { trigger: root, start: "top top", end: "bottom top", scrub: 0.8 },
    });

    // An opening is covering the page: hold the hero at its first frame, or it
    // would play out — ring, answer and all — behind the overlay and be over
    // before anyone saw it. It starts as the overlay begins to lift, so the
    // entrance meets the curtain rather than waiting for it to clear.
    if (!introCovering()) return;
    tl.pause(0);
    breathe.pause(0);
    const watch = new MutationObserver(() => {
      if (introCovering()) return;
      watch.disconnect();
      tl.play();
      breathe.play();
    });
    watch.observe(document.documentElement, { attributes: true, attributeFilter: INTRO_ATTRIBUTES });
    return () => watch.disconnect();
  });

  return (
    <section ref={rootRef} id="top" aria-labelledby="hero-title" className="relative overflow-hidden border-b border-stone bg-cream">
      <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true">
        <HeroWaves />
      </div>

      <div className="frame relative grid items-center gap-16 pb-[clamp(72px,8vw,120px)] pt-[clamp(40px,5.5vw,88px)] lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-7">
          <p data-intro data-hero-eyebrow className="mono-label flex items-center gap-2.5 text-ink-muted">
            <span className="live-dot h-2 w-2 rounded-full bg-lime ring-1 ring-ink/15" aria-hidden="true" />
            AI voice calling for business
          </p>

          <h1 id="hero-title" data-intro data-hero-title className="t-display mt-6 text-ink">
            Your leads, called.
            <br />
            Every answer, <em className="accent">kept.</em>
          </h1>

          <p data-intro data-hero-lede className="t-lede mt-7 max-w-[36rem] text-ink-muted">
            Tringlo runs AI voice agents that phone your leads — one at a time, or a whole list on a schedule — hold the
            conversation, and turn every call into an outcome, a transcript and a follow-up your team can act on.
          </p>

          <div data-intro data-hero-cta className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={signedIn ? "/workspaces" : "/login?mode=signup"}
              className="inline-flex h-12 items-center rounded-[4px] bg-ink px-6 text-[15px] font-medium text-cream transition-[background-color,translate] duration-300 hover:-translate-y-0.5 hover:bg-ink-soft"
            >
              {signedIn ? "Open your workspaces" : "Create a workspace"}
            </Link>
          </div>

          <ul data-intro data-hero-facts className="mono-label mt-10 flex flex-wrap gap-x-6 gap-y-2 text-ink-faint">
            <li>Single calls</li>
            <li aria-hidden="true" className="hidden sm:list-item">/</li>
            <li>Scheduled campaigns</li>
            <li aria-hidden="true" className="hidden sm:list-item">/</li>
            <li>Inbound, when you want it</li>
          </ul>
        </div>

        <figure className="relative lg:col-span-5 lg:col-start-8" aria-label="An illustrative call, from conversation to recorded outcome">
          <div data-call-stack className="relative mx-auto max-w-[560px]">
            <div
              data-intro
              data-call-card
              className="relative overflow-hidden rounded-[10px] border border-ink bg-paper shadow-[0_40px_80px_-40px_rgba(23,22,20,0.45)]"
            >
              <div className="flex items-center justify-between border-b border-stone px-5 py-3.5">
                <span className="mono-label text-ink-faint">Outbound call</span>
                <span className="mono-label flex items-center gap-2 text-ink">
                  <span data-call-dot className="live-dot h-1.5 w-1.5 rounded-full bg-lime" aria-hidden="true" />
                  <span data-call-state>Live</span> <span data-call-clock className="tabular-nums">02:14</span>
                </span>
              </div>

              <div className="flex items-center gap-3 px-5 pt-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-parchment text-[13px] font-medium text-ink">
                  AR
                </span>
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">Ananya R.</p>
                  <p className="text-[13px] text-ink-faint">Campaign · Spring enquiries</p>
                </div>
              </div>

              {/* The ring and the waveform share one cell, so the card keeps its
                  height as the call is answered and nothing shifts beneath. */}
              <div className="grid px-5 pt-4" aria-hidden="true">
                <div data-ringing className="col-start-1 row-start-1 h-14 items-center gap-3.5">
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/10 text-iris-deep">
                    <span data-ring-wave className="absolute inset-0 rounded-full border border-iris/45" />
                    <span data-ring-wave className="absolute inset-0 rounded-full border border-iris/45" />
                    <PhoneCall data-ring-icon className="relative h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <span className="serif text-[21px] leading-none text-ink">Tring… tring…</span>
                </div>

                <div data-wave className="col-start-1 row-start-1 flex h-14 items-center gap-[3px]">
                  {BARS.map((height, i) => (
                    <span
                      key={i}
                      data-call-bar
                      className="w-full origin-center rounded-full bg-ink"
                      style={{ height: `${height}%`, opacity: i % 7 === 3 ? 0.35 : 0.85 }}
                    />
                  ))}
                </div>
              </div>

              <ol className="space-y-3 px-5 pb-5 pt-5">
                {TRANSCRIPT.map((line, i) => (
                  <li key={i} data-line className="grid grid-cols-[88px_1fr] gap-3 text-[14px] leading-[21px]">
                    <span className={`mono-label pt-0.5 ${line.who === "Agent" ? "text-iris-deep" : "text-ink-faint"}`}>{line.who}</span>
                    <span className={line.who === "Agent" ? "text-ink" : "text-ink-muted"}>{line.text}</span>
                  </li>
                ))}
              </ol>

              <div className="border-t border-stone bg-cream/60 px-5 py-4">
                <p className="mono-label text-ink-faint">Captured outcome</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3">
                  {OUTCOME.map((item) => (
                    <div key={item.label} data-outcome className="min-w-0">
                      <dt className="text-[12px] text-ink-faint">{item.label}</dt>
                      <dd className="truncate text-[14px] font-medium text-ink">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div
              data-intro
              data-chip
              className="absolute -bottom-5 left-5 flex items-center gap-2 rounded-[6px] bg-ink px-3.5 py-2.5 text-[13px] text-cream shadow-[0_18px_40px_-18px_rgba(23,22,20,0.6)]"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-lime text-ink">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              Callback scheduled · Tue 5:00 PM
            </div>
            <div
              data-intro
              data-chip
              className="absolute -top-12 right-2 hidden rounded-[6px] border border-stone bg-paper px-3 py-2 text-[12px] text-ink-muted shadow-[0_14px_30px_-18px_rgba(23,22,20,0.4)] sm:block"
            >
              Transcript &amp; recording saved
            </div>
          </div>
          <figcaption className="mt-10 text-center text-[12px] text-ink-faint lg:text-left">
            Illustrative call. The name and dialogue are examples, not a real customer.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
