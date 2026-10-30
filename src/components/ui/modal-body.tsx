"use client";

// ============================================================
// Tringlo AI — Scrollable panel body
// ============================================================
//
// A dialog's scrolling middle, with an honest "there is more below" cue.
//
// Without one, a panel whose content happens to fill the viewport looks
// finished: the call detail ended on a tidy grid of fields, and the transcript
// and recording below it were never found. The fade and the button only appear
// when content is actually out of view, and go when the end is reached.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export function ModalBody({
  children,
  className = "",
  hint,
}: {
  children: React.ReactNode;
  /** Padding and spacing for the content, as any other scroll container. */
  className?: string;
  /** What is further down, e.g. "Transcript and recording below". */
  hint?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    // A couple of pixels of slack: fractional scroll heights are common.
    setMore(element.scrollHeight - element.scrollTop - element.clientHeight > 8);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    // Content arrives late (a transcript, a loaded player), so the cue is
    // recalculated when the body changes size, not only when it is scrolled.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [measure, children]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={ref} onScroll={measure} className={`min-h-0 flex-1 overflow-y-auto ${className}`}>
        {children}
      </div>

      {more && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card via-card/80 to-transparent" />
          <button
            type="button"
            onClick={() => ref.current?.scrollBy({ top: ref.current.clientHeight * 0.85, behavior: "smooth" })}
            className="absolute inset-x-0 bottom-2.5 mx-auto inline-flex h-7 w-fit items-center gap-1 rounded-full border bg-card px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          >
            {hint ?? "More below"}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
