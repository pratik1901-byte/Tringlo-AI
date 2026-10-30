"use client";

// ============================================================
// Public website — the rest of the platform
// ============================================================
//
// Everything a workspace has beyond the call itself, laid out as a bento of
// deliberately unequal cells: the biggest idea gets the biggest cell, and the
// surfaces alternate so the eye has somewhere to rest.
//
// Only implemented features. The analytics cell lists the metrics the
// product actually computes, with no invented numbers beside them.
// ============================================================

import { useRef } from "react";
import { BarChart3, Building2, FileAudio, Mail, PhoneIncoming, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { SectionHead } from "@/components/site/section-head";
import { EASE, gsap, onFirstView, revealChildren, revealHeadings, scrollReveal, useSiteMotion } from "@/components/site/motion";

const WORKSPACES = [
  { name: "Northwind Interiors", role: "Owner" },
  { name: "Harbour Logistics", role: "Owner" },
  { name: "Greenleaf Clinics", role: "Owner" },
];

const METRICS = ["Contact rate", "Interest rate", "Follow-up rate", "Average call length", "Calls per active day"];

function Cell({
  className,
  children,
  icon: Icon,
  label,
}: {
  className: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <article data-cell className={`flex min-w-0 flex-col rounded-[14px] p-6 md:p-8 ${className}`}>
      <p className="mono-label flex items-center gap-2.5 opacity-70">
        <Icon className="h-4 w-4" />
        {label}
      </p>
      {children}
    </article>
  );
}

export function Platform() {
  const rootRef = useRef<HTMLElement | null>(null);

  useSiteMotion(rootRef, (root, ctx) => {
    revealChildren(root);
    const stop = revealHeadings(root, ctx);
    scrollReveal(
      root.querySelectorAll("[data-cell]"),
      { y: 44, opacity: 0, scale: 0.985 },
      { y: 0, opacity: 1, scale: 1, duration: 1.1, stagger: { each: 0.08, from: "start" }, ease: EASE },
      { trigger: root.querySelector("[data-bento]"), start: "top bottom-=60" }
    );

    // The workspace list: the selection moves down the list, the way switching
    // between businesses does in the product.
    const switcher = root.querySelector("[data-switcher]");
    if (switcher) {
      onFirstView(switcher, ctx, () => {
        const rows = gsap.utils.toArray<HTMLElement>("[data-ws-row]", switcher);
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, delay: 0.8 });
        rows.forEach((row) => {
          tl.to(row, { backgroundColor: "rgba(255,252,244,0.10)", borderColor: "rgba(232,240,86,0.7)", duration: 0.35 })
            .to(row, { backgroundColor: "rgba(255,252,244,0)", borderColor: "rgba(255,252,244,0.15)", duration: 0.35 }, "+=1.2");
        });
        // Rest while off screen.
        gsap.timeline({ scrollTrigger: { trigger: switcher, start: "top bottom", end: "bottom top", onToggle: (self) => (self.isActive ? tl.resume() : tl.pause()) } });
      });
    }
    return stop;
  });

  return (
    <section ref={rootRef} id="platform" aria-labelledby="platform-title" className="band border-b border-stone bg-cream">
      <div className="frame">
        <SectionHead
          index="07"
          label="The platform"
          id="platform-title"
          title={
            <>
              Everything around the call, <em className="accent">in one place.</em>
            </>
          }
          lede="Setting up an agent, keeping businesses apart, taking calls in as well as making them, and knowing how it is going."
        />

        <div data-bento className="mt-[clamp(56px,7vw,96px)] grid gap-4 md:grid-cols-6">
          {/* Workspaces — the largest idea, the largest cell. */}
          <Cell icon={Building2} label="Workspaces" className="on-ink bg-ink text-cream md:col-span-4 md:row-span-2">
            <h3 className="serif mt-6 max-w-[26rem] text-[36px] leading-[1.08] md:text-[44px]">
              One account. As many businesses as you run.
            </h3>
            <p className="mt-4 max-w-[30rem] text-[16px] leading-[1.65] text-cream/70">
              Each workspace has its own agent, leads, calls, memory and settings, and sees nothing of the others. Switch
              between them without signing out.
            </p>
            <div data-switcher className="mt-auto pt-10" aria-hidden="true">
              <p className="mono-label text-cream/40">Choose your workspace</p>
              <ul className="mt-3 space-y-2">
                {WORKSPACES.map((ws) => (
                  <li
                    key={ws.name}
                    data-ws-row
                    className="flex items-center gap-3 rounded-[8px] border border-cream/15 px-4 py-3"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-cream/10 text-[12px] font-medium text-cream">
                      {ws.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <span className="flex-1 text-[15px] text-cream">{ws.name}</span>
                    <span className="mono-label text-cream/45">{ws.role}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Cell>

          <Cell icon={SlidersHorizontal} label="Agent profile" className="border border-stone bg-paper text-ink md:col-span-2">
            <h3 className="serif mt-6 text-[28px] leading-[1.12]">Tell it who you are.</h3>
            <p className="mt-3 text-[15px] leading-[1.65] text-ink-muted">
              Company, product, pricing, FAQs and the purpose of the call. The agent answers from these — and you can
              paste Sarvam&rsquo;s API examples to fill in the connection settings.
            </p>
          </Cell>

          <Cell icon={PhoneIncoming} label="Inbound line" className="bg-lime text-ink md:col-span-2">
            <h3 className="serif mt-6 text-[28px] leading-[1.12]">Answer, too.</h3>
            <p className="mt-3 text-[15px] leading-[1.65] text-ink/75">
              Optional. Business hours, callers you know greeted by name, an after-hours message, and a handoff number
              for anyone who asks for a person.
            </p>
          </Cell>

          <Cell icon={FileAudio} label="Results" className="border border-stone bg-parchment text-ink md:col-span-2">
            <h3 className="serif mt-6 text-[28px] leading-[1.12]">Every call, kept.</h3>
            <p className="mt-3 text-[15px] leading-[1.65] text-ink-muted">
              Outcome, summary, transcript and recording for each call, with the full history on every lead. Recordings
              download as MP3.
            </p>
          </Cell>

          <Cell icon={BarChart3} label="Analytics" className="border border-stone bg-paper text-ink md:col-span-2">
            <h3 className="serif mt-6 text-[28px] leading-[1.12]">How it is going.</h3>
            <ul className="mt-4 divide-y divide-stone border-y border-stone text-[14px]">
              {METRICS.map((metric) => (
                <li key={metric} className="flex items-center justify-between py-2.5 text-ink-muted">
                  {metric}
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-iris" />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12.5px] text-ink-faint">Worked out from your own calls.</p>
          </Cell>

          <Cell icon={Mail} label="Notifications" className="border border-stone bg-paper text-ink md:col-span-2">
            <h3 className="serif mt-6 text-[28px] leading-[1.12]">Told when it matters.</h3>
            <p className="mt-3 text-[15px] leading-[1.65] text-ink-muted">
              Interested leads can be emailed to you as they come in, along with a daily summary of what the calls produced.
            </p>
          </Cell>

          <Cell icon={ShieldCheck} label="Trust" className="on-ink bg-ink-soft text-cream md:col-span-6">
            <div className="mt-6 grid gap-8 md:grid-cols-3">
              {[
                ["Kept apart", "One business can never read another’s leads, calls, transcripts or memory — even by guessing an id."],
                ["Keys stay on the server", "Provider keys, webhook tokens and mail credentials are never sent to a browser."],
                ["Do-not-call is final", "A request not to be called suppresses the lead and cancels anything scheduled for it."],
              ].map(([title, body]) => (
                <div key={title}>
                  <h3 className="serif text-[24px] leading-8 text-cream">{title}</h3>
                  <p className="mt-2 text-[15px] leading-[1.65] text-cream/65">{body}</p>
                </div>
              ))}
            </div>
          </Cell>
        </div>
        <p className="mt-5 text-[12px] text-ink-faint">Workspace names shown are examples.</p>
      </div>
    </section>
  );
}
