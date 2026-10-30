"use client";

import { useEffect, useRef, useState } from "react";

import { gsap, registerSiteGsap } from "@/components/site/motion";
import { cn } from "@/lib/utils";

const CHAPTERS = [
  { title: "Upload", body: "A sheet of leads becomes a call list." },
  { title: "Call", body: "The first lead is dialled inside calling hours." },
  { title: "Conversation", body: "The transcript builds as they talk." },
  { title: "Understanding", body: "Structured fields fill in when the call ends." },
  { title: "Result", body: "Status changes; an interested lead emails you." },
  { title: "Follow-up", body: "The requested callback joins the schedule." },
];

const ROWS = [
  { name: "Ananya R.", phone: "+91 98•••• 1111" },
  { name: "Bharat S.", phone: "+91 98•••• 2222" },
  { name: "Chitra M.", phone: "+91 90•••• 3333" },
  { name: "Dev K.", phone: "+91 88•••• 4444" },
];

function StatusPill({ index }: { index: number }) {
  return (
    <span
      data-status={index}
      className={cn(
        "inline-flex h-6 items-center rounded-full border px-2.5 text-[11.5px]",
        index === 0 ? "border-ink bg-lime text-ink" : "border-stone bg-cream text-ink-muted"
      )}
    >
      {index === 0 ? "Interested" : "Queued"}
    </span>
  );
}

