"use client";

// ============================================================
// Tringlo AI — Shared Display Primitives
// ============================================================
// Status, metrics, and the loading / empty / error states every data screen
// needs. Centralised so "no data" looks and reads the same everywhere.
// ============================================================

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Loader2 } from "lucide-react";

import { sectionFor } from "@/components/layout/sidebar";

import { cn } from "@/lib/utils";
import { EMPTY, callStatePresentation, type StatusPresentation } from "@/lib/format";
import { useCountUp, useFadeIn } from "@/lib/animation";

// ------------------------------------------------------------
// Status
// ------------------------------------------------------------

// Soft pills with a dot. The dot carries the colour, so a state also reads by
// its label and shape rather than by colour alone.
const TONE_CLASS: Record<StatusPresentation["tone"], string> = {
  neutral: "bg-muted text-muted-foreground",
  pending: "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  positive: "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
  negative: "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300",
};

const TONE_DOT: Record<StatusPresentation["tone"], string> = {
  neutral: "bg-muted-foreground/50",
  pending: "bg-amber-500",
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  negative: "bg-red-500",
};

export function StatusBadge({
  status,
  requestedAt,
  now = 0,
  className,
  showPulse = false,
}: {
  status: string | null | undefined;
  /** When the trigger was sent. With `now`, lets the badge report a lost result. */
  requestedAt?: string | null;
  /** Current time from a ticking clock. Omit to skip the staleness check. */
  now?: number;
  className?: string;
  /** Only ever set for a genuinely in-flight call. */
  showPulse?: boolean;
}) {
  const presentation = callStatePresentation(status, requestedAt, now);
  // A call that has gone quiet is not still in progress, so it stops pulsing.
  const pulse = showPulse && presentation.tone === "pending";

  return (
    <span
      title={presentation.description}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-medium leading-4 whitespace-nowrap",
        TONE_CLASS[presentation.tone],
        className
      )}
    >
      {pulse ? (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      ) : (
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[presentation.tone])} aria-hidden="true" />
      )}
      {presentation.label}
    </span>
  );
}

export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: StatusPresentation["tone"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-medium leading-4 whitespace-nowrap",
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

// ------------------------------------------------------------
// Metrics
// ------------------------------------------------------------

export interface MetricCardProps {
  label: string;
  /** Null renders an em dash. A metric with no data never counts up from zero. */
  value: number | null;
  format: (value: number) => string;
  /** Secondary line. Pass null when there is nothing truthful to say. */
  caption?: string | null;
  captionTone?: "neutral" | "positive" | "negative";
  /** The one figure a page leads with: set in ink, so it reads first. */
  featured?: boolean;
}

export function MetricCard({
  label,
  value,
  format,
  caption,
  captionTone = "neutral",
  featured = false,
}: MetricCardProps) {
  const display = useCountUp(value, format);
  const Trend = captionTone === "positive" ? ArrowUpRight : captionTone === "negative" ? ArrowDownRight : null;

  return (
    // Phone: two cards share a row, so the padding and the figure come down a
    // step and the caption is allowed two lines instead of pushing the height.
    <div
      className={cn(
        "relative flex flex-col rounded-xl border p-5 transition-shadow duration-300 phone:p-3.5",
        featured
          ? "border-transparent bg-primary text-primary-foreground shadow-[0_18px_40px_-24px_rgba(23,22,20,0.55)]"
          : "bg-card hover:shadow-[0_10px_30px_-22px_rgba(23,22,20,0.35)]"
      )}
    >
      <p
        className={cn(
          "text-[12.5px] font-medium phone:text-[11px]",
          featured ? "text-primary-foreground/70" : "text-muted-foreground"
        )}
      >
        {label}
      </p>
      {/* The brand serif, with lining, even-width figures so a changing
          number never shifts its neighbours. */}
      <p className="mt-3 font-serif text-[40px] leading-none tracking-[-0.01em] [font-variant-numeric:lining-nums_tabular-nums] phone:mt-2 phone:text-[30px]">
        {value === null ? EMPTY : display || format(value)}
      </p>
      <div className="mt-3 min-h-5 phone:mt-2">
        {Trend && caption ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-medium",
              featured && "bg-[#E8F056] text-[#171614]",
              !featured && captionTone === "positive" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
              !featured && captionTone === "negative" && "bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-300"
            )}
          >
            <Trend className="h-3 w-3" aria-hidden="true" />
            {caption}
          </span>
        ) : (
          <p
            className={cn(
              "text-xs phone:line-clamp-2 phone:text-[11px] phone:leading-snug",
              featured ? "text-primary-foreground/70" : "text-muted-foreground"
            )}
          >
            {caption ?? EMPTY}
          </p>
        )}
      </div>
    </div>
  );
}

