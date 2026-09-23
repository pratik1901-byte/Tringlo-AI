"use client";

// ============================================================
// Dialo AI — Authentication
// ============================================================
//
// A split composition: the brand and its signal visual hold the left, the form
// holds the right. Asymmetric on purpose — the form column is narrower than the
// brand column, which reads as editorial rather than as two equal halves.
//
// Three modes on one screen, because they are the same task: sign in, create a
// workspace, reset a password. They share a card and cross-fade, so switching
// never feels like a page load.
//
// What is deliberately absent:
//
//   - Provider buttons. Dialo has no OAuth, and a Google button that opens
//     nothing is exactly the decoration the brief forbids.
//   - A "we emailed you a link" flow. There is no email service. Recovery
//     really happens from the server machine, and the screen says so.
//
// Everything here talks to the real backend. There is no path through this
// screen that produces a session the server did not issue.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import gsap from "gsap";

import { useAuthStore } from "@/lib/store";
import { MOTION, prefersReducedMotion } from "@/lib/animation";
import { SignalField } from "@/components/auth/signal-field";

type Mode = "signIn" | "signUp" | "reset";

interface SetupStatus {
  needsSetup: boolean;
  canSetupHere: boolean;
}

const MIN_PASSWORD_LENGTH = 10;

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);
  const refresh = useAuthStore((state) => state.refresh);
  const expired = useAuthStore((state) => state.expired);

  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [mode, setMode] = useState<Mode>("signIn");

  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------- setup
  const loadSetupStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/setup-status", { cache: "no-store" });
      const status: SetupStatus = response.ok
        ? await response.json()
        : { needsSetup: false, canSetupHere: false };

      setSetup(status);

      // First run has no account to sign into, so the form opens on create.
      // Decided here, where the answer arrives, rather than in an effect
      // reacting to it — that would be a render caused by a render.
      if (status.needsSetup && status.canSetupHere) setMode("signUp");
    } catch {
      // Unreachable status endpoint: show the ordinary sign-in form, which is
      // right for an installation that already has accounts.
      setSetup({ needsSetup: false, canSetupHere: false });
    }
  }, []);

  // Scheduled rather than called inline, matching lib/use-dialo-data: resolving
  // it synchronously inside the effect body cascades an extra render.
  useEffect(() => {
    const timer = setTimeout(loadSetupStatus, 0);
    return () => clearTimeout(timer);
  }, [loadSetupStatus]);

  // ---------------------------------------------------------------- entrance
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const context = gsap.context(() => {
      const timeline = gsap.timeline();

      // The brand settles first, then the form arrives — the eye is given
      // somewhere to land before it is asked to do anything.
      timeline.fromTo(
        "[data-brand-line]",
        { opacity: 0, y: 18 },
        {
          opacity: 1,
          y: 0,
          duration: MOTION.slow,
          ease: MOTION.ease,
          stagger: 0.08,
          clearProps: "transform",
        }
      );

      timeline.fromTo(
        cardRef.current,
        { opacity: 0, y: 20 },
        { opacity: 1, y: 0, duration: MOTION.base, ease: MOTION.ease, clearProps: "transform" },
        0.18
      );
    }, rootRef);

    return () => context.revert();
  }, []);

  // Cross-fade when the mode changes, so switching reads as one surface
  // rearranging rather than a new page. Fields stagger in behind it.
  useEffect(() => {
    if (prefersReducedMotion() || !panelRef.current) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        panelRef.current,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: MOTION.base, ease: MOTION.ease, clearProps: "transform" }
      );

      gsap.fromTo(
        "[data-field]",
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: MOTION.base,
          ease: MOTION.ease,
          stagger: 0.04,
          delay: 0.05,
          clearProps: "transform",
        }
      );
    }, panelRef);

    return () => context.revert();
  }, [mode, setup]);

  // ---------------------------------------------------------------- helpers
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setPassword("");
    setConfirmPassword("");
  };

  /** Settles the card back into place. Used only on a rejected submission. */
  const rejectCard = () => {
    if (prefersReducedMotion() || !cardRef.current) return;
    gsap.fromTo(
      cardRef.current,
      { x: -5 },
      { x: 0, duration: 0.45, ease: "elastic.out(1, 0.45)" }
    );
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = "That does not look like an email address.";

    if (!password) errors.password = "Enter your password.";
    else if (mode !== "signIn" && password.length < MIN_PASSWORD_LENGTH)
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

    if (mode === "signUp" && !businessName.trim()) {
      errors.businessName = "Name your workspace.";
    }

    if (mode !== "signIn" && confirmPassword !== password) {
      errors.confirmPassword = "The passwords do not match.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) rejectCard();
    return Object.keys(errors).length === 0;
  };

  /** Plays the card out, then navigates. Only ever called after a real session. */
  const enterApp = () => {
    if (prefersReducedMotion() || !cardRef.current) {
      router.replace("/dashboard");
      return;
    }
    gsap.to(cardRef.current, {
      opacity: 0,
      y: -12,
      duration: MOTION.fast,
      ease: MOTION.easeInOut,
      onComplete: () => router.replace("/dashboard"),
    });
  };

  // ---------------------------------------------------------------- submit
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (!validate()) return;

    setBusy(true);

    try {
      if (mode === "signIn") {
        const result = await signIn(email, password, remember);
        if (!result.ok) {
          setError(result.error ?? "Could not sign in.");
          rejectCard();
          return;
        }
        setPassword("");
        enterApp();
        return;
      }

      if (mode === "signUp") {
        const response = await fetch("/api/auth/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name, businessName }),
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          setError(body?.error?.message ?? "Could not create the workspace.");
          rejectCard();
          return;
        }

        // Created; sign in with it rather than asking for the same details twice.
        const result = await signIn(email, password, remember);
        setPassword("");
        setConfirmPassword("");

        if (result.ok) {
          await refresh();
          enterApp();
        } else {
          setNotice("Workspace created. Sign in to continue.");
          setMode("signIn");
          await loadSetupStatus();
        }
        return;
      }

      // reset
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error?.message ?? "Could not reset the password.");
        rejectCard();
        return;
      }

      setNotice("Password updated. Sign in with the new one.");
      setMode("signIn");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      rejectCard();
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- render
  const canCreate = setup?.canSetupHere === true;
  const firstRun = setup?.needsSetup === true;

  const heading =
    mode === "signUp"
      ? firstRun
        ? "Create your workspace"
        : "Create a workspace"
      : mode === "reset"
        ? "Reset password"
        : "Sign in";

  const subheading =
    mode === "signUp"
      ? firstRun
        ? "The first account for this installation."
        : "A separate workspace, with its own leads, calls and history."
      : mode === "reset"
        ? "Set a new password for an existing account."
        : "Welcome back.";

  const submitLabel =
    mode === "signUp" ? "Create workspace" : mode === "reset" ? "Update password" : "Sign in";

  return (
    <div ref={rootRef} className="min-h-screen bg-background lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* ---------------------------------------------------------------- */}
      {/* Brand. A full column on desktop; a compact header on phones, where  */}
      {/* the form must be reachable without scrolling past a hero.          */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative flex flex-col justify-between overflow-hidden border-b border-border bg-card px-6 py-7 lg:border-b-0 lg:border-r lg:px-14 lg:py-14">
        <div className="flex items-center gap-2.5" data-brand-line>
          <span className="h-5 w-[3px] rounded-full bg-primary" />
          <span className="text-sm font-semibold tracking-tight text-foreground">Dialo</span>
        </div>

        <div className="hidden max-w-lg lg:block">
          <h1
            data-brand-line
            className="text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground"
          >
            Every conversation,
            <br />
            accounted for.
          </h1>
          <p
            data-brand-line
            className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground"
          >
            Dialo places the call, listens, and records what was actually said — so what you read
            afterwards is the conversation, not an estimate of it.
          </p>
        </div>

        {/* The signal. Sits low in the column so it reads as a baseline the
            type rests on, rather than a banner competing with it. */}
        <div
          data-brand-line
          className="pointer-events-none mt-6 h-16 w-full text-primary sm:h-20 lg:mt-0 lg:h-36"
        >
          <SignalField className="h-full w-full" />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Form                                                              */}
      {/* ---------------------------------------------------------------- */}
      <section className="flex items-center justify-center px-6 py-10 lg:px-12">
        <div ref={cardRef} className="w-full max-w-[380px]">
          {setup === null ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="sr-only">Loading</span>
            </div>
          ) : (
            <div ref={panelRef}>
              <header data-field>
                <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-foreground">
                  {heading}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">{subheading}</p>
              </header>

              {/* Status. Announced, because a failure that is only visible is a
                  failure a screen-reader user cannot explain. */}
              {expired && !error && !notice && (
                <Message tone="warning">Your session ended. Sign in again to continue.</Message>
              )}
              {notice && <Message tone="positive">{notice}</Message>}
              {error && (
                <Message tone="negative" alert>
                  {error}
                </Message>
              )}
              {firstRun && !canCreate && (
                <Message tone="neutral">
                  No account exists yet. For safety, the first one can only be created from a
                  browser on the machine running Dialo.
                </Message>
              )}

              <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
                {mode === "signUp" && (
                  <>
                    <Field
                      id="businessName"
                      label="Workspace"
                      value={businessName}
                      onChange={setBusinessName}
                      placeholder="Your company"
                      error={fieldErrors.businessName}
                      disabled={busy}
                      autoComplete="organization"
                    />
                    <Field
                      id="name"
                      label="Your name"
                      value={name}
                      onChange={setName}
                      placeholder="Optional"
                      disabled={busy}
                      autoComplete="name"
                    />
                  </>
                )}

                <Field
                  id="email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@company.com"
                  error={fieldErrors.email}
                  disabled={busy}
                  autoComplete="username"
                />

                <Field
                  id="password"
                  label={mode === "reset" ? "New password" : "Password"}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={
                    mode === "signIn" ? "••••••••" : `At least ${MIN_PASSWORD_LENGTH} characters`
                  }
                  error={fieldErrors.password}
                  disabled={busy}
                  autoComplete={mode === "signIn" ? "current-password" : "new-password"}
                  trailing={
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  }
                />

                {mode !== "signIn" && (
                  <Field
                    id="confirmPassword"
                    label="Confirm password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Repeat it"
                    error={fieldErrors.confirmPassword}
                    disabled={busy}
                    autoComplete="new-password"
                  />
                )}

                {mode === "signIn" && (
                  <div data-field className="flex items-center justify-between pt-0.5">
                    <Checkbox checked={remember} onChange={setRemember} disabled={busy}>
                      Stay signed in
                    </Checkbox>

                    {canCreate && (
                      <button
                        type="button"
                        onClick={() => switchMode("reset")}
                        className="rounded-sm text-[13px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                )}

                <div data-field className="pt-1">
                  <SubmitButton busy={busy} disabled={firstRun && !canCreate}>
                    {submitLabel}
                  </SubmitButton>
                </div>
              </form>

              {/* Mode switching. Only offered where the server would accept it,
                  so no control here leads to a guaranteed refusal. */}
              <div data-field className="mt-6 border-t border-border pt-5 text-[13px]">
                {mode === "signIn" ? (
                  canCreate ? (
                    <p className="text-muted-foreground">
                      Need a separate workspace?{" "}
                      <SwitchLink onClick={() => switchMode("signUp")}>Create one</SwitchLink>
                    </p>
                  ) : (
                    <p className="leading-relaxed text-muted-foreground">
                      Workspaces and password resets are handled from the machine running Dialo.
                    </p>
                  )
                ) : (
                  <p className="text-muted-foreground">
                    {mode === "reset"
                      ? "Remembered it? "
                      : firstRun
                        ? "Already have an account? "
                        : "Back to "}
                    <SwitchLink onClick={() => switchMode("signIn")}>Sign in</SwitchLink>
                  </p>
                )}

                {mode === "reset" && (
                  <p className="mt-3 leading-relaxed text-muted-foreground">
                    Dialo does not send email, so there is no reset link. A password can be changed
                    from this machine, and doing so signs out every existing session for that
                    account.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------
// Pieces
// ------------------------------------------------------------------

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  error,
  disabled,
  autoComplete,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  error?: string;
  disabled?: boolean;
  autoComplete?: string;
  trailing?: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The focus micro-interaction: a hairline draws in under the field. Cheap,
  // and it makes the input feel answered rather than merely outlined.
  const underline = (to: number) => {
    if (prefersReducedMotion() || !wrapRef.current) return;
    const line = wrapRef.current.querySelector("[data-underline]");
    if (line) gsap.to(line, { scaleX: to, duration: MOTION.fast, ease: MOTION.ease });
  };

  return (
    <div data-field>
      <label htmlFor={id} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>

      <div ref={wrapRef} className="relative mt-1.5">
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => underline(1)}
          onBlur={() => underline(0)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`block h-11 w-full rounded-md border bg-card px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 ${
            error ? "border-destructive" : "border-input focus:border-ring"
          } ${trailing ? "pr-11" : ""}`}
        />

        {trailing && (
          <span className="absolute inset-y-0 right-2 flex items-center">{trailing}</span>
        )}

        <span
          data-underline
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-ring"
        />
      </div>

      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[12.5px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-muted-foreground">
      <span className="relative flex h-4 w-4 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer h-4 w-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-card transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
        />
        <Check className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
      </span>
      {children}
    </label>
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
  const ref = useRef<HTMLButtonElement | null>(null);

  // Hover lifts the button a hair. One property, one easing — enough to feel
  // responsive without becoming a performance.
  const lift = (to: number) => {
    if (prefersReducedMotion() || !ref.current || busy) return;
    gsap.to(ref.current, { y: to, duration: MOTION.fast, ease: MOTION.ease });
  };

  return (
    <button
      ref={ref}
      type="submit"
      disabled={busy || disabled}
      onMouseEnter={() => lift(-1)}
      onMouseLeave={() => lift(0)}
      onFocus={() => lift(-1)}
      onBlur={() => lift(0)}
      className="flex h-11 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="sr-only">Working</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

function SwitchLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {children}
    </button>
  );
}

function Message({
  tone,
  alert,
  children,
}: {
  tone: "warning" | "negative" | "positive" | "neutral";
  alert?: boolean;
  children: React.ReactNode;
}) {
  const styles = {
    warning:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
    negative: "border-destructive/40 bg-destructive/5 text-foreground",
    positive:
      "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    neutral: "border-border bg-muted text-muted-foreground",
  }[tone];

  return (
    <p
      role={alert ? "alert" : "status"}
      className={`mt-5 rounded-md border px-3 py-2.5 text-[13px] leading-relaxed ${styles}`}
    >
      {children}
    </p>
  );
}
