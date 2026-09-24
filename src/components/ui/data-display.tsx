"use client";

// ============================================================
// Dialo AI — Shared Display Primitives
// ============================================================
// Status, metrics, and the loading / empty / error states every data screen
// needs. Centralised so "no data" looks and reads the same everywhere.
// ============================================================

import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { EMPTY, callStatePresentation, type StatusPresentation } from "@/lib/format";
import { useCountUp, useFadeIn } from "@/lib/animation";

// ------------------------------------------------------------
// Status
// ------------------------------------------------------------

const TONE_CLASS: Record<StatusPresentation["tone"], string> = {
  neutral: "border-border bg-muted/60 text-muted-foreground",
  pending: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  positive:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  negative: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
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
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASS[presentation.tone],
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
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
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
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
}

export function MetricCard({
  label,
  value,
  format,
  caption,
  captionTone = "neutral",
}: MetricCardProps) {
  const display = useCountUp(value, format);

  return (
    // Phone: two cards share a row, so the padding and the figure come down a
    // step and the caption is allowed two lines instead of pushing the height.
    <div className="rounded-lg border bg-card p-5 phone:p-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground phone:text-[10.5px]">
        {label}
      </p>
      <p className="mt-3 font-heading text-3xl font-semibold tabular-nums tracking-tight text-foreground phone:mt-2 phone:text-2xl">
        {value === null ? EMPTY : display || format(value)}
      </p>
      <p
        className={cn(
          "mt-1.5 text-xs phone:line-clamp-2 phone:text-[11px] phone:leading-snug",
          captionTone === "positive" && "text-emerald-600 dark:text-emerald-400",
          captionTone === "negative" && "text-red-600 dark:text-red-400",
          captionTone === "neutral" && "text-muted-foreground"
        )}
      >
        {caption ?? EMPTY}
      </p>
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
    <div className="flex items-center justify-center gap-2.5 rounded-lg border border-dashed bg-card/50 px-6 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
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
      className="flex flex-col items-center rounded-lg border border-dashed bg-card px-6 py-16 text-center"
    >
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border bg-muted/60">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <h3 className="font-heading text-base font-semibold tracking-tight">{title}</h3>
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

/** Page heading with an optional actions cluster. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const ref = useFadeIn<HTMLDivElement>();

  return (
    <div
      ref={ref}
      // Phone: the top bar already names the page, so the heading here steps
      // down a size and the block tightens; the description and actions stay.
      className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between phone:flex-col! phone:items-stretch! phone:gap-3 phone:pb-4"
    >
      <div>
        {/* On a phone the top bar already shows this title, and repeating it
            costs a tenth of the screen. It is hidden visually there but kept
            for screen readers, so the page still has its heading. */}
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground phone:sr-only">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground phone:mt-0">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 phone:flex-wrap">{actions}</div>
      )}
    </div>
  );
}