/** A labelled value in a detail panel. Falls back to an em dash on its own. */
export function Field({
  label,
  value,
  className,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === "" || value === EMPTY;

  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-sm",
          mono && "font-mono text-[13px]",
          isEmpty ? "text-muted-foreground/60" : "text-foreground"
        )}
      >
        {isEmpty ? EMPTY : value}
      </dd>
    </div>
  );
}

// ------------------------------------------------------------
// Loading / empty / error
// ------------------------------------------------------------

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-xl border border-dashed bg-card/50 px-6 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

/**
 * Loading placeholder for anything that is not a table: a card of pulsing
 * lines. SkeletonRows renders a <tbody> and belongs only inside a <table>.
 */
export function SkeletonBlock({ rows = 3, columns = 3 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <span
              key={columnIndex}
              className="block h-3 flex-1 animate-pulse rounded bg-muted"
              style={{ maxWidth: `${45 + ((rowIndex + columnIndex) % 4) * 14}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-b last:border-b-0">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <td key={columnIndex} className="px-4 py-4">
              <span
                className="block h-3 animate-pulse rounded bg-muted"
                style={{ width: `${45 + ((rowIndex + columnIndex) % 4) * 14}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  const ref = useFadeIn<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-16 text-center"
    >
      {Icon && (
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      {/* The brand serif, as page titles are: an empty page is still a page. */}
      <h3 className="font-serif text-[24px] font-normal leading-tight tracking-[-0.01em]">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 dark:border-red-900/60 dark:bg-red-950/30">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
      <div className="flex-1">
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          Something went wrong
        </p>
        <p className="mt-0.5 text-sm text-red-700 dark:text-red-400">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-800 transition-colors hover:bg-red-100 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/60"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * Page heading with an optional actions cluster.
 *
 * The title is set in the brand serif, as the website's headings are, with
 * the sidebar section the page belongs to as a small label above it.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small label above the title. Defaults to the page's sidebar section. */
  eyebrow?: string | null;
}) {
  const ref = useFadeIn<HTMLDivElement>();

  return (
    <div
      ref={ref}
      // Phone: the top bar already names the page, so the heading here steps
      // down and the block tightens; the description and actions stay.
      className="flex flex-col gap-4 pb-2 sm:flex-row sm:items-end sm:justify-between phone:flex-col! phone:items-stretch! phone:gap-3 phone:pb-1"
    >
      <div className="min-w-0">
        <PageTitle title={title} eyebrow={eyebrow} />
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground phone:mt-0">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 phone:flex-wrap">{actions}</div>
      )}
    </div>
  );
}

/**
 * A page's title: the brand serif, with the sidebar section the page belongs
 * to as a small label above it. Used by PageHeader, and by the pages that lay
 * out their own header, so every page names itself the same way.
 */
export function PageTitle({
  title,
  eyebrow,
  inShell = true,
}: {
  title: string;
  /** Small label above the title. Defaults to the page's sidebar section. */
  eyebrow?: string | null;
  /** Inside the app frame a phone's top bar already names the page. */
  inShell?: boolean;
}) {
  const pathname = usePathname();
  const label = eyebrow === undefined ? sectionFor(pathname) : eyebrow;
  return (
    <>
      {label && (
        <p
          className={cn(
            "mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
            inShell && "phone:hidden"
          )}
        >
          {label}
        </p>
      )}
      {/* On a phone inside the app, the top bar already shows this title and
          repeating it costs a tenth of the screen. It is hidden visually
          there but kept for screen readers, so the page still has its heading. */}
      <h1
        className={cn(
          "font-serif text-[34px] font-normal leading-[1.08] tracking-[-0.01em] text-foreground",
          inShell ? "phone:sr-only" : "phone:text-[28px]"
        )}
      >
        {title}
      </h1>
    </>
  );
}
