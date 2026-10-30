"use client";

// ============================================================
// Tringlo AI — Account Center
// ============================================================
//
// The signed-in person's own settings: name, sign-in email, password. Opened
// from the name in the sidebar (and the phone "More" sheet), rendered once in
// the app shell.
//
// Every change is decided by the server. Email changes are confirmed with a
// code sent to the new address; password changes need the current password,
// or — if it is forgotten — a code sent to the account's inbox.
//
// Motion is GSAP throughout, scoped with gsap.context and reverted on unmount.
// With reduced motion the window simply appears and disappears.
// ============================================================

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import {
  ArrowLeft,
  AtSign,
  Building2,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { prefersReducedMotion } from "@/lib/animation";
import {
  clearBrowserHeldWorkspaceState,
  useAccountCenter,
  useAuthStore,
  type AccountTab,
  type AuthUser,
} from "@/lib/store";
import { cn } from "@/lib/utils";

const MIN_PASSWORD = 10;
const RESEND_SECONDS = 30;

const TABS: Array<{ id: AccountTab; label: string; icon: typeof UserRound }> = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "email", label: "Email", icon: AtSign },
  { id: "password", label: "Password", icon: KeyRound },
];

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; status: number };

async function callApi<T>(path: string, method: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) useAuthStore.getState().handleUnauthorized();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: data?.error?.code,
        error:
          (typeof data?.error === "string" ? data.error : data?.error?.message) ??
          "Something went wrong. Try again.",
      };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your connection." };
  }
}

function initials(name: string | undefined): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A short, horizontal "no" — the universal wrong-answer shake. */
function shake(element: HTMLElement | null) {
  if (!element || prefersReducedMotion()) return;
  gsap.fromTo(
    element,
    { x: 0 },
    { keyframes: { x: [-9, 8, -6, 5, -3, 2, 0] }, duration: 0.45, ease: "power1.out" }
  );
}

/** 0–4, from length and variety. Only guidance: the server's rule is length. */
function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= MIN_PASSWORD) score++;
  if (password.length >= 14) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  if (password.length < MIN_PASSWORD) score = Math.min(score, 1);
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
  return { score, label: password.length < MIN_PASSWORD ? labels[0] : labels[score] };
}

// ------------------------------------------------------------
// Root
// ------------------------------------------------------------

export function AccountCenter() {
  const open = useAccountCenter((state) => state.open);
  const tab = useAccountCenter((state) => state.tab);
  const user = useAuthStore((state) => state.user);

  if (!open || !user || typeof document === "undefined") return null;
  // Keyed so each opening starts from a fresh window and a fresh entrance.
  return createPortal(<AccountWindow initialTab={tab} user={user} />, document.body);
}

