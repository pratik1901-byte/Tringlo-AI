"use client";

import { useRef } from "react";

import { ScrollTrigger, gsap, useSiteMotion } from "@/components/site/motion";

type Node = { id: string; x: number; y: number; w?: number; title: string; sub: string; dark?: boolean; accent?: boolean };

const NODES: Node[] = [
  { id: "leads", x: 40, y: 80, title: "Leads", sub: "CSV · XLSX upload" },
  { id: "window", x: 270, y: 80, title: "Calling window", sub: "hours · timezone" },
  { id: "agent", x: 500, y: 80, title: "Voice agent", sub: "places the call", dark: true },
  { id: "webhook", x: 730, y: 80, title: "Verified webhook", sub: "token-verified" },
  { id: "outcome", x: 960, y: 80, w: 200, title: "Outcome", sub: "transcript · recording" },
  { id: "scheduler", x: 270, y: 330, title: "Follow-up scheduler", sub: "retries, callbacks" },
  { id: "memory", x: 730, y: 330, title: "Customer memory", sub: "facts, corrections", accent: true },
  { id: "alert", x: 960, y: 330, w: 200, title: "Email alert", sub: "interested · daily 7 PM" },
];

const PATHS = [
  { id: "p1", d: "M210 112 H270" },
  { id: "p2", d: "M440 112 H500" },
  { id: "p3", d: "M670 112 H730" },
  { id: "p4", d: "M900 112 H960" },
  { id: "p5", d: "M1060 144 V330" },
  { id: "p6", d: "M1000 144 C 1000 240, 815 230, 815 330" },
  { id: "p8", d: "M1160 112 H1200 V470 H355 V394" },
  { id: "p9", d: "M355 330 V144" },
  { id: "p7", d: "M730 362 C 640 362, 585 260, 585 144", context: true },
];

const DESCRIPTION = [
  "Leads are uploaded as a CSV or Excel sheet.",
  "Calls wait for the calling window you set, in your timezone.",
  "The voice agent places each call.",
  "When the call ends, the provider reports it through a token-verified webhook; a repeated delivery changes nothing.",
  "The outcome, transcript and recording are stored with the call.",
  "The outcome can trigger an email alert, and every day ends with a summary.",
  "Facts the customer stated are added to that customer’s memory; corrections replace what was wrong.",
  "Requested callbacks and retries go to the follow-up scheduler, which returns them to the calling window.",
  "Before the next call, the agent is given the relevant memory, so it continues the conversation.",
];

