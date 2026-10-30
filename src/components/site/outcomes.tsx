"use client";

// ============================================================
// Public website — from conversation to record
// ============================================================
//
// What the customer said on the left; what was written down on the right.
// Each phrase that becomes a field is marked with the same number as that
// field, and as the section comes into view the phrases are highlighted in
// turn while their fields light up — so the reader sees *where* each part of
// the record came from. Numbers rather than drawn connector lines, because a
// marker survives every screen width and a line between two moving boxes
// does not.
//
// The conversation is an example. The fields are the ones Tringlo records.
// ============================================================

import { useRef } from "react";

import { SectionHead } from "@/components/site/section-head";
import { EASE, gsap, onFirstView, revealChildren, revealHeadings, scrollReveal, useSiteMotion } from "@/components/site/motion";

function Mark({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <span data-mark={n} className="highlight text-ink">
      {children}
      <sup className="mono-label ml-0.5 text-[10px] text-iris-deep">{n}</sup>
    </span>
  );
}

const RECORD = [
  { n: 1, label: "Interest", value: "Interested" },
  { n: 2, label: "Objection", value: "Price compared with one other supplier" },
  { n: 3, label: "Next step", value: "Callback" },
  { n: 4, label: "Callback", value: "Thursday, 11:00 AM" },
  { n: 5, label: "Remembered", value: "Renovation starts in March" },
];

const RULES = [
  {
    title: "Only what was said",
    body: "A fact is kept only when it matches the customer’s own words in the transcript. Guesses about mood or intent are discarded.",
  },
  {
    title: "Never the sensitive things",
    body: "Health, religion, caste, politics and identity numbers are not stored in memory, even when they come up.",
  },
  {
    title: "Corrections replace",
    body: "When a customer corrects something, the old fact is replaced rather than kept alongside it.",
  },
];

export function Outcomes() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = revealHeadings(root, ctx);
    const q = gsap.utils.selector(root);

    scrollReveal(
      q("[data-panel]"),
      { y: 48, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.15, stagger: 0.14, ease: EASE },
      { trigger: q("[data-panels]")[0], start: "top bottom-=60" }
    );
    scrollReveal(
      q("[data-rule]"),
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.9, stagger: 0.1, ease: EASE },
      { trigger: q("[data-rules]")[0], start: "top bottom-=40" }
    );

    // Phrase by phrase: highlight it, then light its field.
    const panels = q("[data-panels]")[0];
    if (panels) {
      onFirstView(panels, ctx, () => {
        const tl = gsap.timeline({ delay: 0.9 });
        RECORD.forEach((item) => {
          const mark = root.querySelector(`[data-mark="${item.n}"]`);
          const field = root.querySelector(`[data-field="${item.n}"]`);
          if (mark) tl.fromTo(mark, { backgroundSize: "0% 0.42em" }, { backgroundSize: "100% 0.42em", duration: 0.55, ease: "power2.out" });
          if (field) {
            tl.fromTo(field, { opacity: 0.25, x: 10 }, { opacity: 1, x: 0, duration: 0.5, ease: EASE }, "-=0.25").fromTo(
              field.querySelector("[data-field-bar]"),
              { scaleY: 0 },
              { scaleY: 1, duration: 0.4, ease: "power2.out" },
              "<"
            );
          }
        });
      }, "top 75%");
    }
    return stop;
  });

  return (
    <section ref={rootRef} id="outcomes" aria-labelledby="outcomes-title" className="band border-b border-stone bg-cream">
      <div className="frame">
        <SectionHead
          index="04"
          label="Outcomes & memory"
          id="outcomes-title"
          title={
            <>
              Every conversation becomes a <em className="accent">record.</em>
            </>
          }
          lede="Not a recording you have to sit through. The parts that matter are written down, attached to the lead, and carried into the next call."
        />

        <div data-panels className="mt-[clamp(56px,7vw,96px)] grid gap-6 lg:grid-cols-12 lg:gap-8">
          <figure data-panel className="min-w-0 rounded-[12px] border border-stone bg-paper p-6 md:p-9 lg:col-span-7">
            <figcaption className="mono-label flex items-center justify-between text-ink-faint">
              <span>Transcript</span>
              <span>Example</span>
            </figcaption>
            <ol className="mt-7 space-y-5 text-[16px] leading-[1.75]">
              <li className="grid grid-cols-[96px_1fr] gap-4">
                <span className="mono-label pt-1 text-iris-deep">Agent</span>
                <span className="text-ink-muted">Is the kitchen still something you’re planning this year?</span>
              </li>
              <li className="grid grid-cols-[96px_1fr] gap-4">
                <span className="mono-label pt-1 text-ink-faint">Customer</span>
                <span className="text-ink-muted">
                  <Mark n={1}>Yes, very much</Mark> — <Mark n={5}>the renovation starts in March</Mark>. Honestly I’m{" "}
                  <Mark n={2}>comparing your price with one other supplier</Mark>.
                </span>
              </li>
              <li className="grid grid-cols-[96px_1fr] gap-4">
                <span className="mono-label pt-1 text-iris-deep">Agent</span>
                <span className="text-ink-muted">That makes sense. Would it help if someone walked you through the quote?</span>
              </li>
              <li className="grid grid-cols-[96px_1fr] gap-4">
                <span className="mono-label pt-1 text-ink-faint">Customer</span>
                <span className="text-ink-muted">
                  <Mark n={3}>Yes, call me back</Mark> — <Mark n={4}>Thursday around eleven</Mark> is best.
                </span>
              </li>
            </ol>
          </figure>

          <div data-panel className="on-ink flex min-w-0 flex-col rounded-[12px] bg-ink p-6 text-cream md:p-9 lg:col-span-5">
            <p className="mono-label flex items-center justify-between text-cream/50">
              <span>Saved to the lead</span>
              <span>When the call ends</span>
            </p>
            <dl className="mt-7 flex-1 space-y-4">
              {RECORD.map((item) => (
                <div key={item.n} data-field={item.n} className="relative grid grid-cols-[136px_1fr] gap-4 pl-4">
                  <span data-field-bar aria-hidden="true" className="absolute bottom-0.5 left-0 top-0.5 w-[2px] origin-top bg-lime" />
                  <dt className="mono-label pt-0.5 text-cream/50">
                    <sup className="mr-1 text-lime">{item.n}</sup>
                    {item.label}
                  </dt>
                  <dd className="text-[15px] leading-6 text-cream">{item.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-8 flex flex-wrap gap-2 border-t border-cream/15 pt-6 text-[12.5px] text-cream/75">
              {["Outcome", "Disposition", "Summary", "Transcript", "Recording"].map((tag) => (
                <span key={tag} className="rounded-[4px] border border-cream/20 px-2.5 py-1">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        <ul data-rules className="mt-[clamp(56px,6vw,88px)] grid gap-10 border-t border-ink/15 pt-10 md:grid-cols-3">
          {RULES.map((rule) => (
            <li key={rule.title} data-rule>
              <h3 className="serif text-[24px] leading-8 text-ink">{rule.title}</h3>
              <p className="mt-3 text-[15px] leading-[1.65] text-ink-muted">{rule.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
