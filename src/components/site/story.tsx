"use client";

// ============================================================
// Public website — how it works (the signature section)
// ============================================================
//
// Five steps, the loop every call runs. Two presentations of one markup:
//
//   Default — mobile, reduced motion, no JavaScript: a list where each step
//   carries its own picture. Complete and readable on its own.
//
//   Enhanced — a large screen with motion welcome: the pictures move into one
//   sticky stage beside the list. As each step reaches the middle of the
//   screen the stage changes scene, the step brightens, and a rail fills to
//   show how far through the loop the reader is.
//
// It uses CSS position: sticky rather than a ScrollTrigger pin, so the page
// scrolls exactly as it normally would — nothing is hijacked, and there is no
// pin spacer to throw off the measurements of the sections below.
// ============================================================

import { useLayoutEffect, useRef } from "react";

import { SectionHead } from "@/components/site/section-head";
import {
  DESKTOP_MOTION,
  EASE,
  MOTION_OK,
  ScrollTrigger,
  gsap,
  registerSiteGsap,
  revealChildren,
  revealHeadings,
  scrollReveal,
} from "@/components/site/motion";

const STEPS = [
  {
    title: "Set up the agent",
    body: "Give the workspace its company profile — who you are, what you sell, what a call is for, your FAQs and pricing — and connect the Sarvam voice agent that will speak for it.",
    facts: ["Company and product profile", "Call objective and FAQs", "Your own agent, version and number"],
  },
  {
    title: "Start a call, or a campaign",
    body: "Call one lead right now from the Leads page. Or upload a CSV of leads and launch a campaign with its own calling hours, days and retry rules.",
    facts: ["One-click single calls", "CSV upload, checked before launch", "Calling window and retries"],
  },
  {
    title: "The agent holds the conversation",
    body: "Before dialling, the agent is told who it is calling and what was said last time. It answers from your company details, and a request not to be called is respected.",
    facts: ["Context from earlier calls", "Answers from your details", "Do-not-call honoured"],
  },
  {
    title: "The outcome is captured",
    body: "When the call ends, its outcome, interest, disposition and summary — with the transcript and recording — are attached to the lead, ready to review.",
    facts: ["Outcome and interest", "Transcript and recording", "Call history per lead"],
  },
  {
    title: "Follow-ups happen on time",
    body: "A callback the customer asked for is scheduled and placed within your calling hours, with the earlier conversation in hand. Interested leads can be emailed to you.",
    facts: ["Callbacks at the asked-for time", "Within your calling hours", "Interested leads by email"],
  },
];

// ------------------------------------------------------------
// The five scenes. Each is drawn for an ink background, so the same scene
// sits in the sticky stage on desktop and in its own ink card on mobile.
// Everything shown is an illustration of a real screen, labelled as such.
// ------------------------------------------------------------

function Field({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div data-s className={wide ? "col-span-2" : ""}>
      <p className="mono-label text-cream/45">{label}</p>
      <p className="mt-1.5 rounded-[4px] border border-cream/15 bg-cream/[0.04] px-3 py-2.5 text-[14px] leading-5 text-cream">
        {value}
      </p>
    </div>
  );
}

function SceneProfile() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field label="Company" value="Northwind Interiors" />
      <Field label="Product" value="Modular kitchens" />
      <Field label="Objective" value="Book a design consultation" wide />
      <Field label="FAQ" value="Do you install outside the city? — Yes, within 40 km." wide />
      <div data-s className="col-span-2 flex items-center justify-between rounded-[4px] border border-lime/50 bg-lime/[0.07] px-3 py-2.5">
        <span className="text-[13px] text-cream/80">Voice agent connected</span>
        <span className="mono-label text-lime">Ready</span>
      </div>
    </div>
  );
}

