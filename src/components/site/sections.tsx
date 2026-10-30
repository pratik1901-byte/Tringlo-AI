"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { gsap, revealChildren, scrollReveal, useSiteMotion } from "@/components/site/motion";
import { cn } from "@/lib/utils";

function SectionHead({ label, title, id, body, onInk = false }: { label: string; title: string; id: string; body?: string; onInk?: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="lg:col-span-6" data-reveal>
        <p className={cn("mono-label", onInk ? "text-cream/60" : "text-ink-faint")}>{label}</p>
        <h2 id={id} className="serif mt-4 text-[36px] leading-[44px] tracking-[-0.01em] md:text-[48px] md:leading-[56px]">
          {title}
        </h2>
      </div>
      {body && (
        <p data-reveal className={cn("self-end text-[17px] leading-7 lg:col-span-5 lg:col-start-8", onInk ? "text-cream/70" : "text-ink-muted")}>
          {body}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Dashboard showcase
// ------------------------------------------------------------

const TABS = ["Overview", "Results", "Follow-ups"] as const;
type Tab = (typeof TABS)[number];

function SampleTag() {
  return <span className="mono-label rounded-full border border-stone-deep px-2 py-0.5 text-ink-faint">Sample data</span>;
}

function OverviewScreen() {
  const tiles = [
    ["Calls today", "24"],
    ["Connected", "15"],
    ["Interested", "4"],
    ["Follow-ups due", "6"],
  ];
  const bars = [6, 9, 7, 12, 10, 14, 11, 16, 13, 18, 15, 24];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-[4px] border border-stone bg-paper px-4 py-3">
            <p className="mono-label text-ink-faint">{label}</p>
            <p className="serif mt-1 text-[34px] leading-10 text-ink">{value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-[4px] border border-stone bg-paper p-4">
        <p className="mono-label text-ink-faint">Calls per day</p>
        <svg viewBox="0 0 480 120" className="mt-3 h-auto w-full" aria-hidden="true">
          {bars.map((value, index) => (
            <rect key={index} data-bar-chart x={index * 40 + 8} y={112 - value * 4.2} width="24" height={value * 4.2} fill={index === bars.length - 1 ? "var(--color-iris)" : "var(--color-ink)"} />
          ))}
          <line x1="0" y1="112.5" x2="480" y2="112.5" stroke="var(--color-stone-deep)" />
        </svg>
      </div>
    </div>
  );
}

function ResultsScreen() {
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
      <ul className="divide-y divide-stone rounded-[4px] border border-stone bg-paper">
        {[
          ["Ananya R.", "Interested", "bg-lime text-ink border-ink"],
          ["Bharat S.", "Call back", "bg-cream text-ink border-ink"],
          ["Chitra M.", "No answer", "bg-cream text-ink-muted border-stone"],
          ["Dev K.", "Not interested", "bg-cream text-ink-muted border-stone"],
        ].map(([name, status, tone]) => (
          <li key={name} className="flex items-center justify-between px-4 py-3 text-[14px]">
            <span className="text-ink">{name}</span>
            <span className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", tone)}>{status}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-[4px] border border-stone bg-paper p-4 text-[14px]">
        <p className="font-medium text-ink">Ananya R. · 0:47</p>
        <p className="mt-2 leading-6 text-ink-muted">Liked the storytelling module; price is a concern for now. Will decide with her brother; asked for a callback tomorrow at 5 PM.</p>
        <div className="mt-4 flex items-center gap-3 rounded-[4px] border border-stone px-3 py-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[10px] text-cream" aria-hidden="true">▶</span>
          <span className="h-px flex-1 bg-stone-deep" />
          <span className="mono-label text-ink">MP3</span>
        </div>
      </div>
    </div>
  );
}

function FollowUpsScreen() {
  return (
    <ul className="divide-y divide-stone rounded-[4px] border border-stone bg-paper">
      {[
        ["Ananya R.", "Tomorrow, 5:00 PM", "Requested by customer"],
        ["Bharat S.", "Tomorrow, 11:30 AM", "Requested by customer"],
        ["Chitra M.", "Today, 4:15 PM", "Retry after no answer"],
      ].map(([name, when, why]) => (
        <li key={name} className="grid grid-cols-[1fr_auto] gap-2 px-4 py-3.5 text-[14px] md:grid-cols-[1fr_1fr_auto]">
          <span className="text-ink">{name}</span>
          <span className="hidden text-ink-muted md:block">{why}</span>
          <span className="font-mono text-[12.5px] text-ink">{when}</span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardShowcase() {
  const rootRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  useSiteMotion(rootRef, (root) => revealChildren(root));

  const select = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    const screen = screenRef.current;
    if (screen && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo(screen, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" });
    }
  };

  return (
    <section ref={rootRef} aria-labelledby="dash-title" className="border-b border-stone bg-cream">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <SectionHead
          id="dash-title"
          label="The workspace"
          title="Everything a call produced, in one place."
          body="An overview of the day, every call with its summary, transcript and recording, and the queue of callbacks still to come — on desktop and on your phone."
        />
        <div data-reveal className="mt-12 rounded-lg border border-ink bg-parchment">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink px-4 py-3">
            <div role="tablist" aria-label="Workspace screens" className="flex gap-1">
              {TABS.map((name) => (
                <button
                  key={name}
                  role="tab"
                  type="button"
                  id={`dash-tab-${name}`}
                  aria-selected={tab === name}
                  aria-controls="dash-panel"
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => select(name)}
                  onKeyDown={(event) => {
                    const index = TABS.indexOf(tab);
                    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
                      select(next);
                      document.getElementById(`dash-tab-${next}`)?.focus();
                    }
                  }}
                  className={cn("h-10 rounded-[4px] px-4 text-[14px] transition-colors", tab === name ? "bg-ink text-cream" : "text-ink-muted hover:text-ink")}
                >
                  {name}
                </button>
              ))}
            </div>
            <SampleTag />
          </div>
          <div ref={screenRef} id="dash-panel" role="tabpanel" aria-labelledby={`dash-tab-${tab}`} className="p-4 md:p-6">
            {tab === "Overview" && <OverviewScreen />}
            {tab === "Results" && <ResultsScreen />}
            {tab === "Follow-ups" && <FollowUpsScreen />}
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// Workspaces
// ------------------------------------------------------------

export function Workspaces() {
  const rootRef = useRef<HTMLElement | null>(null);
  useSiteMotion(rootRef, (root) => {
    revealChildren(root);
    scrollReveal(
      root.querySelectorAll("[data-ws]"),
      { x: (index: number) => (index === 0 ? -30 : 30), opacity: 0 },
      { x: 0, opacity: 1, duration: 1, ease: "power3.out" },
      { trigger: root.querySelector("[data-ws-grid]"), start: "top 75%" }
    );
    scrollReveal(
      root.querySelector("[data-wall]"),
      { scaleY: 0, transformOrigin: "top center" },
      { scaleY: 1, duration: 1.2, ease: "power2.inOut" },
      { trigger: root.querySelector("[data-ws-grid]"), start: "top 75%" }
    );
  });

  const box = (name: string) => (
    <div data-ws className="overflow-hidden rounded-lg border border-ink bg-paper">
      <div className="flex items-center justify-between border-b border-ink px-5 py-3">
        <span className="text-[15px] font-medium text-ink">{name}</span>
        <span className="mono-label text-ink-faint">workspace</span>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-stone">
        {["Leads", "Calls & recordings", "Customer memory", "Follow-ups", "Agent settings", "Email alerts"].map((item) => (
          <li key={item} className="bg-paper px-5 py-3 text-[14px] text-ink-muted">{item}</li>
        ))}
      </ul>
    </div>
  );

  return (
    <section ref={rootRef} aria-labelledby="ws-title" className="border-b border-stone bg-paper">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <SectionHead
          id="ws-title"
          label="Workspaces"
          title="Each business sees only its own calls."
          body="A workspace holds one business’s leads, calls, recordings and customer memory. Every request is checked against the signed-in workspace on the server, so nothing crosses from one to another — not even for the same phone number."
        />
        <div data-ws-grid className="relative mt-14 grid gap-6 md:grid-cols-[1fr_24px_1fr]">
          {box("Your business")}
          <div className="relative hidden md:block" aria-hidden="true">
            <div data-wall className="absolute inset-y-0 left-1/2 w-px bg-ink" />
            <span className="mono-label absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-paper px-1 py-2 text-ink [writing-mode:vertical-rl]">
              no shared data
            </span>
          </div>
          {box("Another business")}
        </div>
        <ul data-reveal className="mt-12 grid gap-px overflow-hidden rounded-lg border border-stone bg-stone md:grid-cols-3">
          {[
            ["Private sign-in", "Sessions live in a secure, http-only cookie. Signing out ends the session on the server, not just in the browser."],
            ["Account center", "Change your name, workspace name, email (confirmed by a code sent to the new address) and password."],
            ["Your own alerts", "Each workspace chooses where interested-lead alerts and the daily summary are emailed."],
          ].map(([title, body]) => (
            <li key={title} className="bg-paper p-6">
              <h3 className="text-[16px] font-medium text-ink">{title}</h3>
              <p className="mt-2 text-[15px] leading-6 text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// Use cases
// ------------------------------------------------------------

const USE_CASES = [
  { title: "Qualifying new enquiries", agent: "Calls each new lead, learns what they need, their timeline and budget signals.", you: "A ranked list of who is interested and why." },
  { title: "Keeping callback promises", agent: "Calls back at the exact time the customer asked, with the earlier conversation in hand.", you: "No “we’ll call you tomorrow” forgotten." },
  { title: "Re-engaging old leads", agent: "Works through a past list politely, recording objections and do-not-call requests.", you: "A clean list, and the reasons people said no." },
  { title: "Following up after events", agent: "Calls attendees or enquirers while the interest is recent and routes the keen ones to you.", you: "Interested contacts emailed to you the same day." },
];

export function UseCases() {
  const rootRef = useRef<HTMLElement | null>(null);
  useSiteMotion(rootRef, (root) => {
    revealChildren(root);
    scrollReveal(
      root.querySelectorAll("[data-case]"),
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.9, stagger: 0.1, ease: "power3.out" },
      { trigger: root.querySelector("[data-cases]"), start: "top 80%" }
    );
  });
  return (
    <section ref={rootRef} id="use-cases" aria-labelledby="uc-title" className="border-b border-stone bg-cream">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <SectionHead id="uc-title" label="Use cases" title="Where a patient, consistent caller helps." />
        <ul data-cases className="mt-12 grid gap-px overflow-hidden rounded-lg border border-ink bg-ink md:grid-cols-2">
          {USE_CASES.map((item, index) => (
            <li key={item.title} data-case className="group bg-cream p-7 transition-colors duration-300 hover:bg-paper">
              <div className="flex items-baseline justify-between">
                <h3 className="serif text-[28px] leading-9 text-ink">{item.title}</h3>
                <span className="mono-label text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <dl className="mt-5 space-y-3 text-[15px] leading-6">
                <div className="grid grid-cols-[96px_1fr] gap-3">
                  <dt className="mono-label pt-1 text-ink-faint">The agent</dt>
                  <dd className="text-ink-muted">{item.agent}</dd>
                </div>
                <div className="grid grid-cols-[96px_1fr] gap-3">
                  <dt className="mono-label pt-1 text-ink-faint">You get</dt>
                  <dd className="text-ink">{item.you}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// Technology & reliability
// ------------------------------------------------------------

const TECH = [
  ["Voice", "Calls are placed and conducted by Sarvam AI’s conversational voice agents, configured with your company and product details."],
  ["Verified webhooks", "Call results arrive through a webhook that must carry a secret token. A repeated delivery is recognised and changes nothing."],
  ["Grounded memory", "A remembered fact must match words the customer actually said in the transcript. Guesses about mood or intent are discarded."],
  ["Sensitive topics excluded", "Health, religion, caste, politics and identity numbers are never stored in memory, even when mentioned."],
  ["Calling hours", "Calls, callbacks and retries wait for the window and timezone you set."],
  ["Do-not-call", "A request not to be called suppresses the lead and cancels anything scheduled for it."],
  ["Recordings", "Kept privately on the server and served only to the owning workspace, as MP3."],
  ["Secrets stay server-side", "Provider keys, webhook tokens and mail credentials are never sent to the browser."],
];

export function Technology() {
  const rootRef = useRef<HTMLElement | null>(null);
  useSiteMotion(rootRef, (root) => {
    revealChildren(root);
    scrollReveal(
      root.querySelectorAll("[data-tech]"),
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.7, stagger: 0.05, ease: "power2.out" },
      { trigger: root.querySelector("[data-tech-grid]"), start: "top 80%" }
    );
  });
  return (
    <section ref={rootRef} id="technology" aria-labelledby="tech-title" className="border-b border-stone bg-paper">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <SectionHead
          id="tech-title"
          label="Technology & reliability"
          title="Built to be checked, not taken on trust."
          body="The parts that matter when real customers are being called — and what each one actually does."
        />
        <dl data-tech-grid className="mt-12 grid gap-px overflow-hidden rounded-lg border border-stone bg-stone sm:grid-cols-2 lg:grid-cols-4">
          {TECH.map(([title, body]) => (
            <div key={title} data-tech className="bg-paper p-6">
              <dt className="flex items-center gap-2 text-[16px] font-medium text-ink">
                <span className="h-1.5 w-1.5 bg-iris" aria-hidden="true" />
                {title}
              </dt>
              <dd className="mt-2 text-[14.5px] leading-6 text-ink-muted">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// Closing call to action
// ------------------------------------------------------------

export function ClosingCta({ signedIn }: { signedIn: boolean }) {
  const rootRef = useRef<HTMLElement | null>(null);
  useSiteMotion(rootRef, (root) => {
    scrollReveal(
      root.querySelector("[data-cta-line]"),
      { drawSVG: "0%" },
      { drawSVG: "100%", duration: 1.6, ease: "power2.inOut" },
      { trigger: root, start: "top 75%" }
    );
    revealChildren(root);
  });
  return (
    <section ref={rootRef} aria-labelledby="cta-title" className="relative overflow-hidden bg-cream">
      <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="absolute inset-x-0 top-10 h-24 w-full" aria-hidden="true">
        <path data-cta-line d="M0 60 H380 L410 20 L440 100 L470 40 L500 80 L520 60 H1200" fill="none" stroke="var(--color-stone-deep)" strokeWidth="1.2" />
      </svg>
      <div className="relative mx-auto max-w-[1320px] px-5 pb-28 pt-40 text-center md:px-8">
        <h2 data-reveal id="cta-title" className="serif mx-auto max-w-3xl text-[40px] leading-[48px] tracking-[-0.015em] md:text-[56px] md:leading-[64px]">
          Start with the list of leads you already have.
        </h2>
        <p data-reveal className="mx-auto mt-5 max-w-xl text-[17px] leading-7 text-ink-muted">
          Set up a workspace, describe your business to the agent, upload a sheet, and watch the first results come in.
        </p>
        <div data-reveal className="mt-9 flex flex-wrap justify-center gap-3">
          {signedIn ? (
            <Link href="/dashboard" className="inline-flex h-11 items-center rounded-[4px] bg-ink px-5 text-[15px] font-medium text-cream hover:bg-ink-soft">
              Open your workspace
            </Link>
          ) : (
            <Link href="/login?mode=signup" className="inline-flex h-11 items-center rounded-[4px] bg-ink px-5 text-[15px] font-medium text-cream hover:bg-ink-soft">
              Create a workspace
            </Link>
          )}
          <Link href="/contact" className="inline-flex h-11 items-center rounded-[4px] border border-ink px-5 text-[15px] font-medium text-ink transition-colors hover:bg-ink hover:text-cream">
            Talk to us
          </Link>
        </div>
      </div>
    </section>
  );
}
