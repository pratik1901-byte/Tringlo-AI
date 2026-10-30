"use client";

// ============================================================
// Public website — what Tringlo does
// ============================================================
//
// The problem and the answer in one paragraph, set large. As the reader
// scrolls through it the words brighten from a dim ink to full ink, so the
// sentence is read at the pace it is scrolled. Below it, the three jobs the
// product does, set as a row on hairlines rather than three boxed cards.
// ============================================================

import { useRef } from "react";

import { gsap, revealChildren, scrollReveal, scrubWords, useSiteMotion } from "@/components/site/motion";

const JOBS = [
  {
    n: "01",
    title: "It calls",
    body: "Your configured voice agent places the call — to one lead from the Leads page, or to a whole list as a scheduled campaign.",
  },
  {
    n: "02",
    title: "It listens",
    body: "The agent holds the conversation using your company and product details, and answers from those rather than guessing.",
  },
  {
    n: "03",
    title: "It follows through",
    body: "The outcome, transcript and recording are saved, what the customer said is remembered, and a callback happens when they asked for one.",
  },
];

export function Statement() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = scrubWords(root, ctx);

    // The name draws its own line as the sentence is read through. Drawn by
    // default in CSS, so with motion off the word is still marked.
    const brand = root.querySelector<HTMLElement>("[data-brand]");
    if (brand) {
      gsap.fromTo(
        brand,
        { backgroundSize: "0% 0.26em" },
        {
          backgroundSize: "100% 0.26em",
          ease: "none",
          immediateRender: false,
          scrollTrigger: { trigger: brand, start: "top 78%", end: "top 54%", scrub: 0.6 },
        }
      );
    }
    scrollReveal(
      root.querySelectorAll("[data-job]"),
      { y: 36, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.1, stagger: 0.12, ease: "expo.out" },
      { trigger: root.querySelector("[data-jobs]"), start: "top bottom-=60" }
    );
    scrollReveal(
      root.querySelectorAll("[data-job-rule]"),
      { scaleX: 0 },
      { scaleX: 1, duration: 1.4, stagger: 0.12, ease: "expo.out" },
      { trigger: root.querySelector("[data-jobs]"), start: "top bottom-=60" }
    );
    return stop;
  });

  return (
    <section ref={rootRef} id="product" aria-labelledby="product-title" className="band border-b border-stone bg-cream">
      <div className="frame">
        <p data-reveal className="mono-label flex items-center gap-3 text-ink-faint">
          <span className="tabular-nums">01</span>
          <span aria-hidden="true" className="h-px w-8 bg-ink/25" />
          What Tringlo does
        </p>
        <h2 id="product-title" className="sr-only">
          What Tringlo does
        </h2>
        <p data-scrub className="t-statement mt-10 max-w-[1100px] text-ink">
          Leads rarely go cold because they said no. They go cold because nobody called back.{" "}
          <strong data-brand className="statement-brand">
            Tringlo
          </strong>{" "}
          makes the call, listens to the answer, writes down what was said — and calls again when it was asked to.
        </p>

        <ol data-jobs className="mt-[clamp(64px,8vw,120px)] grid gap-12 md:grid-cols-3 md:gap-10">
          {JOBS.map((job) => (
            <li key={job.n} data-job className="relative pt-8">
              <span data-job-rule aria-hidden="true" className="absolute left-0 top-0 h-px w-full origin-left bg-ink" />
              <div className="flex items-baseline gap-4">
                <span className="serif text-[44px] italic leading-none text-iris-deep">{job.n}</span>
                <h3 className="serif text-[30px] leading-9 text-ink">{job.title}</h3>
              </div>
              <p className="mt-5 max-w-[30rem] text-[16px] leading-[1.65] text-ink-muted">{job.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
