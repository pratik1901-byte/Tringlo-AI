"use client";

import { useRef } from "react";

import { gsap, useSiteMotion } from "@/components/site/motion";

const POINTS = [
  { title: "Asked-for times are kept", body: "“Tomorrow at five” becomes a scheduled callback at that time in the customer’s timezone." },
  { title: "Inside your calling hours", body: "Callbacks and retries wait for the window you set. Nothing dials at midnight." },
  { title: "Retries when no one answers", body: "A missed callback is tried again later, a limited number of times, then left for you." },
  { title: "“Don’t call me” is final", body: "A do-not-call request suppresses the lead and cancels anything still scheduled." },
];

// Day timeline: 8:00 → 21:00 mapped onto 0..560.
const hourX = (hour: number) => 20 + ((hour - 8) / 13) * 560;

export function FollowUpSection() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root) => {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: root.querySelector("[data-fu-visual]"), start: "top 75%", end: "bottom 55%", scrub: 0.8 },
    });
    tl.from("[data-fu-quote]", { y: 16, opacity: 0, duration: 0.6 })
      .from("[data-fu-link]", { drawSVG: "0%", duration: 0.6 })
      .from("[data-fu-card]", { y: 16, opacity: 0, duration: 0.6 })
      .from("[data-fu-window]", { scaleX: 0, transformOrigin: "left center", duration: 0.8 })
      .fromTo("[data-fu-marker]", { x: hourX(11) - hourX(17) }, { x: 0, duration: 1.4, ease: "none" })
      .from("[data-fu-hand]", { rotate: -150, transformOrigin: "50% 100%", duration: 1.4, ease: "none" }, "<")
      .from("[data-fu-placed]", { scale: 0.85, opacity: 0, duration: 0.5, ease: "back.out(2)" });
  });

  return (
    <section ref={rootRef} id="follow-ups" aria-labelledby="fu-title" className="on-ink border-b border-ink bg-ink text-cream">
      <div className="blueprint-ink">
        <div className="mx-auto grid max-w-[1320px] gap-14 px-5 py-24 md:px-8 lg:grid-cols-12 lg:py-32">
          <div className="lg:col-span-5">
            <p className="mono-label text-cream/60">Automatic follow-ups</p>
            <h2 id="fu-title" className="serif mt-4 text-[36px] leading-[44px] tracking-[-0.01em] md:text-[48px] md:leading-[56px]">
              “Call me tomorrow at five” is a task, not a note.
            </h2>
            <ul className="mt-10 divide-y divide-cream/15 border-y border-cream/15">
              {POINTS.map((point) => (
                <li key={point.title} className="py-4">
                  <h3 className="text-[16px] font-medium text-cream">{point.title}</h3>
                  <p className="mt-1 text-[15px] leading-6 text-cream/70">{point.body}</p>
                </li>
              ))}
            </ul>
          </div>

          <figure data-fu-visual className="lg:col-span-6 lg:col-start-7 lg:pt-4" aria-label="A callback request becoming a scheduled call">
            <blockquote data-fu-quote className="rounded-lg border border-cream/20 bg-cream/[0.04] px-5 py-4">
              <p className="mono-label text-cream/60">Customer, on the call</p>
              <p className="serif mt-2 text-[26px] leading-[34px] text-cream">“I need to discuss it with my brother. Call me tomorrow at five.”</p>
            </blockquote>

            <svg viewBox="0 0 40 44" className="ml-8 h-11 w-10" aria-hidden="true">
              <path data-fu-link d="M20 0 V38 M13 31 L20 38 L27 31" fill="none" stroke="var(--color-lime)" strokeWidth="1.5" />
            </svg>

            <div data-fu-card className="rounded-lg border border-cream bg-cream text-ink">
              <div className="flex items-center justify-between border-b border-stone px-5 py-3">
                <span className="mono-label text-ink">Scheduled callback</span>
                <span className="mono-label text-ink-faint">follow-up</span>
              </div>
              <dl className="grid grid-cols-2 gap-4 px-5 py-4 text-[14px] sm:grid-cols-3">
                <div><dt className="mono-label text-ink-faint">When</dt><dd className="mt-1 text-ink">Tomorrow, 5:00 PM</dd></div>
                <div><dt className="mono-label text-ink-faint">Timezone</dt><dd className="mt-1 text-ink">Customer’s own</dd></div>
                <div className="col-span-2 sm:col-span-1"><dt className="mono-label text-ink-faint">Why</dt><dd className="mt-1 text-ink">Discuss with brother</dd></div>
              </dl>

              <div className="border-t border-stone px-5 pb-5 pt-4">
                <svg viewBox="0 0 600 96" className="h-auto w-full" role="img" aria-label="Timeline from 8 AM to 9 PM. Calling hours are shaded; the callback is placed at 5 PM.">
                  <line x1="20" y1="52" x2="580" y2="52" stroke="var(--color-stone-deep)" />
                  <rect data-fu-window x={hourX(10)} y="44" width={hourX(19) - hourX(10)} height="16" fill="var(--color-parchment)" stroke="var(--color-stone-deep)" />
                  <text x={hourX(10)} y="36" fontSize="11" fill="var(--color-ink-faint)" fontFamily="var(--font-geist-mono)">CALLING HOURS</text>
                  {[8, 10, 12, 14, 16, 18, 20].map((hour) => (
                    <g key={hour}>
                      <line x1={hourX(hour)} y1="64" x2={hourX(hour)} y2="70" stroke="var(--color-ink-faint)" />
                      <text x={hourX(hour)} y="86" fontSize="11" textAnchor="middle" fill="var(--color-ink-faint)" fontFamily="var(--font-geist-mono)">
                        {hour > 12 ? `${hour - 12}PM` : hour === 12 ? "12PM" : `${hour}AM`}
                      </text>
                    </g>
                  ))}
                  <g data-fu-marker>
                    <line x1={hourX(17)} y1="22" x2={hourX(17)} y2="60" stroke="var(--color-iris)" strokeWidth="2" />
                    <circle cx={hourX(17)} cy="52" r="6" fill="var(--color-iris)" />
                  </g>
                  <g data-fu-placed>
                    <rect x={hourX(17) - 128} y="8" width="118" height="24" rx="12" fill="var(--color-lime)" stroke="var(--color-ink)" />
                    <text x={hourX(17) - 69} y="24" fontSize="12" textAnchor="middle" fill="var(--color-ink)">Callback placed</text>
                  </g>
                  {/* Clock face. */}
                  <g transform="translate(560 18)">
                    <circle r="14" fill="none" stroke="var(--color-ink)" />
                    <line data-fu-hand x1="0" y1="0" x2="0" y2="-10" stroke="var(--color-ink)" strokeWidth="1.5" transform="rotate(150)" />
                  </g>
                </svg>
              </div>
            </div>
            <figcaption className="mt-3 text-[13px] text-cream/60">
              Illustrative example of a real feature. The callback carries the context from the call that asked for it.
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
