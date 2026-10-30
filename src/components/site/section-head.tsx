// ============================================================
// Public website — section heading
// ============================================================
//
// Every section opens the same way: a numbered label, a heading on the left
// half of the grid, and, where there is one, a short lede that sits on the
// right and bottom-aligns with the heading. One component, so every section's
// heading starts on the same line and the page reads as one composition.
// ============================================================

import { cn } from "@/lib/utils";

export function SectionHead({
  index,
  label,
  id,
  title,
  lede,
  onInk = false,
  className,
}: {
  index: string;
  label: string;
  id: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  onInk?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-8 lg:grid-cols-12 lg:items-end", className)}>
      <div className="lg:col-span-7">
        <p data-reveal className={cn("mono-label flex items-center gap-3", onInk ? "text-cream/55" : "text-ink-faint")}>
          <span className="tabular-nums">{index}</span>
          <span aria-hidden="true" className={cn("h-px w-8", onInk ? "bg-cream/30" : "bg-ink/25")} />
          {label}
        </p>
        <h2 id={id} data-split className={cn("t-title mt-6", onInk ? "text-cream" : "text-ink")}>
          {title}
        </h2>
      </div>
      {lede && (
        <p
          data-reveal
          className={cn("t-lede lg:col-span-4 lg:col-start-9", onInk ? "text-cream/70" : "text-ink-muted")}
        >
          {lede}
        </p>
      )}
    </div>
  );
}