export function SystemFlow() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root) => {
    const svg = root.querySelector("svg");
    if (!svg) return;

    const build = gsap.timeline({
      scrollTrigger: { trigger: svg, start: "top 78%", end: "bottom 60%", scrub: 0.8 },
    });
    const order = ["leads", "p1", "window", "p2", "agent", "p3", "webhook", "p4", "outcome", "p5", "alert", "p6", "memory", "p7", "p8", "scheduler", "p9"];
    order.forEach((id) => {
      const element = svg.querySelector(`[data-id="${id}"]`);
      if (!element) return;
      if (id === "p7") {
        // Dashed: DrawSVG works by rewriting the dash pattern, which would
        // erase the dashes, so this one fades in instead.
        build.from(element, { opacity: 0, duration: 1, ease: "none" });
      } else if (id.startsWith("p")) {
        build.from(element, { drawSVG: "0%", duration: 1, ease: "none" });
      } else {
        build.from(element, { opacity: 0, y: 10, duration: 0.6, ease: "power2.out" }, "-=0.2");
      }
    });

    // Once built, signals travel the main line and the memory loop.
    const main = svg.querySelector<SVGPathElement>("[data-signal-path='main']");
    const loop = svg.querySelector<SVGPathElement>("[data-id='p7']");
    const dotMain = svg.querySelector("[data-dot='main']");
    const dotLoop = svg.querySelector("[data-dot='loop']");
    const signals = gsap.timeline({ repeat: -1, paused: true });
    if (main && dotMain) {
      signals.fromTo(dotMain, { opacity: 0 }, { opacity: 1, duration: 0.2 }).to(
        dotMain,
        { motionPath: { path: main, align: main, alignOrigin: [0.5, 0.5] }, duration: 3.2, ease: "power1.inOut" },
        0
      ).to(dotMain, { opacity: 0, duration: 0.2 });
    }
    if (loop && dotLoop) {
      signals.fromTo(
        dotLoop,
        { opacity: 1 },
        { motionPath: { path: loop, align: loop, alignOrigin: [0.5, 0.5] }, duration: 1.8, ease: "power1.inOut" },
        1.4
      ).to(dotLoop, { opacity: 0, duration: 0.2 });
    }
    gsap.set([dotMain, dotLoop], { opacity: 0 });
    // Signals run only while the finished diagram is on screen.
    ScrollTrigger.create({
      trigger: svg,
      start: "bottom 80%",
      end: "bottom top",
      onToggle: (self) => (self.isActive ? signals.play() : signals.pause()),
    });
  });

  return (
    <section ref={rootRef} aria-labelledby="flow-title" className="border-b border-stone bg-paper">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="mono-label text-ink-faint">The system</p>
            <h2 id="flow-title" className="serif mt-4 text-[36px] leading-[44px] tracking-[-0.01em] md:text-[48px] md:leading-[56px]">
              One loop, not a pile of call logs.
            </h2>
          </div>
          <p className="self-end text-[17px] leading-7 text-ink-muted lg:col-span-6 lg:col-start-7">
            Every call feeds the next. What a customer says becomes memory, what they ask for becomes a scheduled
            callback, and both return to the agent before it dials again.
          </p>
        </div>

        <figure className="mt-14">
          <div className="hidden overflow-x-auto md:block">
            <svg viewBox="0 0 1210 500" className="h-auto w-full min-w-[820px]" aria-hidden="true">
              <defs>
                <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="var(--color-ink)" />
                </marker>
              </defs>

              {/* Invisible spine the main signal travels. */}
              <path data-signal-path="main" d="M125 112 H1060" fill="none" stroke="none" />

              {PATHS.map((path) => (
                <path
                  key={path.id}
                  data-id={path.id}
                  d={path.d}
                  fill="none"
                  stroke={path.context ? "var(--color-iris)" : "var(--color-ink)"}
                  strokeWidth={path.context ? 1.6 : 1.2}
                  strokeDasharray={path.context ? "5 5" : undefined}
                  markerEnd="url(#flow-arrow)"
                />
              ))}
              <text x="578" y="262" textAnchor="end" fontSize="12" fill="var(--color-iris-deep)" fontFamily="var(--font-geist-mono)" letterSpacing="0.8">CONTEXT FOR THE NEXT CALL</text>
              <text x="720" y="490" fontSize="12" fill="var(--color-ink-faint)" fontFamily="var(--font-geist-mono)" letterSpacing="0.8">CALLBACKS AND RETRIES</text>

              {NODES.map((node) => {
                const w = node.w ?? 170;
                return (
                  <g key={node.id} data-id={node.id} transform={`translate(${node.x} ${node.y})`}>
                    <rect
                      width={w}
                      height="64"
                      rx="4"
                      fill={node.dark ? "var(--color-ink)" : node.accent ? "var(--color-lime)" : "var(--color-cream)"}
                      stroke="var(--color-ink)"
                      strokeWidth="1"
                    />
                    <text x="14" y="27" fontSize="15" fill={node.dark ? "var(--color-cream)" : "var(--color-ink)"}>
                      {node.title}
                    </text>
                    <text x="14" y="47" fontSize="11" fill={node.dark ? "rgba(255,252,244,.7)" : "var(--color-ink-muted)"} fontFamily="var(--font-geist-mono)">
                      {node.sub}
                    </text>
                  </g>
                );
              })}

              <circle data-dot="main" r="5" fill="var(--color-iris)" cx="125" cy="112" opacity="0" />
              <circle data-dot="loop" r="5" fill="var(--color-iris)" cx="730" cy="362" opacity="0" />
            </svg>
          </div>

          <figcaption>
            <ol className="space-y-3 md:sr-only">
              {DESCRIPTION.map((line, index) => (
                <li key={index} className="grid grid-cols-[36px_1fr] gap-2 border-t border-stone pt-3 text-[15px] leading-6 text-ink-muted">
                  <span className="mono-label pt-1 text-ink">{String(index + 1).padStart(2, "0")}</span>
                  {line}
                </li>
              ))}
            </ol>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
