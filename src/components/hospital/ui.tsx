"use client";

// ============================================================
// Wellness Hospital — the pieces every page is built from
// ============================================================
//
// Small, plain and shared, so a table on Appointments and a table on Patients
// are the same table, and a status reads the same way wherever it appears.
// ============================================================

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ------------------------------------------------------------
// Page furniture
// ------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{eyebrow}</p>
        )}
        <h1 className="font-display text-[30px] leading-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-w-0 rounded-xl border bg-surface", className)}>{children}</div>;
}

export function CardHead({ title, note, actions }: { title: string; note?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {note && <p className="mt-0.5 text-xs text-ink-muted">{note}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** One figure. `demo` says out loud when it counts demonstration rows. */
export function Stat({
  label,
  value,
  note,
  tone = "plain",
  href,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  tone?: "plain" | "sage" | "clay" | "alert";
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "mt-2 font-display text-[34px] leading-none tabular",
          tone === "sage" && "text-sage",
          tone === "clay" && "text-clay",
          tone === "alert" && "text-alert"
        )}
      >
        {value}
      </p>
      {note ? <p className="mt-2 text-xs text-ink-muted">{note}</p> : <p className="mt-2 text-xs">&nbsp;</p>}
    </>
  );
  const className = cn(
    "block rounded-xl border bg-surface p-5 transition-colors",
    href && "hover:border-sage/50"
  );
  return href ? (
    <a href={href} className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

// ------------------------------------------------------------
// Status
// ------------------------------------------------------------

export type Tone = "neutral" | "good" | "waiting" | "warn" | "bad";

const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-muted",
  good: "bg-sage-soft text-sage-ink",
  waiting: "bg-sunken text-ink-soft",
  warn: "bg-clay-soft text-clay",
  bad: "bg-alert-soft text-alert",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-ink-muted/50",
  good: "bg-sage",
  waiting: "bg-ink-muted",
  warn: "bg-clay",
  bad: "bg-alert",
};

/** A state, said in a word, with a dot so it does not rely on colour alone. */
export function Status({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11.5px] font-medium leading-4",
        TONES[tone]
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOTS[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}

/** How each appointment status reads and which tone it carries. */
export function appointmentTone(status: string): Tone {
  switch (status) {
    case "confirmed":
      return "good";
    case "completed":
      return "good";
    case "requested":
      return "waiting";
    case "rescheduled":
      return "warn";
    case "missed":
      return "warn";
    case "cancelled":
      return "bad";
    default:
      return "neutral";
  }
}

export function reminderTone(status: string): Tone {
  switch (status) {
    case "sent":
      return "good";
    case "scheduled":
      return "waiting";
    case "due":
    case "calling":
      return "warn";
    case "failed":
      return "bad";
    default:
      return "neutral";
  }
}

/** Marks a row that is demonstration data, so nobody mistakes it for a patient. */
export function DemoTag() {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-sunken text-ink-muted">
      Demo
    </span>
  );
}

// ------------------------------------------------------------
// Controls
// ------------------------------------------------------------

export function Button({
  children,
  variant = "plain",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "plain" | "quiet" | "danger" }) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variant === "primary" && "bg-sage text-white hover:opacity-90",
        variant === "plain" && "border bg-raised text-ink hover:bg-sunken",
        variant === "quiet" && "text-ink-muted hover:bg-sunken hover:text-ink",
        variant === "danger" && "border border-alert/40 text-alert hover:bg-alert-soft",
        className
      )}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border px-3 text-sm text-ink outline-none transition-colors focus-visible:border-sage";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-ink-muted">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------
// Tables and states
// ------------------------------------------------------------

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b bg-sunken/60">
          <tr>
            {head.map((column) => (
              <th key={column} className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.07em] text-ink-muted">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 rounded-xl border border-dashed px-6 py-14 text-sm text-ink-muted">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-surface px-6 py-14 text-center">
      <h3 className="font-display text-[22px] text-ink">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-muted">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Problem({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-alert/30 bg-alert-soft px-5 py-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-alert" />
      <div className="flex-1 text-sm text-ink">{message}</div>
      {onRetry && (
        <Button variant="quiet" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Says a thing is not set up, rather than pretending it works. */
export function NotConfigured({ what, how }: { what: string; how: string }) {
  return (
    <div className="rounded-xl border border-clay/30 bg-clay-soft px-5 py-4 text-sm">
      <p className="font-medium text-ink">{what}</p>
      <p className="mt-1 leading-relaxed text-ink-soft">{how}</p>
    </div>
  );
}

// ------------------------------------------------------------
// Dialog
// ------------------------------------------------------------

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.4)] outline-none sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}
