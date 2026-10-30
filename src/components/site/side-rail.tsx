"use client";

// ============================================================
// Public website — the side rail and the way back up
// ============================================================
//
// Two small navigation aids that sit over the page rather than in it:
//
//   SectionRail — a vertical list of the page's sections, fixed to the left
//                 edge, marking the one being read. Large screens only: it
//                 needs room beside the content, and below that the header's
//                 own menu already covers the same ground.
//   BackToTop   — a button that appears once the reader is well down the
//                 page and returns them to the top.
//
// Both are ordinary links and buttons, so they work with the keyboard, and
// both respect a reader who has asked for less motion.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

import { INTRO_ATTRIBUTES, introCovering } from "@/components/site/site-intro";

const SECTIONS = [
  { id: "top", label: "Top" },
  { id: "product", label: "What it does" },
  { id: "how-it-works", label: "How it works" },
  { id: "calling", label: "Calling" },
  { id: "outcomes", label: "Outcomes" },
  { id: "use-cases", label: "Use cases" },
  { id: "platform", label: "Platform" },
  { id: "faq", label: "FAQ" },
  { id: "get-started", label: "Get started" },
] as const;

/** Scrolls to an element, instantly for a reader who prefers less motion. */
function goTo(target: Element | null) {
  if (!target) return;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

export function SectionRail() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  /** The labels show themselves once, briefly, then keep out of the way. */
  const [peek, setPeek] = useState(true);
  const ratios = useRef(new Map<string, number>());

  useEffect(() => {
    const html = document.documentElement;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      timer = setTimeout(() => setPeek(false), 1000);
    };
    // An opening may still be covering the page; one second spent behind it is
    // a second nobody sees, so the look waits until the page is on show.
    if (!introCovering()) {
      show();
      return () => clearTimeout(timer);
    }
    const watch = new MutationObserver(() => {
      if (introCovering()) return;
      watch.disconnect();
      show();
    });
    watch.observe(html, { attributes: true, attributeFilter: INTRO_ATTRIBUTES });
    return () => {
      watch.disconnect();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const seen = SECTIONS.map((s) => document.getElementById(s.id)).filter((el): el is HTMLElement => !!el);
    if (!seen.length) return;

    // Whichever section is showing the most of itself is the one being read.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.current.set(entry.target.id, entry.isIntersecting ? entry.intersectionRatio : 0);
        let best = "";
        let bestRatio = 0;
        for (const [id, ratio] of ratios.current) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        if (best) setActive(best);
      },
      { threshold: [0, 0.15, 0.35, 0.6, 0.85], rootMargin: "-20% 0px -35% 0px" }
    );
    seen.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Sections of this page" className="site-rail" data-peek={peek ? "" : undefined}>
      <ul>
        {SECTIONS.map((section) => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                aria-current={current ? "true" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  goTo(document.getElementById(section.id));
                }}
              >
                <span className="site-rail-tick" aria-hidden="true" />
                <span className="site-rail-label">{section.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BackToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setShown(window.scrollY > window.innerHeight * 0.9);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <button
      type="button"
      className="site-to-top"
      data-shown={shown ? "" : undefined}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onClick={() => {
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      }}
    >
      <span className="sr-only">Back to top</span>
      <ArrowUp className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}
