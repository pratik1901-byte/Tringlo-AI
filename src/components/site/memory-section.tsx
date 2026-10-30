"use client";

import { useEffect, useRef, useState } from "react";

import { gsap } from "@/components/site/motion";
import { cn } from "@/lib/utils";

type Fact = {
  key: string;
  label: string;
  quote: string;
  kind: string;
  /** Call number that introduced it (1-based). */
  from: number;
  /** Call number that retired it, and how. */
  retired?: { at: number; how: "corrected" | "superseded" | "done" };
};

const FACTS: Fact[] = [
  { key: "sister", label: "Has a younger sister", quote: "I have a little sister", kind: "Personal", from: 1, retired: { at: 3, how: "corrected" } },
  { key: "channel", label: "Prefers WhatsApp to calls", quote: "WhatsApp is better for me", kind: "Preference", from: 1, retired: { at: 3, how: "superseded" } },
  { key: "price", label: "Finds the price high for now", quote: "the price feels a bit high", kind: "Objection", from: 1 },
  { key: "brother", label: "Decides with their brother", quote: "I need to discuss it with my brother", kind: "Decision", from: 1 },
  { key: "callback", label: "Callback: next day, 5 PM", quote: "call me tomorrow at 5", kind: "Follow-up", from: 1, retired: { at: 2, how: "done" } },
  { key: "cousin", label: "Has a cousin who may be interested", quote: "I also have a cousin", kind: "Personal", from: 2 },
  { key: "email", label: "Prefers email", quote: "email works better for me", kind: "Preference", from: 3 },
];

const CALLS = [
  {
    title: "First call",
    lines: ["I have a little sister, she's five.", "The price feels a bit high for us right now.", "WhatsApp is better for me than calls.", "I need to discuss it with my brother. Call me tomorrow at 5."],
    told: null,
  },
  {
    title: "The callback",
    lines: ["Yes, my brother liked it.", "I also have a cousin who might want it for her kids."],
    told: "This is the callback they asked for — they wanted to discuss it with their brother. Previously raised: the price. Has a younger sister.",
  },
  {
    title: "A week later",
    lines: ["Sorry — I don't have a sister, I meant my cousin.", "And actually, email works better for me than WhatsApp."],
    told: "Brother approved last time. Has a cousin who may be interested. Previously raised: the price. Prefers WhatsApp.",
  },
];

function Ledger({ stage, compact = false }: { stage: number; compact?: boolean }) {
  const call = stage + 1;
  const visible = FACTS.filter((fact) => fact.from <= call);
  return (
    <div className={cn("rounded-lg border border-ink bg-paper", compact && "mt-4")}>
      <div className="flex items-center justify-between border-b border-ink px-5 py-3">
        <span className="mono-label text-ink">Customer memory</span>
        <span className="mono-label text-ink-faint">after call {call}</span>
      </div>
      <ul className="divide-y divide-stone">
        {visible.map((fact) => {
          const retired = fact.retired && fact.retired.at <= call ? fact.retired : null;
          const isNew = fact.from === call;
          return (
            <li key={fact.key} data-fact={fact.key} data-new={isNew || undefined} className="grid grid-cols-[92px_1fr] gap-3 px-5 py-3">
              <span className="mono-label pt-0.5 text-ink-faint">{fact.kind}</span>
              <span>
                <span className={cn("block text-[15px] leading-6", retired ? "text-ink-faint line-through decoration-ink/40" : "text-ink")}>
                  {fact.label}
                  {retired && (
                    <span className="mono-label ml-2 inline-block no-underline" style={{ textDecoration: "none" }}>
                      · {retired.how === "done" ? "done" : retired.how}
                    </span>
                  )}
                </span>
                {!compact && (
                  <span className="mt-0.5 block text-[13px] leading-5 text-ink-muted">
                    <span className="sr-only">Customer said: </span>“{fact.quote}”
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MemorySection() {
  const rootRef = useRef<HTMLElement | null>(null);
  const [stage, setStage] = useState(0);

  // Which call is being read decides what the ledger shows. This is content,
  // not decoration, so it follows the reader with or without motion.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-call]"));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setStage(Number(entry.target.getAttribute("data-call")));
        });
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  // New entries flash like a highlighter pass.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fresh = root.querySelectorAll("[data-sticky-ledger] [data-new]");
    gsap.fromTo(fresh, { backgroundColor: "rgba(232,240,86,0.9)" }, { backgroundColor: "rgba(232,240,86,0)", duration: 1.6, ease: "power2.out" });
    gsap.fromTo(fresh, { x: -8, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out", stagger: 0.06 });
  }, [stage]);

  return (
    <section ref={rootRef} id="memory" aria-labelledby="memory-title" className="border-b border-stone bg-cream">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="mono-label text-ink-faint">Customer memory</p>
            <h2 id="memory-title" className="serif mt-4 text-[36px] leading-[44px] tracking-[-0.01em] md:text-[48px] md:leading-[56px]">
              The second call sounds like a second call.
            </h2>
          </div>
          <p className="self-end text-[17px] leading-7 text-ink-muted lg:col-span-5 lg:col-start-8">
            After each connected call, what the customer actually said is kept — with their words as evidence.
            Before the next one, the agent is told only what is relevant. A correction replaces the old fact
            instead of sitting beside it.
          </p>
        </div>

        <div className="mt-16 grid min-w-0 gap-10 lg:grid-cols-12">
          <ol className="relative min-w-0 space-y-10 lg:col-span-6 lg:space-y-[30vh] lg:pb-[20vh]">
            <span aria-hidden="true" className="absolute bottom-0 left-[11px] top-2 w-px bg-stone" />
            {CALLS.map((call, index) => (
              <li key={call.title} data-call={index} className="relative min-w-0 pl-10">
                <span aria-hidden="true" className={cn("absolute left-0 top-1.5 flex h-[23px] w-[23px] items-center justify-center rounded-full border text-[11px] transition-colors duration-300", stage >= index ? "border-ink bg-ink text-cream" : "border-stone-deep bg-cream text-ink-faint")}>
                  {index + 1}
                </span>
                <p className="mono-label text-ink-faint">Call {index + 1}</p>
                <h3 className="serif mt-1 text-[28px] leading-9">{call.title}</h3>

                {call.told && (
                  <div className="mt-4 rounded-[4px] border border-dashed border-iris bg-paper px-4 py-3">
                    <p className="mono-label text-iris-deep">Told to the agent before dialling</p>
                    <p className="mt-1.5 text-[14px] leading-[22px] text-ink">{call.told}</p>
                  </div>
                )}

                <ul className="mt-4 space-y-2" aria-label="What the customer said">
                  {call.lines.map((line) => (
                    <li key={line} className="rounded-[4px] border border-stone bg-paper px-4 py-2.5 text-[15px] leading-6 text-ink">
                      “{line}”
                    </li>
                  ))}
                </ul>

                <div className="lg:hidden">
                  <Ledger stage={index} compact />
                </div>
              </li>
            ))}
          </ol>

          <div className="hidden lg:col-span-5 lg:col-start-8 lg:block">
            <div data-sticky-ledger className="sticky top-28" aria-live="polite">
              <Ledger stage={stage} />
              <p className="mt-4 text-[13px] leading-5 text-ink-faint">
                Illustrative example. Memory belongs to one workspace: the same phone number in another
                business’s workspace starts empty. A workspace can delete a customer’s memory at any time.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