export function DemoSequence() {
  const rootRef = useRef<HTMLElement | null>(null);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const [chapter, setChapter] = useState(CHAPTERS.length - 1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    registerSiteGsap();
    const q = gsap.utils.selector(screen);
    const pill = screen.querySelector<HTMLElement>("[data-status='0']");
    const setPill = (text: string, tone: "queued" | "calling" | "interested") => {
      if (!pill) return;
      pill.textContent = text;
      pill.style.background = tone === "interested" ? "var(--color-lime)" : tone === "calling" ? "var(--color-iris)" : "var(--color-cream)";
      pill.style.color = tone === "calling" ? "#fff" : tone === "interested" ? "var(--color-ink)" : "var(--color-ink-muted)";
      pill.style.borderColor = tone === "queued" ? "var(--color-stone)" : "var(--color-ink)";
    };

    const context = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, onComplete: () => setPlaying(false) });
      const mark = (index: number) => tl.addLabel(`c${index}`).call(() => setChapter(index));

      // Reset to an empty workspace.
      tl.set(q("[data-row]"), { opacity: 0, y: 10 })
        .set(q("[data-file]"), { opacity: 0, y: -8 })
        .set(q("[data-wave]"), { opacity: 0 })
        .set(q("[data-tline]"), { opacity: 0, y: 6 })
        .set(q("[data-field]"), { opacity: 0 })
        .set(q("[data-toast]"), { opacity: 0, y: 12 })
        .set(q("[data-fu]"), { opacity: 0, x: 16 })
        .set(q("[data-panel]"), { opacity: 0.35 })
        .call(() => setPill("Queued", "queued"));

      mark(0);
      tl.to(q("[data-file]"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
        .to(q("[data-row]"), { opacity: 1, y: 0, duration: 0.45, stagger: 0.18, ease: "power3.out" })
        .to({}, { duration: 0.8 });

      mark(1);
      tl.call(() => setPill("Calling", "calling"))
        .to(q("[data-row='0']"), { backgroundColor: "rgba(92,105,248,0.07)", duration: 0.3 })
        .to(q("[data-wave]"), { opacity: 1, duration: 0.3 })
        .to({}, { duration: 1.2 });

      mark(2);
      tl.to(q("[data-panel]"), { opacity: 1, duration: 0.4 })
        .to(q("[data-tline]"), { opacity: 1, y: 0, duration: 0.4, stagger: 0.9 })
        .to({}, { duration: 0.6 });

      mark(3);
      tl.to(q("[data-wave]"), { opacity: 0, duration: 0.3 })
        .to(q("[data-field]"), { opacity: 1, duration: 0.35, stagger: 0.35 })
        .to({}, { duration: 0.8 });

      mark(4);
      tl.call(() => setPill("Interested", "interested"))
        .fromTo(pill, { scale: 0.85 }, { scale: 1, duration: 0.45, ease: "back.out(2.5)" })
        .to(q("[data-toast]"), { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" })
        .to({}, { duration: 1.4 })
        .to(q("[data-toast]"), { opacity: 0, y: 12, duration: 0.4 });

      mark(5);
      tl.to(q("[data-fu]"), { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" })
        .fromTo(q("[data-fu]"), { backgroundColor: "rgba(232,240,86,0.9)" }, { backgroundColor: "rgba(232,240,86,0)", duration: 1.4 })
        .to({}, { duration: 0.8 });

      timelineRef.current = tl;
    }, screen);

    // Autoplay once, when it comes into view, only if motion is welcome.
    let played = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const tl = timelineRef.current;
        if (!tl) return;
        if (entry.isIntersecting) {
          if (!played && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            played = true;
            tl.play(0);
            setPlaying(true);
          }
        } else if (tl.isActive()) {
          tl.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(screen);

    return () => {
      observer.disconnect();
      context.revert();
      timelineRef.current = null;
    };
  }, []);

  const toggle = () => {
    const tl = timelineRef.current;
    if (!tl) return;
    if (playing) {
      tl.pause();
      setPlaying(false);
    } else {
      if (tl.progress() >= 1 || tl.progress() === 0) tl.play(0);
      else tl.play();
      setPlaying(true);
    }
  };

  const jump = (index: number) => {
    const tl = timelineRef.current;
    if (!tl) return;
    tl.pause();
    tl.seek(`c${index}`);
    // Show the chapter's end state, so a jump lands on something to read.
    const next = index + 1 < CHAPTERS.length ? tl.labels[`c${index + 1}`] : tl.duration();
    tl.seek(Math.max(tl.labels[`c${index}`], next - 0.01), false);
    setChapter(index);
    setPlaying(false);
  };

  return (
    <section ref={rootRef} aria-labelledby="demo-title" className="border-b border-stone bg-parchment">
      <div className="mx-auto max-w-[1320px] px-5 py-24 md:px-8 lg:py-32">
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <p className="mono-label text-ink-faint">Product walkthrough</p>
            <h2 id="demo-title" className="serif mt-4 text-[36px] leading-[44px] tracking-[-0.01em] md:text-[48px] md:leading-[56px]">
              Watch one lead go all the way through.
            </h2>
          </div>
          <p className="self-end text-[17px] leading-7 text-ink-muted lg:col-span-5 lg:col-start-8">
            A condensed replay of what happens in a workspace. Screens are simplified and every name is an example.
          </p>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-12">
          {/* Chapters double as a table of contents and scrub controls. */}
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggle} className="inline-flex h-11 items-center gap-2 rounded-[4px] bg-ink px-4 text-[14px] font-medium text-cream hover:bg-ink-soft">
                <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
                {playing ? "Pause" : chapter === CHAPTERS.length - 1 ? "Play from start" : "Play"}
              </button>
            </div>
            <ol className="mt-6 space-y-1">
              {CHAPTERS.map((item, index) => (
                <li key={item.title}>
                  <button
                    type="button"
                    onClick={() => jump(index)}
                    aria-current={chapter === index ? "step" : undefined}
                    className={cn(
                      "grid w-full grid-cols-[28px_1fr] items-baseline gap-1 rounded-[4px] border px-3 py-2.5 text-left transition-colors",
                      chapter === index ? "border-ink bg-paper" : "border-transparent hover:border-stone"
                    )}
                  >
                    <span className="mono-label text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block text-[15px] text-ink">{item.title}</span>
                      <span className="block text-[13px] leading-5 text-ink-muted">{item.body}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="sr-only" aria-live="polite">
              Chapter {chapter + 1}: {CHAPTERS[chapter].title}. {CHAPTERS[chapter].body}
            </p>
          </div>

          {/* The screen. */}
          <div className="lg:col-span-9">
            <div ref={screenRef} className="relative overflow-hidden rounded-lg border border-ink bg-paper" aria-hidden="true">
              <div className="flex items-center gap-2 border-b border-stone bg-cream px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full border border-stone-deep" />
                <span className="h-2.5 w-2.5 rounded-full border border-stone-deep" />
                <span className="h-2.5 w-2.5 rounded-full border border-stone-deep" />
                <span className="mono-label ml-3 text-ink-faint">workspace · leads</span>
              </div>

              <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[1.35fr_1fr]">
                <div className="border-stone p-5 md:border-r">
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-medium text-ink">Leads</p>
                    <span data-file className="mono-label rounded-[4px] border border-stone px-2 py-1 text-ink-muted">leads.csv · 4 rows</span>
                  </div>
                  <table className="mt-4 w-full text-left text-[13px]">
                    <thead>
                      <tr className="border-b border-stone text-ink-faint">
                        <th className="py-2 font-normal">Name</th>
                        <th className="hidden py-2 font-normal sm:table-cell">Phone</th>
                        <th className="py-2 text-right font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ROWS.map((row, index) => (
                        <tr key={row.name} data-row={index} className="border-b border-stone">
                          <td className="py-2.5 text-ink">
                            {row.name}
                            {index === 0 && (
                              <span data-wave className="ml-2 inline-flex h-3 items-end gap-[2px] align-middle">
                                {[0.5, 1, 0.7, 0.9, 0.4].map((height, bar) => (
                                  <span key={bar} className="w-[2px] bg-iris" style={{ height: `${height * 12}px` }} />
                                ))}
                              </span>
                            )}
                          </td>
                          <td className="hidden py-2.5 font-mono text-[12px] text-ink-muted sm:table-cell">{row.phone}</td>
                          <td className="py-2.5 text-right"><StatusPill index={index} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="mt-6">
                    <p className="mono-label text-ink-faint">Follow-ups</p>
                    <div data-fu className="mt-2 flex items-center justify-between rounded-[4px] border border-stone px-3 py-2.5 text-[13px]">
                      <span className="text-ink">Ananya R. · callback</span>
                      <span className="font-mono text-[12px] text-ink-muted">Tomorrow 5:00 PM</span>
                    </div>
                  </div>
                </div>

                <div data-panel className="bg-cream/60 p-5">
                  <p className="text-[15px] font-medium text-ink">Call with Ananya R.</p>
                  <ol className="mt-3 space-y-2 text-[13px] leading-5">
                    <li data-tline><span className="mono-label mr-2 text-iris-deep">Agent</span>Is now a good time?</li>
                    <li data-tline><span className="mono-label mr-2 text-ink-faint">Lead</span>Briefly — the price feels high.</li>
                    <li data-tline><span className="mono-label mr-2 text-ink-faint">Lead</span>Call me tomorrow at five.</li>
                  </ol>
                  <dl className="mt-5 space-y-2 border-t border-stone pt-4 text-[13px]">
                    {[
                      ["Interest", "High"],
                      ["Objection", "Price, for now"],
                      ["Next step", "Callback tomorrow 5 PM"],
                      ["Recording", "MP3 · 0:47"],
                    ].map(([label, value]) => (
                      <div data-field key={label} className="flex justify-between gap-3">
                        <dt className="text-ink-faint">{label}</dt>
                        <dd className="text-right text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <div data-toast className="absolute bottom-4 right-4 flex items-center gap-2 rounded-[4px] border border-ink bg-paper px-3.5 py-2.5 text-[13px] text-ink shadow-[0_8px_30px_rgba(23,22,20,0.1)]">
                <span className="h-2 w-2 rounded-full bg-lime ring-1 ring-ink/30" />
                Email sent: new interested lead
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