function SceneLaunch() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div data-s className="rounded-[6px] border border-cream/15 p-4">
          <p className="mono-label text-cream/45">Single call</p>
          <p className="mt-2 text-[14px] text-cream">Ananya R.</p>
          <span className="mt-3 inline-flex h-8 items-center rounded-[4px] bg-cream px-3 text-[12px] font-medium text-ink">Call now</span>
        </div>
        <div data-s className="rounded-[6px] border border-lime/60 bg-lime/[0.06] p-4">
          <p className="mono-label text-lime">Campaign</p>
          <p className="mt-2 text-[14px] text-cream">leads.csv</p>
          <p className="mt-3 text-[12px] text-cream/60">Rows checked before launch</p>
        </div>
      </div>
      <dl data-s className="divide-y divide-cream/10 rounded-[6px] border border-cream/15 text-[13px]">
        {[
          ["Calling hours", "10:00 – 18:00"],
          ["Days", "Mon – Fri"],
          ["Retry when", "Busy · No answer"],
          ["Pace", "Set per campaign"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between px-4 py-2.5">
            <dt className="text-cream/55">{k}</dt>
            <dd className="text-cream">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SceneConversation() {
  const bars = Array.from({ length: 36 }, (_, i) => Math.round(20 + 76 * Math.abs(Math.sin(i * 1.3) * Math.cos(i * 0.41))));
  return (
    <div className="space-y-5">
      <div data-s className="rounded-[4px] border border-dashed border-cream/25 px-3 py-2.5">
        <p className="mono-label text-cream/45">Told to the agent before dialling</p>
        <p className="mt-1 text-[13px] leading-5 text-cream/85">Asked last time about delivery dates. Prefers calls after 5 PM.</p>
      </div>
      <div data-s className="flex h-12 items-center gap-[3px]" aria-hidden="true">
        {bars.map((h, i) => (
          <span key={i} className="w-full rounded-full bg-cream" style={{ height: `${h}%`, opacity: 0.75 }} />
        ))}
      </div>
      <ol className="space-y-2.5 text-[14px] leading-[21px]">
        <li data-s className="grid grid-cols-[72px_1fr] gap-3">
          <span className="mono-label pt-0.5 text-lime">Agent</span>
          <span className="text-cream">Last time you asked about delivery dates — we can now install within three weeks.</span>
        </li>
        <li data-s className="grid grid-cols-[72px_1fr] gap-3">
          <span className="mono-label pt-0.5 text-cream/45">Customer</span>
          <span className="text-cream/75">That works. Can someone come and measure?</span>
        </li>
      </ol>
    </div>
  );
}

function SceneOutcome() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          ["Outcome", "Connected"],
          ["Interest", "Interested"],
          ["Disposition", "Wants a visit"],
          ["Duration", "3m 12s"],
        ].map(([k, v]) => (
          <div key={k} data-s className="rounded-[6px] border border-cream/15 px-4 py-3">
            <p className="mono-label text-cream/45">{k}</p>
            <p className="mt-1.5 text-[15px] text-cream">{v}</p>
          </div>
        ))}
      </div>
      <div data-s className="rounded-[6px] border border-cream/15 px-4 py-3">
        <p className="mono-label text-cream/45">Summary</p>
        <p className="mt-1.5 text-[14px] leading-[21px] text-cream/85">
          Happy with the three-week timeline. Asked for someone to measure the kitchen.
        </p>
      </div>
      <div data-s className="flex gap-3 text-[12px]">
        <span className="rounded-[4px] border border-cream/20 px-2.5 py-1.5 text-cream/80">Transcript</span>
        <span className="rounded-[4px] border border-cream/20 px-2.5 py-1.5 text-cream/80">Recording · MP3</span>
      </div>
    </div>
  );
}

function SceneFollowUp() {
  return (
    <div className="space-y-3">
      {[
        { when: "Today", what: "First call", state: "Done", tone: "text-cream/50" },
        { when: "Tue · 5:00 PM", what: "Callback, as the customer asked", state: "Scheduled", tone: "text-lime" },
        { when: "Tue · 5:00 PM", what: "Interested lead emailed to your team", state: "On interest", tone: "text-cream/70" },
      ].map((row, i) => (
        <div key={i} data-s className="flex flex-col gap-1.5 rounded-[6px] border border-cream/15 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
          <span className="mono-label shrink-0 text-cream/45 sm:w-[104px]">{row.when}</span>
          <span className="min-w-0 flex-1 text-[14px] text-cream">{row.what}</span>
          <span className={`mono-label shrink-0 ${row.tone}`}>{row.state}</span>
        </div>
      ))}
      <p data-s className="pt-2 text-[13px] leading-5 text-cream/55">
        Placed inside your calling hours. If the customer later asks not to be called, anything scheduled is cancelled.
      </p>
    </div>
  );
}

const SCENES = [SceneProfile, SceneLaunch, SceneConversation, SceneOutcome, SceneFollowUp];

