"use client";

import { useCallback, useRef, useState } from "react";

import { ScrollTrigger, gsap, registerSiteGsap, useSiteMotion } from "@/components/site/motion";

type Step = { title: string; body: string; art: React.ReactNode };

const stroke = { fill: "none", stroke: "var(--color-ink)", strokeWidth: 1.25, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const STEPS: Step[] = [
  {
    title: "Lead",
    body: "Upload a CSV or Excel sheet. Each row becomes a lead with a name, a number and your notes. Indian numbers are normalised, so the same person is recognised however the number was typed.",
    art: (
      <g>
        {[0, 1, 2, 3].map((row) => (
          <g key={row} transform={`translate(20 ${24 + row * 26})`}>
            <rect data-draw width="200" height="18" rx="2" {...stroke} stroke="var(--color-stone-deep)" />
            <line data-draw x1="10" y1="9" x2={row === 1 ? 110 : 80} y2="9" {...stroke} />
            <line data-draw x1="130" y1="9" x2="186" y2="9" {...stroke} stroke="var(--color-ink-faint)" />
          </g>
        ))}
        <path data-draw d="M226 57h24" {...stroke} />
        <rect x="252" y="45" width="20" height="24" rx="2" fill="var(--color-lime)" stroke="var(--color-ink)" />
      </g>
    ),
  },
  {
    title: "AI call",
    body: "Within the calling hours you set, the voice agent dials each lead and introduces your business using the company and product details you configured — nothing it hasn’t been given.",
    art: (
      <g>
        <circle data-draw cx="60" cy="70" r="26" {...stroke} />
        <path data-draw d="M50 62c0 12 8 20 20 20" {...stroke} />
        {[40, 62, 84].map((r) => (
          <path key={r} data-draw d={`M${60 + r} ${70 - r * 0.55} a ${r} ${r} 0 0 1 0 ${r * 1.1}`} {...stroke} stroke="var(--color-iris)" />
        ))}
        <rect x="200" y="50" width="70" height="40" rx="4" fill="var(--color-ink)" />
        <text x="235" y="75" textAnchor="middle" fontSize="11" fill="var(--color-cream)" fontFamily="var(--font-geist-mono)">AGENT</text>
      </g>
    ),
  },
  {
    title: "Conversation",
    body: "The agent listens and answers in real time. Every call keeps its transcript, speaker by speaker, and a recording you can play or download as MP3.",
    art: (
      <g>
        <rect data-draw x="20" y="24" width="150" height="34" rx="4" {...stroke} />
        <line data-draw x1="34" y1="41" x2="140" y2="41" {...stroke} stroke="var(--color-ink-faint)" />
        <rect data-draw x="110" y="70" width="160" height="34" rx="4" {...stroke} stroke="var(--color-iris)" />
        <line data-draw x1="124" y1="87" x2="250" y2="87" {...stroke} stroke="var(--color-iris)" />
        <path data-draw d="M20 128 q 10 -14 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 10 0" {...stroke} />
      </g>
    ),
  },
  {
    title: "Understanding",
    body: "After the call, the agent reports what it learned: interest, objections, requirements, budget and timeline signals, and the agreed next step — in structured fields, not a paragraph to reread.",
    art: (
      <g>
        <path data-draw d="M30 20 h-10 v110 h10" {...stroke} />
        {["interest", "objection", "next step", "timeline"].map((label, index) => (
          <g key={label} transform={`translate(34 ${26 + index * 26})`}>
            <text x="0" y="12" fontSize="11" fill="var(--color-ink-faint)" fontFamily="var(--font-geist-mono)">{label.toUpperCase()}</text>
            <line data-draw x1="104" y1="8" x2={index === 0 ? 170 : 230} y2="8" {...stroke} />
          </g>
        ))}
        <path data-draw d="M250 20 h10 v110 h-10" {...stroke} />
      </g>
    ),
  },
  {
    title: "Result",
    body: "The lead’s status updates the moment the call ends. An interested lead can send you an email right away, and the day’s calls arrive as a summary at 7 PM.",
    art: (
      <g>
        <rect x="20" y="30" width="118" height="30" rx="15" fill="var(--color-lime)" stroke="var(--color-ink)" />
        <text x="79" y="49" textAnchor="middle" fontSize="12" fill="var(--color-ink)">Interested</text>
        <rect data-draw x="160" y="22" width="110" height="80" rx="4" {...stroke} />
        <path data-draw d="M160 26 l55 40 l55 -40" {...stroke} />
        <line data-draw x1="20" y1="90" x2="138" y2="90" {...stroke} stroke="var(--color-stone-deep)" />
        <line data-draw x1="20" y1="110" x2="110" y2="110" {...stroke} stroke="var(--color-stone-deep)" />
      </g>
    ),
  },
  {
    title: "Follow-up",
    body: "Asked to call back tomorrow at five? It is scheduled for then, kept inside your calling hours, and placed automatically — with what was said last time.",
    art: (
      <g>
        <circle data-draw cx="80" cy="70" r="44" {...stroke} />
        <line data-draw x1="80" y1="70" x2="80" y2="40" {...stroke} />
        <line data-draw x1="80" y1="70" x2="104" y2="82" {...stroke} stroke="var(--color-iris)" />
        <path data-draw d="M140 70 H 250" {...stroke} strokeDasharray="4 5" />
        <rect x="220" y="56" width="50" height="28" rx="4" fill="var(--color-ink)" />
        <text x="245" y="74" textAnchor="middle" fontSize="11" fill="var(--color-cream)" fontFamily="var(--font-geist-mono)">5:00</text>
      </g>
    ),
  },
];

export function Walkthrough() {
  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLOListElement | null>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const [index, setIndex] = useState(0);

  // Pinned, scroll-scrubbed horizontal track — desktop, motion welcome only.
  useSiteMotion(rootRef, (root) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const media = gsap.matchMedia();
    media.add("(min-width: 1024px)", () => {
      viewport.style.overflowX = "hidden";
      const distance = () => track.scrollWidth - viewport.clientWidth;

      const tween = gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: () => `+=${distance()}`,
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
          anticipatePin: 1,
          onUpdate: (self) => setIndex(Math.round(self.progress * (STEPS.length - 1))),
        },
      });
      triggerRef.current = tween.scrollTrigger ?? null;

      // Each panel draws its diagram as it slides into view.
      gsap.utils.toArray<HTMLElement>("[data-panel]", track).forEach((panel) => {
        gsap.from(panel.querySelectorAll("[data-draw]"), {
          drawSVG: "0%",
          duration: 1,
          ease: "power2.out",
          stagger: 0.05,
          scrollTrigger: { trigger: panel, containerAnimation: tween, start: "left 75%", once: true },
        });
      });

      return () => {
        viewport.style.overflowX = "";
        triggerRef.current = null;
        gsap.set(track, { clearProps: "transform" });
      };
    });
    return () => media.revert();
  });

  const go = useCallback((next: number) => {
    const target = Math.max(0, Math.min(STEPS.length - 1, next));
    const trigger = triggerRef.current;
    if (trigger) {
      // Pinned: scroll the page to the point where that step is centred.
      registerSiteGsap();
      const y = trigger.start + (trigger.end - trigger.start) * (target / (STEPS.length - 1));
      window.scrollTo({ top: y, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    const viewport = viewportRef.current;
    const panel = trackRef.current?.children[target] as HTMLElement | undefined;
    if (viewport && panel) {
      // Keep the page gutter to the left of the card, as snapping does.
      const gutter = parseFloat(getComputedStyle(viewport).scrollPaddingLeft) || 0;
      viewport.scrollTo({ left: panel.offsetLeft - gutter, behavior: "smooth" });
    }
    setIndex(target);
  }, []);

  const onNativeScroll = () => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || triggerRef.current) return;
    const panelWidth = (track.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
    setIndex(Math.min(STEPS.length - 1, Math.round(viewport.scrollLeft / (panelWidth + 24))));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!triggerRef.current) return; // Native scroller: arrow keys already scroll it.
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(index - 1);
    }
  };

  return (
    <section ref={rootRef} id="how-it-works" aria-labelledby="how-title" className="relative flex min-h-screen flex-col justify-center overflow-hidden border-b border-stone bg-cream py-20 lg:py-0">
      <div className="mx-auto grid w-full max-w-[1320px] gap-6 px-5 md:px-8 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <p className="mono-label text-ink-faint">How it works · six steps</p>
          <h2 id="how-title" className="serif mt-4 text-[36px] leading-[44px] tracking-[-0.01em] md:text-[48px] md:leading-[56px]">
            From a spreadsheet row to a callback, without anyone dialling.
          </h2>
        </div>
        <div className="flex items-center gap-4 lg:col-span-5 lg:justify-end">
          <p className="mono-label tabular-nums text-ink" aria-live="polite">
            <span className="sr-only">Step </span>
            {String(index + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")} · {STEPS[index].title}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous step" className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-ink text-ink transition-colors hover:bg-ink hover:text-cream disabled:border-stone disabled:text-stone-deep disabled:hover:bg-transparent">
              <span aria-hidden="true">←</span>
            </button>
            <button type="button" onClick={() => go(index + 1)} disabled={index === STEPS.length - 1} aria-label="Next step" className="flex h-11 w-11 items-center justify-center rounded-[4px] border border-ink text-ink transition-colors hover:bg-ink hover:text-cream disabled:border-stone disabled:text-stone-deep disabled:hover:bg-transparent">
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-[1320px] px-5 md:px-8" aria-hidden="true">
        <div className="h-px w-full bg-stone">
          <div className="h-px bg-ink transition-[width] duration-300" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      <div
        ref={viewportRef}
        onScroll={onNativeScroll}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="region"
        aria-label="How it works, six steps. Scroll sideways or use the arrow keys."
        className="h-track mt-10 w-full scroll-pl-5 overflow-x-auto pb-4 md:scroll-pl-8"
      >
        <ol ref={trackRef} className="flex w-max gap-6 px-5 md:px-8 lg:pl-[max(2rem,calc((100vw-1320px)/2+2rem))] lg:pr-[20vw]">
          {STEPS.map((step, stepIndex) => (
            <li
              key={step.title}
              data-panel
              aria-label={`Step ${stepIndex + 1} of ${STEPS.length}: ${step.title}`}
              className="flex w-[min(84vw,500px)] flex-col rounded-lg border border-stone bg-paper"
            >
              <div className="flex items-center justify-between border-b border-stone px-6 py-3">
                <span className="mono-label text-ink-faint">{String(stepIndex + 1).padStart(2, "0")}</span>
                {stepIndex < STEPS.length - 1 && <span className="mono-label text-ink-faint" aria-hidden="true">→ {STEPS[stepIndex + 1].title}</span>}
              </div>
              <div className="blueprint border-b border-stone px-6 py-6">
                <svg viewBox="0 0 290 150" className="h-auto w-full" aria-hidden="true">
                  {step.art}
                </svg>
              </div>
              <div className="flex-1 px-6 pb-7 pt-6">
                <h3 className="serif text-[30px] leading-[36px]">{step.title}</h3>
                <p className="mt-3 text-[15px] leading-6 text-ink-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
