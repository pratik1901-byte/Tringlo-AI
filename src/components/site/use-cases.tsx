"use client";

// ============================================================
// Public website — use cases
// ============================================================
//
// The same platform doing different jobs. A tab list on the left, the chosen
// job on the right. Proper tabs: arrow keys move between them, and only the
// chosen panel is exposed to assistive technology.
//
// Every panel occupies the same grid cell, so the section is always as tall
// as its tallest panel and switching never moves the page under the reader.
// Inbound and handoff are marked as needing setup, because they do.
// ============================================================

import { useRef, useState } from "react";

import { SectionHead } from "@/components/site/section-head";
import { EASE, gsap, revealChildren, revealHeadings, scrollReveal, useSiteMotion } from "@/components/site/motion";
import { prefersReducedMotion } from "@/lib/animation";

const CASES = [
  {
    id: "sales",
    tab: "Outbound sales",
    agent: "Introduces your product to new leads, answers their questions from your company details, and finds out whether there is real interest.",
    you: "A list of who is interested — and the reasons the others are not.",
    exchange: [
      ["Agent", "We help homeowners plan modular kitchens. Is that something you’re looking at?"],
      ["Customer", "Maybe — what does a typical one cost?"],
    ],
    uses: ["Single calls", "Campaigns"],
  },
  {
    id: "qualify",
    tab: "Lead qualification",
    agent: "Learns what each lead needs and how soon, in a short conversation rather than a questionnaire, and records the next step.",
    you: "Interest and a next step on every lead, ready to sort.",
    exchange: [
      ["Agent", "Is this for this year, or further out?"],
      ["Customer", "This year. We’re moving in June."],
    ],
    uses: ["Campaigns", "Outcomes"],
  },
  {
    id: "callbacks",
    tab: "Callbacks",
    agent: "Calls back at the exact time the customer asked for, inside your calling hours, with the earlier conversation in hand.",
    you: "No “call me tomorrow at five” left on a sticky note.",
    exchange: [
      ["Agent", "You asked me to call at five — is now still good?"],
      ["Customer", "Yes, perfect timing."],
    ],
    uses: ["Follow-ups", "Memory"],
  },
  {
    id: "reengage",
    tab: "Re-engaging old lists",
    agent: "Works politely through a past list as a campaign, recording objections and do-not-call requests as it goes.",
    you: "A clean list, and an honest record of why people said no.",
    exchange: [
      ["Agent", "You enquired with us last spring — is that still of interest?"],
      ["Customer", "Not really, please don’t call again."],
    ],
    uses: ["Campaigns", "Do-not-call"],
  },
  {
    id: "inbound",
    tab: "Inbound enquiries",
    needsSetup: true,
    agent: "Answers your number within business hours, greets callers already in your records by name, and helps with what they called about.",
    you: "Every inbound call recorded, summarised and searchable like an outbound one.",
    exchange: [
      ["Agent", "Hello Priyanka, thanks for calling back. How can I help?"],
      ["Caller", "I wanted to check the installation date."],
    ],
    uses: ["Inbound line"],
  },
  {
    id: "handoff",
    tab: "Handing over to a person",
    needsSetup: true,
    agent: "When a caller asks for a person, transfers them to the handoff number you set — or offers a callback when no one is available.",
    you: "The agent handles the routine; your team gets the calls that need them.",
    exchange: [
      ["Caller", "Can I speak to someone about the contract?"],
      ["Agent", "Of course — I’ll put you through to the team now."],
    ],
    uses: ["Inbound line", "Handoff"],
  },
];