function SceneFrame({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <div className="on-ink flex h-full flex-col rounded-[12px] bg-ink p-6 text-cream md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <span className="mono-label text-cream/45">{STEPS[index].title}</span>
        <span className="mono-label text-cream/35">Example</span>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function Story() {
  const rootRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    registerSiteGsap();
    const media = gsap.matchMedia(root);

    // Every screen with motion: headings and copy come in.
    media.add(MOTION_OK, (ctx) => {
      revealChildren(root);
      return revealHeadings(root, ctx);
    });

    // Small screens with motion: each inline scene assembles as it arrives.
    media.add("(max-width: 1023px) and (prefers-reduced-motion: no-preference)", () => {
      gsap.utils.toArray<HTMLElement>("[data-inline-scene]", root).forEach((scene) => {
        scrollReveal(
          scene.querySelectorAll("[data-s]"),
          { y: 14, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.07, ease: EASE },
          { trigger: scene, start: "top bottom-=60" }
        );
      });
    });

    // Large screens with motion: the sticky stage.
    media.add(DESKTOP_MOTION, () => {
      root.setAttribute("data-enhanced", "");
      const steps = gsap.utils.toArray<HTMLElement>("[data-step]", root);
      const scenes = gsap.utils.toArray<HTMLElement>("[data-stage-scene]", root);
      const counter = root.querySelector<HTMLElement>("[data-stage-count]");
      let active = -1;

      gsap.set(scenes, { autoAlpha: 0 });

      const show = (index: number) => {
        if (index === active) return;
        const previous = active;
        active = index;
        steps.forEach((step, i) => (i === index ? step.setAttribute("data-active", "") : step.removeAttribute("data-active")));
        if (counter) counter.textContent = `${String(index + 1).padStart(2, "0")} / ${String(steps.length).padStart(2, "0")}`;
        if (previous >= 0) {
          gsap.to(scenes[previous], { autoAlpha: 0, y: index > previous ? -18 : 18, duration: 0.45, ease: "power2.in", overwrite: true });
        }
        const scene = scenes[index];
        gsap.fromTo(scene, { autoAlpha: 0, y: index > previous ? 26 : -26 }, { autoAlpha: 1, y: 0, duration: 0.75, ease: EASE, overwrite: true, delay: previous >= 0 ? 0.12 : 0 });
        gsap.fromTo(
          scene.querySelectorAll("[data-s]"),
          { y: 12, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6, stagger: 0.06, ease: EASE, delay: previous >= 0 ? 0.25 : 0.1, overwrite: true }
        );
      };

      steps.forEach((step, i) => {
        ScrollTrigger.create({
          trigger: step,
          start: "top 58%",
          end: "bottom 58%",
          onToggle: (self) => {
            if (self.isActive) show(i);
          },
        });
      });
      show(0);

      // The rail fills with progress through the whole list.
      gsap.fromTo(
        root.querySelector("[data-stage-rail]"),
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: "none",
          scrollTrigger: { trigger: root.querySelector("[data-steps]"), start: "top 58%", end: "bottom 58%", scrub: 0.5 },
        }
      );

      // Steps are taller now; everything below must be re-measured.
      ScrollTrigger.refresh();

      return () => {
        root.removeAttribute("data-enhanced");
        steps.forEach((step) => step.removeAttribute("data-active"));
      };
    });

    return () => media.revert();
  }, []);

  return (
    <section ref={rootRef} id="how-it-works" aria-labelledby="how-title" className="story band border-b border-stone bg-parchment">
      <div className="frame">
        <SectionHead
          index="02"
          label="How it works"
          id="how-title"
          title={
            <>
              Five steps. <em className="accent">One</em> phone call.
            </>
          }
          lede="Every call runs the same loop, whether it is one lead you just added or the four-hundredth row of a campaign."
        />

        <div className="mt-[clamp(56px,7vw,104px)] grid gap-12 lg:grid-cols-12 lg:gap-10">
          <ol data-steps className="min-w-0 space-y-16 lg:col-span-5 lg:space-y-0">
            {STEPS.map((step, i) => {
              const Scene = SCENES[i];
              return (
                <li key={step.title} data-step className="story-step min-w-0">
                  <div className="story-step-copy">
                    <div className="flex items-baseline gap-5">
                      <span className="serif text-[52px] italic leading-none text-iris-deep tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                      <h3 className="serif text-[30px] leading-[1.15] text-ink md:text-[34px]">{step.title}</h3>
                    </div>
                    <p className="mt-5 max-w-[30rem] text-[16px] leading-[1.7] text-ink-muted">{step.body}</p>
                    <ul className="mt-6 flex flex-wrap gap-2">
                      {step.facts.map((fact) => (
                        <li key={fact} className="rounded-[4px] border border-stone-deep bg-cream px-2.5 py-1 text-[12.5px] text-ink-muted">
                          {fact}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div data-inline-scene className="story-inline mt-8">
                    <SceneFrame index={i}>
                      <Scene />
                    </SceneFrame>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="story-stage min-w-0 lg:col-span-7 lg:col-start-6" aria-hidden="true">
            <div className="sticky top-[14vh] flex h-[72vh] max-h-[640px] gap-6 pl-6 xl:pl-10">
              <div className="relative w-px shrink-0 bg-stone-deep">
                <span data-stage-rail className="absolute inset-0 origin-top bg-ink" />
              </div>
              <div className="relative flex-1">
                <span data-stage-count className="mono-label absolute -top-7 right-0 text-ink-faint tabular-nums">
                  01 / 05
                </span>
                {SCENES.map((Scene, i) => (
                  <div key={i} data-stage-scene className="absolute inset-0">
                    <SceneFrame index={i}>
                      <Scene />
                    </SceneFrame>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