function AccountWindow({ initialTab, user }: { initialTab: AccountTab; user: AuthUser }) {
  const hide = useAccountCenter((state) => state.hide);
  const signOut = useAuthStore((state) => state.signOut);

  const [tab, setTab] = useState<AccountTab>(initialTab);
  const [direction, setDirection] = useState(1);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const tabButtonsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const panesRef = useRef<Record<string, HTMLDivElement | null>>({});
  const ringRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const titleId = useId();

  // ---- entrance --------------------------------------------------------
  useLayoutEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const phone = window.matchMedia("(max-width: 767px)").matches;
    const context = gsap.context(() => {
      if (prefersReducedMotion()) return;

      const timeline = gsap.timeline({ defaults: { ease: "expo.out" } });
      timeline
        .fromTo(overlayRef.current, { opacity: 0 }, { opacity: 1, duration: 0.35, ease: "power2.out" })
        .fromTo(
          panelRef.current,
          phone
            ? { yPercent: 100, opacity: 1 }
            : { y: 28, scale: 0.94, opacity: 0, rotateX: 8, transformPerspective: 900 },
          phone
            ? { yPercent: 0, duration: 0.6 }
            : { y: 0, scale: 1, opacity: 1, rotateX: 0, duration: 0.7 },
          0.05
        )
        .fromTo(
          "[data-ac-avatar]",
          { scale: 0.4, opacity: 0, rotate: -12 },
          { scale: 1, opacity: 1, rotate: 0, duration: 0.8, ease: "back.out(2.2)" },
          0.22
        )
        .fromTo(
          "[data-ac-rise]",
          { y: 14, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.55, stagger: 0.06, ease: "power3.out" },
          0.28
        )
        .fromTo(
          "[data-ac-orb]",
          { scale: 0, opacity: 0 },
          { scale: 1, opacity: 1, duration: 1.2, stagger: 0.12, ease: "elastic.out(1, 0.6)" },
          0.15
        );

      // Slow ambient drift: the header breathes rather than sitting static.
      gsap.to("[data-ac-orb]", {
        x: "random(-18, 18)",
        y: "random(-10, 10)",
        duration: "random(3.5, 5.5)",
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        stagger: { each: 0.4, repeatRefresh: true },
      });
      if (ringRef.current) {
        gsap.to(ringRef.current, { rotate: 360, duration: 14, repeat: -1, ease: "none" });
      }
    }, panelRef.current?.parentElement ?? undefined);

    panelRef.current?.querySelector<HTMLElement>("[data-ac-autofocus]")?.focus({ preventScroll: true });

    return () => {
      context.revert();
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus?.();
    };
  }, []);

  // ---- exit ------------------------------------------------------------
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (prefersReducedMotion()) {
      hide();
      return;
    }
    const phone = window.matchMedia("(max-width: 767px)").matches;
    gsap
      .timeline({ onComplete: hide })
      .to(panelRef.current, phone
        ? { yPercent: 100, duration: 0.38, ease: "power3.in" }
        : { y: 18, scale: 0.96, opacity: 0, duration: 0.28, ease: "power2.in" })
      .to(overlayRef.current, { opacity: 0, duration: 0.25, ease: "power1.in" }, "-=0.18");
  }, [hide]);

  // Escape closes; Tab is kept inside the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // ---- tabs --------------------------------------------------------------
  useLayoutEffect(() => {
    const button = tabButtonsRef.current[tab];
    const indicator = indicatorRef.current;
    if (!button || !indicator) return;
    const target = { x: button.offsetLeft, width: button.offsetWidth };
    if (prefersReducedMotion()) {
      gsap.set(indicator, target);
    } else {
      gsap.to(indicator, { ...target, duration: 0.45, ease: "power3.out" });
    }

    const pane = panesRef.current[tab];
    if (pane && !prefersReducedMotion()) {
      gsap.fromTo(
        pane.querySelectorAll("[data-ac-field]"),
        { x: 22 * direction, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.45, stagger: 0.05, ease: "power3.out" }
      );
    }
  }, [tab, direction]);

  const selectTab = (next: AccountTab) => {
    if (next === tab) return;
    const order = TABS.map((entry) => entry.id);
    setDirection(order.indexOf(next) > order.indexOf(tab) ? 1 : -1);
    setTab(next);
  };

  const onTabKey = (event: React.KeyboardEvent) => {
    const order = TABS.map((entry) => entry.id);
    const index = order.indexOf(tab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = order[(index + (event.key === "ArrowRight" ? 1 : order.length - 1)) % order.length];
      selectTab(next);
      tabButtonsRef.current[next]?.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center phone:items-end">
      <div
        ref={overlayRef}
        onClick={requestClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(92dvh,760px)] w-[min(540px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] will-change-transform phone:w-full phone:rounded-b-none phone:rounded-t-3xl phone:pb-[env(safe-area-inset-bottom)]"
      >
        {/* ---- header ---------------------------------------------------- */}
        <div className="relative shrink-0 overflow-hidden border-b border-border px-6 pb-5 pt-6 phone:px-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.14] via-primary/[0.05] to-transparent"
          />
          <span data-ac-orb aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-44 w-44 rounded-full bg-chart-1/20 blur-3xl" />
          <span data-ac-orb aria-hidden="true" className="pointer-events-none absolute right-24 top-6 h-20 w-20 rounded-full bg-[#E8F056]/25 blur-2xl dark:bg-[#E8F056]/15" />
          <span data-ac-orb aria-hidden="true" className="pointer-events-none absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-chart-1/15 blur-2xl" />

          {/* Grab handle on phones — says "this sheet slides", which it does. */}
          <div className="absolute inset-x-0 top-2 hidden justify-center phone:flex" aria-hidden="true">
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>

          <button
            type="button"
            onClick={requestClose}
            aria-label="Close account center"
            className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4.5 w-4.5" />
          </button>

          <div className="relative flex items-center gap-4">
            <div data-ac-avatar className="relative h-16 w-16 shrink-0">
              <div
                ref={ringRef}
                aria-hidden="true"
                className="absolute -inset-[3px] rounded-full bg-[conic-gradient(from_0deg,var(--color-chart-1),#E8F056,var(--color-chart-1))] opacity-80"
              />
              <div className="absolute inset-0 flex items-center justify-center rounded-full border-2 border-card bg-primary text-lg font-bold tracking-wide text-primary-foreground">
                {initials(user.name)}
              </div>
            </div>
            <div className="min-w-0 flex-1 pr-8">
              <p data-ac-rise className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                Account center
              </p>
              <h2 id={titleId} data-ac-rise className="mt-0.5 truncate text-lg font-semibold text-foreground">
                {user.name || "Your account"}
              </h2>
              <p data-ac-rise className="truncate text-sm text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>

          <div data-ac-rise className="relative mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/70 px-2.5 py-1 text-xs text-foreground backdrop-blur">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              {user.tenantName || "Workspace"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-medium capitalize text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              {user.role === "owner" ? "Owner" : user.role || "Member"}
            </span>
          </div>
        </div>

        {/* ---- tabs ------------------------------------------------------ */}
        <div data-ac-rise className="shrink-0 px-6 pt-4 phone:px-5">
          <div
            role="tablist"
            aria-label="Account settings"
            onKeyDown={onTabKey}
            className="relative flex rounded-xl bg-muted p-1"
          >
            <span
              ref={indicatorRef}
              aria-hidden="true"
              className="absolute left-0 top-1 h-[calc(100%-8px)] rounded-lg bg-card shadow-sm ring-1 ring-border"
            />
            {TABS.map((entry) => {
              const active = entry.id === tab;
              return (
                <button
                  key={entry.id}
                  ref={(element) => {
                    tabButtonsRef.current[entry.id] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`ac-tab-${entry.id}`}
                  aria-selected={active}
                  aria-controls={`ac-pane-${entry.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectTab(entry.id)}
                  className={cn(
                    "relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <entry.icon className="h-4 w-4" />
                  {entry.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- panes ------------------------------------------------------ */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-5 phone:px-5">
          {TABS.map((entry) => (
            <div
              key={entry.id}
              ref={(element) => {
                panesRef.current[entry.id] = element;
              }}
              role="tabpanel"
              id={`ac-pane-${entry.id}`}
              aria-labelledby={`ac-tab-${entry.id}`}
              hidden={entry.id !== tab}
            >
              {entry.id === "profile" && <ProfilePane user={user} />}
              {entry.id === "email" && <EmailPane user={user} />}
              {entry.id === "password" && <PasswordPane user={user} />}
            </div>
          ))}
        </div>

        {/* ---- footer ----------------------------------------------------- */}
        <div className="flex shrink-0 items-center justify-between border-t border-border bg-muted/40 px-6 py-3 phone:px-5">
          <p className="min-w-0 text-xs text-muted-foreground">
            Changes are saved <span className="phone:hidden">to your account </span>right away.
          </p>
          <button
            type="button"
            onClick={() => {
              requestClose();
              void signOut();
            }}
            className="inline-flex shrink-0 items-center whitespace-nowrap gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Shared pieces
// ------------------------------------------------------------

function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div data-ac-field className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-xl border border-input bg-background px-3.5 text-[15px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60";

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        data-ac-autofocus={autoFocus ? "" : undefined}
        className={cn(inputClass, "pr-11")}
      />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function SubmitButton({
  busy,
  disabled,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      data-ac-field
      type="submit"
      disabled={busy || disabled}
      className="relative inline-flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-4 text-[15px] font-medium text-primary-foreground shadow-sm transition-[transform,opacity,box-shadow] hover:shadow-md hover:shadow-primary/25 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

/** Error text that slides in, and shakes the form it belongs to. */
function FormError({ message }: { message: string | null }) {
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  useLayoutEffect(() => {
    if (!message || !errorRef.current || prefersReducedMotion()) return;
    gsap.fromTo(errorRef.current, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
  }, [message]);
  if (!message) return null;
  return (
    <p
      ref={errorRef}
      role="alert"
      className="rounded-xl border border-destructive/25 bg-destructive/[0.07] px-3.5 py-2.5 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

/** A check that draws itself, inside a ring that pops. */
function SuccessMark({ title, detail }: { title: string; detail?: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      const circle = root.querySelector<SVGCircleElement>("circle");
      const path = root.querySelector<SVGPathElement>("path");
      const circleLength = circle?.getTotalLength?.() ?? 160;
      const pathLength = path?.getTotalLength?.() ?? 40;
      gsap.set(circle, { strokeDasharray: circleLength, strokeDashoffset: circleLength });
      gsap.set(path, { strokeDasharray: pathLength, strokeDashoffset: pathLength });
      gsap
        .timeline()
        .fromTo("[data-ac-badge]", { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(2.4)" })
        .to(circle, { strokeDashoffset: 0, duration: 0.55, ease: "power2.inOut" }, 0.05)
        .to(path, { strokeDashoffset: 0, duration: 0.35, ease: "power2.out" }, 0.45)
        .fromTo("[data-ac-success-text]", { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: "power2.out" }, 0.4)
        .fromTo("[data-ac-burst]", { scale: 0.6, opacity: 0.55 }, { scale: 1.9, opacity: 0, duration: 0.9, ease: "power2.out" }, 0.35);
    }, root);
    return () => context.revert();
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col items-center py-6 text-center" role="status">
      <div className="relative">
        <span data-ac-burst aria-hidden="true" className="absolute inset-0 rounded-full bg-emerald-500/30" />
        <div data-ac-badge className="relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
          <svg viewBox="0 0 56 56" className="h-14 w-14" fill="none" aria-hidden="true">
            <circle cx="28" cy="28" r="25" className="stroke-emerald-500" strokeWidth="3" />
            <path d="M17 29.5l7.5 7.5L39.5 21" className="stroke-emerald-500" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <p data-ac-success-text className="mt-4 text-base font-semibold text-foreground">
        {title}
      </p>
      {detail && (
        <div data-ac-success-text className="mt-1 max-w-sm text-sm text-muted-foreground">
          {detail}
        </div>
      )}
    </div>
  );
}

/** Six boxes, one digit each. Paste fills them all; Backspace walks back. */
function OtpInput({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const boxesRef = useRef<Array<HTMLInputElement | null>>([]);
  const rowRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    boxesRef.current[0]?.focus();
    if (!rowRef.current || prefersReducedMotion()) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        "input",
        { y: 16, opacity: 0, scale: 0.9 },
        { y: 0, opacity: 1, scale: 1, duration: 0.5, stagger: 0.05, ease: "back.out(1.8)" }
      );
    }, rowRef.current);
    return () => context.revert();
  }, []);

  const setDigits = (digits: string, focusIndex: number) => {
    onChange(digits.slice(0, 6));
    boxesRef.current[Math.min(focusIndex, 5)]?.focus();
  };

  const onInput = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    const chars = value.padEnd(6, " ").split("");
    // A paste (or a phone's one-time-code autofill) lands as several digits.
    for (let offset = 0; offset < digits.length && index + offset < 6; offset++) {
      chars[index + offset] = digits[offset];
    }
    const next = chars.join("").replace(/\s+$/, "");
    const box = boxesRef.current[index];
    if (box && !prefersReducedMotion()) {
      gsap.fromTo(box, { scale: 1.12 }, { scale: 1, duration: 0.3, ease: "back.out(3)" });
    }
    setDigits(next, index + digits.length);
  };

  const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      const chars = value.padEnd(6, " ").split("");
      if (chars[index] && chars[index] !== " ") {
        chars[index] = " ";
        onChange(chars.join("").replace(/\s+$/, ""));
      } else if (index > 0) {
        chars[index - 1] = " ";
        onChange(chars.join("").replace(/\s+$/, ""));
        boxesRef.current[index - 1]?.focus();
      }
    } else if (event.key === "ArrowLeft" && index > 0) {
      boxesRef.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < 5) {
      boxesRef.current[index + 1]?.focus();
    }
  };

  return (
    <div ref={rowRef} className="flex justify-between gap-2" role="group" aria-label="Six-digit code">
      {Array.from({ length: 6 }, (_, index) => {
        const digit = value[index] && value[index] !== " " ? value[index] : "";
        return (
          <input
            key={index}
            ref={(element) => {
              boxesRef.current[index] = element;
            }}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={`Digit ${index + 1}`}
            value={digit}
            disabled={disabled}
            onChange={(event) => onInput(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
            className={cn(
              "h-14 w-full min-w-0 rounded-xl border bg-background text-center font-mono text-2xl font-semibold text-foreground outline-none transition-[border-color,box-shadow] focus:border-primary focus:ring-4 focus:ring-primary/15 phone:h-12 phone:text-xl",
              invalid ? "border-destructive/60" : digit ? "border-primary/50" : "border-input"
            )}
          />
        );
      })}
    </div>
  );
}

function StrengthMeter({ password }: { password: string }) {
  const barRef = useRef<HTMLSpanElement | null>(null);
  const { score, label } = passwordStrength(password);
  const colors = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#10b981"];

  useLayoutEffect(() => {
    if (!barRef.current) return;
    const width = password ? `${Math.max(12, (score / 4) * 100)}%` : "0%";
    const vars = { width, backgroundColor: colors[score] };
    if (prefersReducedMotion()) gsap.set(barRef.current, vars);
    else gsap.to(barRef.current, { ...vars, duration: 0.45, ease: "power3.out" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, password.length > 0]);

  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <span ref={barRef} className="block h-full w-0 rounded-full" />
      </div>
      <span className="w-16 text-right text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = window.setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

// ------------------------------------------------------------
// Profile
// ------------------------------------------------------------

function ProfilePane({ user }: { user: AuthUser }) {
  const setUser = useAuthStore((state) => state.setUser);
  const [name, setName] = useState(user.name);
  const [workspace, setWorkspace] = useState(user.tenantName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const savedRef = useRef<HTMLSpanElement | null>(null);
  const isOwner = user.role === "owner";

  const changed =
    name.trim() !== user.name || (isOwner && workspace.trim() !== user.tenantName);

  useLayoutEffect(() => {
    if (!savedAt || !savedRef.current || prefersReducedMotion()) return;
    gsap
      .timeline()
      .fromTo(savedRef.current, { opacity: 0, y: 6, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.35, ease: "back.out(2)" })
      .to(savedRef.current, { opacity: 0, duration: 0.4, delay: 2.2 });
  }, [savedAt]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    setError(null);
    const body: Record<string, string> = {};
    if (name.trim() !== user.name) body.name = name;
    if (isOwner && workspace.trim() !== user.tenantName) body.workspaceName = workspace;
    const result = await callApi<{ user: AuthUser }>("/api/account/profile", "PATCH", body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      shake(formRef.current);
      return;
    }
    setUser(result.data.user);
    setName(result.data.user.name);
    setWorkspace(result.data.user.tenantName);
    setSavedAt(Date.now());
  };

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Your name" htmlFor="ac-name" hint="Shown in the sidebar and on emails Tringlo sends you.">
        <input
          id="ac-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={80}
          data-ac-autofocus=""
          className={inputClass}
        />
      </Field>

      <Field
        label="Workspace name"
        htmlFor="ac-workspace"
        hint={isOwner ? "Your business, as your team and your emails see it." : "Only the workspace owner can rename it."}
      >
        <input
          id="ac-workspace"
          value={workspace}
          onChange={(event) => setWorkspace(event.target.value)}
          maxLength={80}
          disabled={!isOwner}
          className={inputClass}
        />
      </Field>

      <FormError message={error} />

      <div className="flex items-center gap-3">
        <SubmitButton busy={busy} disabled={!changed || !name.trim()}>
          Save changes
        </SubmitButton>
      </div>
      <p className="h-5 text-center text-sm" aria-live="polite">
        {savedAt && (
          <span ref={savedRef} className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-4 w-4" />
            Saved
          </span>
        )}
      </p>

      {isOwner && <DeleteWorkspace user={user} />}
    </form>
  );
}

/**
 * Deleting the workspace.
 *
 * Closed by default, and it asks for the workspace's name in full before the
 * button does anything: this removes a company's entire history, and there is
 * no undo. What it will remove is said plainly first, rather than after.
 */
function DeleteWorkspace({ user }: { user: AuthUser }) {
  const router = useRouter();
  const signedOut = useAuthStore((state) => state.handleUnauthorized);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaceName = user.tenantName ?? "";
  const matches = typed.trim() === workspaceName && workspaceName.length > 0;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/workspace", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: typed.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error?.message ?? "The workspace was not deleted.");
      // Everything this browser held belonged to a workspace that no longer
      // exists; the sign-in page is the only place left to go.
      clearBrowserHeldWorkspaceState();
      signedOut();
      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The workspace was not deleted.");
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="border-t pt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-destructive transition-colors hover:text-destructive/80"
        >
          Delete this workspace
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <div>
        <h3 className="text-sm font-semibold text-destructive">Delete {workspaceName}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          This removes the workspace and everything in it — leads, calls, transcripts, recordings, customers and
          what Tringlo remembers about them, campaigns, follow-ups and its voice provider settings — along with the
          accounts that can sign into it. It cannot be undone.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Your Sarvam agent, deployment and phone number are not touched. Remove those in Sarvam if you want them
          gone too.
        </p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Type <span className="font-mono text-foreground">{workspaceName}</span> to confirm
        </span>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </label>

      <FormError message={error} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={remove}
          disabled={!matches || busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-destructive px-3.5 text-sm font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Delete workspace
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Email
// ------------------------------------------------------------

function EmailPane({ user }: { user: AuthUser }) {
  const setUser = useAuthStore((state) => state.setUser);
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useCountdown();
  const formRef = useRef<HTMLFormElement | null>(null);
  const stepRef = useRef<HTMLDivElement | null>(null);

  // Each step slides in from the right.
  useLayoutEffect(() => {
    if (!stepRef.current || prefersReducedMotion() || step === "form") return;
    gsap.fromTo(stepRef.current, { x: 26, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" });
  }, [step]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    const result = await callApi<{ sentTo: string }>("/api/account/email/request", "POST", {
      newEmail,
      currentPassword: password,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      shake(formRef.current);
      return false;
    }
    setResendIn(RESEND_SECONDS);
    return true;
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (await requestCode()) {
      setCode("");
      setStep("code");
    }
  };

  const verify = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (busy || code.replace(/\D/g, "").length !== 6) return;
    setBusy(true);
    setError(null);
    const result = await callApi<{ user: AuthUser }>("/api/account/email/confirm", "POST", { code });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setCode("");
      shake(formRef.current);
      return;
    }
    setUser(result.data.user);
    setPassword("");
    setStep("done");
  };

  // Verifies by itself once the sixth digit lands.
  const onCode = (value: string) => {
    setCode(value);
    if (value.replace(/\D/g, "").length === 6 && !busy) {
      window.setTimeout(() => formRef.current?.requestSubmit(), 120);
    }
  };

  if (step === "done") {
    return (
      <SuccessMark
        title="Sign-in email updated"
        detail={
          <>
            From now on, sign in with <span className="font-medium text-foreground">{user.email}</span>. We let your
            previous address know too.
          </>
        }
      />
    );
  }

  if (step === "code") {
    return (
      <div ref={stepRef}>
        <form ref={formRef} onSubmit={verify} className="space-y-5" noValidate>
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Mail className="h-4.5 w-4.5" />
            </div>
            <p className="text-sm text-foreground">
              We sent a six-digit code to <span className="font-semibold">{newEmail.trim().toLowerCase()}</span>. It
              expires in 10 minutes.
            </p>
          </div>

          <OtpInput value={code} onChange={onCode} disabled={busy} invalid={Boolean(error)} />

          <FormError message={error} />

          <SubmitButton busy={busy} disabled={code.replace(/\D/g, "").length !== 6}>
            Verify and update email
          </SubmitButton>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Use a different email
            </button>
            <button
              type="button"
              disabled={resendIn > 0 || busy}
              onClick={() => void requestCode()}
              className="font-medium text-primary transition-opacity disabled:cursor-default disabled:text-muted-foreground"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={submitForm} className="space-y-4" noValidate>
      <div data-ac-field className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
        <p className="text-xs text-muted-foreground">Current sign-in email</p>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">{user.email}</p>
      </div>

      <Field label="New email address" htmlFor="ac-new-email" hint="We'll send a code there to confirm it's yours.">
        <input
          id="ac-new-email"
          type="email"
          inputMode="email"
          value={newEmail}
          onChange={(event) => setNewEmail(event.target.value)}
          autoComplete="email"
          placeholder="you@company.com"
          className={inputClass}
        />
      </Field>

      <Field label="Current password" htmlFor="ac-email-password" hint="To make sure it's really you.">
        <PasswordInput id="ac-email-password" value={password} onChange={setPassword} autoComplete="current-password" />
      </Field>

      <FormError message={error} />

      <SubmitButton busy={busy} disabled={!newEmail.trim() || !password}>
        Send verification code
      </SubmitButton>
    </form>
  );
}

// ------------------------------------------------------------
// Password
// ------------------------------------------------------------

function PasswordPane({ user }: { user: AuthUser }) {
  const signOut = useAuthStore((state) => state.signOut);
  const [mode, setMode] = useState<"current" | "code" | "done" | "doneByCode">("current");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState("");
  const [resendIn, setResendIn] = useCountdown();
  const formRef = useRef<HTMLFormElement | null>(null);
  const stepRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!stepRef.current || prefersReducedMotion() || mode !== "code") return;
    gsap.fromTo(stepRef.current, { x: 26, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" });
  }, [mode]);

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const ready = next.length >= MIN_PASSWORD && next === confirm;

  const fail = (message: string) => {
    setError(message);
    shake(formRef.current);
  };

  const changeWithCurrent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!current) return fail("Enter your current password.");
    if (!ready) return fail(tooShort ? `Use at least ${MIN_PASSWORD} characters.` : "The new passwords don't match.");
    setBusy(true);
    setError(null);
    const result = await callApi<{ message: string }>("/api/account/password", "POST", {
      currentPassword: current,
      newPassword: next,
    });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    setDoneMessage(result.data.message);
    setCurrent("");
    setNext("");
    setConfirm("");
    setMode("done");
  };

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const result = await callApi("/api/auth/password-reset/request", "POST", { email: user.email });
    setBusy(false);
    if (!result.ok) {
      fail(result.error);
      return false;
    }
    setResendIn(RESEND_SECONDS);
    return true;
  };

  const startCodeFlow = async () => {
    if (await sendCode()) {
      setCode("");
      setNext("");
      setConfirm("");
      setMode("code");
    }
  };

  const changeWithCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (code.replace(/\D/g, "").length !== 6) return fail("Enter the six-digit code from the email.");
    if (!ready) return fail(tooShort ? `Use at least ${MIN_PASSWORD} characters.` : "The new passwords don't match.");
    setBusy(true);
    setError(null);
    const result = await callApi("/api/auth/password-reset/confirm", "POST", {
      email: user.email,
      code,
      password: next,
    });
    setBusy(false);
    if (!result.ok) return fail(result.error);
    // A code reset signs out every session, this one included.
    setMode("doneByCode");
    window.setTimeout(() => void signOut(), 2600);
  };

  if (mode === "done") {
    return (
      <SuccessMark
        title="Password updated"
        detail={
          <>
            {doneMessage} You&apos;re still signed in here.
            <button
              type="button"
              onClick={() => setMode("current")}
              className="mt-3 block w-full text-sm font-medium text-primary"
            >
              Done
            </button>
          </>
        }
      />
    );
  }

  if (mode === "doneByCode") {
    return (
      <SuccessMark
        title="Password updated"
        detail="For safety, every device was signed out. Taking you to sign in with your new password…"
      />
    );
  }

  const newPasswordFields = (
    <>
      <Field label="New password" htmlFor="ac-new-password">
        <PasswordInput id="ac-new-password" value={next} onChange={setNext} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
      </Field>
      <div data-ac-field>
        <StrengthMeter password={next} />
      </div>
      <Field
        label="Confirm new password"
        htmlFor="ac-confirm-password"
        hint={mismatch ? <span className="text-destructive">Doesn&apos;t match the new password.</span> : undefined}
      >
        <PasswordInput id="ac-confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </Field>
    </>
  );

  if (mode === "code") {
    return (
      <div ref={stepRef}>
        <form ref={formRef} onSubmit={changeWithCode} className="space-y-4" noValidate>
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Mail className="h-4.5 w-4.5" />
            </div>
            <p className="text-sm text-foreground">
              We sent a code to <span className="font-semibold">{user.email}</span>. Enter it with your new password.
            </p>
          </div>

          <OtpInput value={code} onChange={setCode} disabled={busy} invalid={Boolean(error)} />
          {newPasswordFields}

          <FormError message={error} />

          <SubmitButton busy={busy} disabled={code.replace(/\D/g, "").length !== 6 || !ready}>
            Set new password
          </SubmitButton>

          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => {
                setMode("current");
                setError(null);
              }}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              I remember it
            </button>
            <button
              type="button"
              disabled={resendIn > 0 || busy}
              onClick={() => void sendCode()}
              className="font-medium text-primary disabled:cursor-default disabled:text-muted-foreground"
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Setting a password with a code signs you out everywhere, including here.
          </p>
        </form>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={changeWithCurrent} className="space-y-4" noValidate>
      <Field
        label="Current password"
        htmlFor="ac-current-password"
        hint={
          <button
            type="button"
            onClick={() => void startCodeFlow()}
            disabled={busy}
            className="font-medium text-primary hover:underline disabled:opacity-60"
          >
            Forgot it? Email me a code instead
          </button>
        }
      >
        <PasswordInput id="ac-current-password" value={current} onChange={setCurrent} autoComplete="current-password" />
      </Field>

      {newPasswordFields}

      <FormError message={error} />

      <SubmitButton busy={busy} disabled={!current || !ready}>
        Update password
      </SubmitButton>
      <p className="text-center text-xs text-muted-foreground">Other devices are signed out; you stay signed in here.</p>
    </form>
  );
}
