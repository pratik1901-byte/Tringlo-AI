"use client";

// ============================================================
// Public website — the two ways to call
// ============================================================
//
// Single calls and campaigns are different jobs, so they get visibly
// different halves: a light, small-scale picture for one lead right now, and
// a dark, pipeline-shaped one for a list on a schedule. Every feature listed
// is one the product implements; the figures in the pictures are examples.
// ============================================================

import { useRef } from "react";
import { Check } from "lucide-react";

import { SectionHead } from "@/components/site/section-head";
import { EASE, gsap, onFirstView, revealChildren, revealHeadings, scrollReveal, useSiteMotion } from "@/components/site/motion";

const SINGLE = [
  "Call any lead from the Leads page",
  "Uses this workspace’s own voice agent",
  "Result attached to the lead when the call ends",
  "A requested callback is scheduled for you",
];

const CAMPAIGN = [
  "Upload leads as a CSV — every row checked before launch",
  "Calling hours, days and timezone",
  "Retries on busy or no answer, at an interval you set",
  "Pause, resume or cancel at any time",
  "Progress and outcomes as calls complete",
  "Leads who asked not to be called are skipped",
];

const STATUSES = ["Queued", "Calling", "Connected", "Outcome saved"];

export function CallingModes() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = revealHeadings(root, ctx);
    const q = gsap.utils.selector(root);

    scrollReveal(
      q("[data-half]"),
      { y: 60, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.2, stagger: 0.15, ease: EASE },
      { trigger: q("[data-halves]")[0], start: "top bottom-=60" }
    );

    // Single call: the status walks through a call's life, then rests on the
    // saved outcome — the point of the picture.
    const status = root.querySelector<HTMLElement>("[data-status]");
    const dot = root.querySelector<HTMLElement>("[data-status-dot]");
    const single = root.querySelector("[data-single]");
    if (status && single) {
      onFirstView(single, ctx, () => {
        const tl = gsap.timeline({ delay: 0.5 });
        STATUSES.forEach((label, i) => {
          tl.to(status, { opacity: 0, y: -6, duration: 0.18, ease: "power1.in" }, i === 0 ? 0 : "+=0.75")
            .call(() => {
              status.textContent = label;
              if (dot) dot.style.background = i === STATUSES.length - 1 ? "var(--color-lime)" : "var(--color-iris)";
            })
            .fromTo(status, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
        });
      });
    }

    // Campaign: the pipeline lights up stage by stage, and the progress bar
    // fills as the last stage arrives.
    const pipeline = root.querySelector("[data-pipeline]");
    if (pipeline) {
      onFirstView(pipeline, ctx, () => {
        gsap.timeline({ delay: 0.3 })
          .from(q("[data-node]"), { opacity: 0, x: -12, duration: 0.55, stagger: 0.14, ease: EASE })
          .from(q("[data-node-link]"), { scaleX: 0, duration: 0.4, stagger: 0.14, ease: "power2.out" }, 0.1)
          .fromTo(q("[data-progress]"), { scaleX: 0 }, { scaleX: 0.62, duration: 1.6, ease: "power2.out" }, "-=0.2");
      });
    }

    return stop;
  });

  return (
    <section ref={rootRef} id="calling" aria-labelledby="calling-title" className="band border-b border-stone bg-cream">
      <div className="frame">
        <SectionHead
          index="03"
          label="Outbound calling"
          id="calling-title"
          title={
            <>
              One lead now, or <em className="accent">{"a whole list"}</em> on a schedule.
            </>
          }
          lede="Both use the same agent, the same conversation and the same record at the end. What changes is how many calls, and when."
        />

        <div data-halves className="mt-[clamp(56px,7vw,96px)] grid overflow-hidden rounded-[14px] border border-ink lg:grid-cols-2">
          {/* ---------------- single ---------------- */}
          <div data-half data-single className="flex min-w-0 flex-col bg-paper p-6 md:p-10">
            <p className="mono-label text-ink-faint">Single call</p>
            <h3 className="serif mt-4 text-[34px] leading-[1.1] text-ink md:text-[40px]">One lead, right now.</h3>
            <p className="mt-4 max-w-[28rem] text-[16px] leading-[1.65] text-ink-muted">
              Add a lead or open one you already have, and press call. The configured agent rings them straight away.
            </p>

            <div className="mt-9 rounded-[8px] border border-stone bg-cream" aria-hidden="true">
              <div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-stone px-5 py-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-ink">Rohan Mehta</p>
                  <p className="text-[13px] tabular-nums text-ink-faint">+91 98•••• ••210</p>
                </div>
                <span className="inline-flex h-9 items-center rounded-[4px] bg-ink px-3.5 text-[13px] font-medium text-cream">Call now</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="mono-label text-ink-faint">Status</span>
                <span className="flex items-center gap-2 text-[14px] text-ink">
                  <span data-status-dot className="h-2 w-2 rounded-full" style={{ background: "var(--color-lime)" }} />
                  <span data-status>Outcome saved</span>
                </span>
              </div>
            </div>

            <ul className="mt-9 space-y-3">
              {SINGLE.map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-6 text-ink">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-iris-deep" strokeWidth={2.4} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* ---------------- campaign ---------------- */}
          <div data-half className="on-ink flex min-w-0 flex-col bg-ink p-6 text-cream md:p-10">
            <p className="mono-label text-cream/50">Campaign</p>
            <h3 className="serif mt-4 text-[34px] leading-[1.1] md:text-[40px]">A whole list, on a schedule.</h3>
            <p className="mt-4 max-w-[30rem] text-[16px] leading-[1.65] text-cream/70">
              Upload the leads, set when calls may happen and what to retry, and launch. Calls go out inside the window
              and outcomes arrive as they finish.
            </p>

            <div data-pipeline className="mt-9 rounded-[8px] border border-cream/15 p-5" aria-hidden="true">
              <ol className="flex items-center gap-2">
                {["CSV", "Checked", "Submitted", "Calling"].map((label, i, all) => (
                  <li key={label} className="flex flex-1 items-center gap-2">
                    <span
                      data-node
                      className={`flex-1 rounded-[4px] border px-2 py-2 text-center text-[12px] ${
                        i === all.length - 1 ? "border-lime/70 text-lime" : "border-cream/20 text-cream/80"
                      }`}
                    >
                      {label}
                    </span>
                    {i < all.length - 1 && <span data-node-link className="h-px w-3 origin-left bg-cream/30" />}
                  </li>
                ))}
              </ol>
              <div className="mt-5 flex items-center justify-between text-[12px] text-cream/55">
                <span>Mon – Fri · 10:00 – 18:00</span>
                <span>Retry busy ×2</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream/10">
                <span data-progress className="block h-full w-full origin-left rounded-full bg-lime" style={{ transform: "scaleX(0.62)" }} />
              </div>
            </div>

            <ul className="mt-9 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {CAMPAIGN.map((item) => (
                <li key={item} className="flex gap-3 text-[15px] leading-6 text-cream/90">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-lime" strokeWidth={2.4} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-5 text-[12px] text-ink-faint">Names, numbers and settings in these pictures are examples.</p>
      </div>
    </section>
  );
}