export function UseCases() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(0);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const panelsRef = useRef<Array<HTMLDivElement | null>>([]);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = revealHeadings(root, ctx);
    scrollReveal(
      root.querySelectorAll("[data-tab]"),
      { x: -16, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: EASE },
      { trigger: root.querySelector("[data-tablist]"), start: "top bottom-=60" }
    );
    scrollReveal(
      root.querySelector("[data-panels]"),
      { y: 40, opacity: 0 },
      { y: 0, opacity: 1, duration: 1.1, ease: EASE },
      { trigger: root.querySelector("[data-panels]"), start: "top bottom-=60" }
    );
    return stop;
  });

  const choose = (next: number) => {
    if (next === active) return;
    const previous = active;
    setActive(next);
    const outgoing = panelsRef.current[previous];
    const incoming = panelsRef.current[next];
    if (!incoming || prefersReducedMotion()) return;
    if (outgoing) gsap.to(outgoing, { autoAlpha: 0, y: -10, duration: 0.25, ease: "power1.in", overwrite: true });
    gsap.fromTo(incoming, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.6, ease: EASE, delay: 0.1, overwrite: true });
    gsap.fromTo(
      incoming.querySelectorAll("[data-p]"),
      { y: 12, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.55, stagger: 0.06, ease: EASE, delay: 0.18, overwrite: true }
    );
  };

  const onKey = (event: React.KeyboardEvent, index: number) => {
    const last = CASES.length - 1;
    const target =
      event.key === "ArrowDown" || event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowUp" || event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;
    event.preventDefault();
    choose(target);
    tabsRef.current[target]?.focus();
  };

  return (
    <section ref={rootRef} id="use-cases" aria-labelledby="uc-title" className="band border-b border-stone bg-parchment">
      <div className="frame">
        <SectionHead
          index="05"
          label="Use cases"
          id="uc-title"
          title={
            <>
              One platform. <em className="accent">Different</em> conversations.
            </>
          }
          lede="The agent, the record and the follow-up stay the same. What changes is who it calls and what the call is for."
        />

        <div className="mt-[clamp(56px,7vw,96px)] grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div
            data-tablist
            role="tablist"
            aria-label="Use cases"
            aria-orientation="vertical"
            className="-mx-5 flex min-w-0 gap-2 overflow-x-auto px-5 pb-2 lg:col-span-4 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0"
          >
            {CASES.map((item, i) => {
              const selected = i === active;
              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    tabsRef.current[i] = node;
                  }}
                  data-tab
                  role="tab"
                  id={`uc-tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls={`uc-panel-${item.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => choose(i)}
                  onKeyDown={(event) => onKey(event, i)}
                  className={`group relative flex shrink-0 items-center gap-4 rounded-[6px] border px-4 py-3 text-left transition-colors duration-300 lg:rounded-none lg:border-0 lg:border-t lg:border-ink/12 lg:py-5 lg:pl-5 lg:pr-0 ${
                    selected ? "border-ink bg-cream lg:bg-transparent" : "border-stone-deep hover:border-ink/40"
                  }`}
                >
                  <span className={`mono-label hidden tabular-nums lg:inline ${selected ? "text-iris-deep" : "text-ink-faint"}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`serif whitespace-nowrap text-[17px] transition-colors duration-300 lg:whitespace-normal lg:text-[26px] lg:leading-8 ${
                      selected ? "text-ink" : "text-ink-muted group-hover:text-ink"
                    }`}
                  >
                    {item.tab}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 bottom-3 top-3 hidden w-[3px] bg-iris-deep transition-transform duration-500 lg:block ${
                      selected ? "scale-y-100" : "scale-y-0"
                    }`}
                    style={{ transformOrigin: "center" }}
                  />
                </button>
              );
            })}
          </div>

          <div data-panels className="stack min-w-0 lg:col-span-8">
            {CASES.map((item, i) => {
              const selected = i === active;
              return (
                <div
                  key={item.id}
                  ref={(node) => {
                    panelsRef.current[i] = node;
                  }}
                  role="tabpanel"
                  id={`uc-panel-${item.id}`}
                  aria-labelledby={`uc-tab-${item.id}`}
                  aria-hidden={!selected}
                  inert={!selected}
                  className={`min-w-0 rounded-[14px] border border-ink bg-paper p-6 md:p-10 ${selected ? "visible" : "invisible"}`}
                >
                  <div data-p className="flex flex-wrap items-center gap-3">
                    <h3 className="serif text-[32px] leading-[1.1] text-ink md:text-[40px]">{item.tab}</h3>
                    {item.needsSetup && (
                      <span className="mono-label rounded-[4px] bg-lime px-2 py-1 text-ink">When configured</span>
                    )}
                  </div>

                  <dl className="mt-8 grid gap-6 md:grid-cols-2">
                    <div data-p>
                      <dt className="mono-label text-ink-faint">The agent</dt>
                      <dd className="mt-2 text-[16px] leading-[1.65] text-ink-muted">{item.agent}</dd>
                    </div>
                    <div data-p>
                      <dt className="mono-label text-ink-faint">You get</dt>
                      <dd className="serif mt-2 text-[22px] leading-[1.35] text-ink">{item.you}</dd>
                    </div>
                  </dl>

                  <div data-p className="mt-8 rounded-[8px] border border-stone bg-cream p-5">
                    <p className="mono-label text-ink-faint">Example exchange</p>
                    <ol className="mt-3 space-y-2 text-[15px] leading-6">
                      {item.exchange.map(([who, line], k) => (
                        <li key={k} className="grid grid-cols-[96px_1fr] gap-3">
                          <span className={`mono-label pt-1 ${who === "Agent" ? "text-iris-deep" : "text-ink-faint"}`}>{who}</span>
                          <span className={who === "Agent" ? "text-ink" : "text-ink-muted"}>{line}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <p data-p className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-faint">
                    <span className="mono-label mr-1">Uses</span>
                    {item.uses.map((use) => (
                      <span key={use} className="rounded-[4px] border border-stone-deep px-2 py-0.5 text-ink-muted">
                        {use}
                      </span>
                    ))}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
