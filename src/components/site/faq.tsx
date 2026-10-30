"use client";

// ============================================================
// Public website — questions, and the last word
// ============================================================
//
// FAQ answers describe the product as it is. Built on <details>, so every
// answer opens without JavaScript; with motion welcome, opening and closing
// are animated instead of snapping.
// ============================================================

import Link from "next/link";
import { useRef } from "react";

import { SectionHead } from "@/components/site/section-head";
import { EASE, gsap, onFirstView, revealChildren, revealHeadings, scrollReveal, useSiteMotion } from "@/components/site/motion";
import { prefersReducedMotion } from "@/lib/animation";

const FAQS = [
  {
    q: "What is Tringlo AI?",
    a: "A platform for businesses that runs AI voice agents. They call your leads one at a time or in scheduled campaigns, can answer your inbound line if you set one up, and leave behind an outcome, transcript, recording and follow-up for every call.",
  },
  {
    q: "How does the live demo work?",
    a: "Enter an Indian mobile number and agree to one automated call. The request goes straight to our calling provider, and Priya, our demo agent, calls on behalf of KhushiBot. A demo call can last up to 600 seconds, and each number can request one demo every half hour.",
  },
  {
    q: "Which calling workflows does it support?",
    a: "Single calls to any lead, campaigns uploaded from a CSV with their own calling hours, days and retry rules, callbacks scheduled at the time a customer asked for, and — optionally — an inbound line with a handoff to a person.",
  },
  {
    q: "Can I use my own voice agent?",
    a: "Yes. Each workspace connects its own Sarvam voice agent — the agent, its version, the telephony connection and the number it calls from. The voice and language are those of the agent you configure in Sarvam.",
  },
  {
    q: "Can I run more than one business from one account?",
    a: "Yes. One sign-in can hold several workspaces, each with its own agent, leads, calls, memory and settings. You choose which to open after signing in, and can switch without signing out.",
  },
  {
    q: "Can the agent hand a call over to a person?",
    a: "On an inbound line with a handoff number configured, a caller who asks for a person is transferred. When no one is available, the agent offers a callback instead of pretending to transfer.",
  },
  {
    q: "What happens to what customers say?",
    a: "Each call’s outcome, transcript and recording are kept with that workspace only. Facts carried into later calls must match the customer’s own words; sensitive topics are never stored; and a request not to be called is honoured.",
  },
];

export function Faq() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = revealHeadings(root, ctx);
    scrollReveal(
      root.querySelectorAll("[data-faq]"),
      { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.85, stagger: 0.06, ease: EASE },
      { trigger: root.querySelector("[data-faqs]"), start: "top bottom-=60" }
    );
    return stop;
  });

  /** Animates the answer open and shut, instead of letting <details> snap. */
  const toggle = (event: React.MouseEvent<HTMLElement>) => {
    const details = event.currentTarget.parentElement as HTMLDetailsElement | null;
    const body = details?.querySelector<HTMLElement>("[data-answer]");
    if (!details || !body || prefersReducedMotion()) return;
    event.preventDefault();
    // The plus turns through CSS (group-open), which already tracks the open
    // attribute; animating it here as well would add the two rotations.
    if (details.open) {
      gsap.to(body, {
        height: 0,
        opacity: 0,
        duration: 0.35,
        ease: "power2.inOut",
        onComplete: () => {
          details.open = false;
          gsap.set(body, { clearProps: "height,opacity" });
        },
      });
    } else {
      details.open = true;
      gsap.fromTo(body, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.5, ease: EASE, clearProps: "height" });
    }
  };

  return (
    <section ref={rootRef} id="faq" aria-labelledby="faq-title" className="band border-b border-stone bg-paper">
      <div className="frame grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-4">
          <SectionHead
            index="08"
            label="Questions"
            id="faq-title"
            title={
              <>
                Fair questions. <em className="accent">Straight</em> answers.
              </>
            }
            className="lg:block"
          />
          <p data-reveal className="mt-8 max-w-[22rem] text-[15px] leading-[1.65] text-ink-muted">
            Something not covered here?{" "}
            <Link href="/contact" className="text-ink underline underline-offset-4 hover:text-iris-deep">
              Ask us directly.
            </Link>
          </p>
        </div>

        <div data-faqs className="border-t border-ink lg:col-span-8">
          {FAQS.map((item) => (
            <details key={item.q} data-faq className="group border-b border-stone-deep">
              <summary
                onClick={toggle}
                className="flex cursor-pointer items-start justify-between gap-6 py-6 text-left"
              >
                <span className="serif text-[22px] leading-[1.3] text-ink md:text-[26px]">{item.q}</span>
                <span
                  data-plus
                  aria-hidden="true"
                  className="relative mt-2 h-4 w-4 shrink-0 transition-transform duration-300 group-open:rotate-45"
                >
                  <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-ink" />
                  <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-ink" />
                </span>
              </summary>
              <div data-answer className="overflow-hidden">
                <p className="max-w-[44rem] pb-7 pr-10 text-[16px] leading-[1.7] text-ink-muted">{item.a}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Closing({ signedIn }: { signedIn: boolean }) {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = revealHeadings(root, ctx);
    const line = root.querySelector("[data-underline]");
    if (line) {
      onFirstView(line, ctx, () => {
        gsap.fromTo(line, { drawSVG: "0%" }, { drawSVG: "100%", duration: 1.6, ease: "power2.inOut", delay: 0.5 });
      });
    }
    return stop;
  });

  return (
    <section ref={rootRef} id="get-started" aria-labelledby="closing-title" className="band relative overflow-hidden bg-cream">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="frame relative text-center">
        <p data-reveal className="mono-label text-ink-faint">Get started</p>
        <h2 id="closing-title" data-split className="t-display mx-auto mt-7 max-w-[15ch] text-ink">
          Start with the leads you <em className="accent">already have.</em>
        </h2>
        <svg viewBox="0 0 600 24" className="mx-auto mt-6 h-6 w-[min(600px,80%)]" aria-hidden="true">
          <path
            data-underline
            d="M4 16 C 120 4, 220 22, 330 12 S 520 6, 596 14"
            fill="none"
            stroke="var(--color-iris)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
        <p data-reveal className="t-lede mx-auto mt-8 max-w-[38rem] text-ink-muted">
          Create a workspace, connect your agent, upload a list — or hear Priya call you first.
        </p>
        <div data-reveal className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={signedIn ? "/workspaces" : "/login?mode=signup"}
            className="inline-flex h-12 items-center rounded-[4px] bg-ink px-6 text-[15px] font-medium text-cream transition-[background-color,translate] duration-300 hover:-translate-y-0.5 hover:bg-ink-soft"
          >
            {signedIn ? "Open your workspaces" : "Create a workspace"}
          </Link>
        </div>
      </div>
    </section>
  );
}
