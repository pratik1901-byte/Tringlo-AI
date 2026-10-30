"use client";

// ============================================================
// Tringlo AI — Authentication
// ============================================================
//
// A centred panel over a living communication network.
//
// The scene is infrastructure made visible: routed paths, nodes that activate,
// signals travelling between them. It reacts to what the person is doing —
// waking when the email field takes focus, answering while they type, and
// narrowing to a closed circuit while a password is entered — but it never
// moves the form, never delays it, and never animates an outcome the server
// has not confirmed.
//
// All choreography lives in lib/auth-scene/timelines. This file owns markup,
// form state and the real network calls, and asks the scene for behaviour by
// name. Keeping the split means the animation can be tuned in one place.
//
// Password reset is by emailed code when the server has email configured:
// request a six-digit code, then enter it with a new password. Without email
// it falls back to the reset that only works from the machine running Tringlo,
// so the ability to recover an account never disappears.
//
// What is deliberately absent: provider buttons, because Tringlo has no OAuth.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2 } from "lucide-react";
import gsap from "gsap";

import { useAuthStore } from "@/lib/store";
import { prefersReducedMotion } from "@/lib/animation";
import { createAuthScene, type AuthScene } from "@/lib/auth-scene/timelines";
import { CommunicationNetwork } from "@/components/auth/communication-network";
import { CreateWorkspaceForm, type CreateWorkspacePayload } from "@/components/auth/create-workspace-form";

type Mode = "signIn" | "signUp" | "reset";

interface SetupStatus {
  needsSetup: boolean;
  canSetupHere: boolean;
  /** True when the server can email a reset code. */
  resetByEmail?: boolean;
}

const MIN_PASSWORD_LENGTH = 10;

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);
  const refresh = useAuthStore((state) => state.refresh);
  const expired = useAuthStore((state) => state.expired);

  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [mode, setMode] = useState<Mode>("signIn");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  // Email reset is two steps: ask for a code, then use it.
  const [resetStep, setResetStep] = useState<"request" | "verify">("request");
  const [code, setCode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [density, setDensity] = useState<"full" | "reduced">("full");
  /** Arrived from the website's "Sign up" where sign-up is not open. */
  const [signupRequested, setSignupRequested] = useState(false);

  /** Reset by emailed code, rather than the machine-only fallback. */
  const emailReset = setup?.resetByEmail === true;
  /** The first email-reset step asks only for the address. */
  const askingForCode = mode === "reset" && emailReset && resetStep === "request";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<AuthScene | null>(null);

  // ---------------------------------------------------------------- setup
  const loadSetupStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/setup-status", { cache: "no-store" });
      const status: SetupStatus = response.ok
        ? await response.json()
        : { needsSetup: false, canSetupHere: false };

      setSetup(status);

      // First run has no account to sign into, so the form opens on create.
      // Decided where the answer arrives rather than in an effect reacting to
      // it, which would be a render caused by a render.
      if (status.needsSetup && status.canSetupHere) setMode("signUp");

      // "Sign up" on the public website lands here with ?mode=signup. Open the
      // form where creating a workspace is allowed; elsewhere say how to get one.
      if (new URLSearchParams(window.location.search).get("mode") === "signup") {
        if (status.canSetupHere) setMode("signUp");
        else setSignupRequested(true);
      }
    } catch {
      setSetup({ needsSetup: false, canSetupHere: false });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadSetupStatus, 0);
    return () => clearTimeout(timer);
  }, [loadSetupStatus]);

  // ---------------------------------------------------------------- scene
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    // Density is chosen once per breakpoint crossing rather than per resize
    // frame: rebuilding the scene while someone drags a window edge is worse
    // than briefly showing the wrong density.
    const query = window.matchMedia("(max-width: 860px)");
    const applyDensity = () => setDensity(query.matches ? "reduced" : "full");
    applyDensity();
    query.addEventListener("change", applyDensity);

    const scene = createAuthScene({ root: stage, reduced: prefersReducedMotion() });
    sceneRef.current = scene;
    scene.enter();

    // Pointer parallax, normalised to -1..1. Passive, and the scene throttles
    // it internally with quickTo.
    const onPointerMove = (event: PointerEvent) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = (event.clientY / window.innerHeight) * 2 - 1;
      scene.parallax(x, y);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    // A hidden tab should not be animating. gsap.ticker.sleep stops the whole
    // engine, which is cheaper and more complete than pausing each timeline.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") gsap.ticker.sleep();
      else gsap.ticker.wake();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      query.removeEventListener("change", applyDensity);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      scene.destroy();
      sceneRef.current = null;
    };
    // The scene is built once. Density changes re-render the SVG beneath it,
    // and the scene re-queries the DOM on every call, so it stays correct.
  }, []);

  // Channel change: the panel cross-fades and the network reroutes.
  useEffect(() => {
    sceneRef.current?.switchChannel(contentRef.current);
  }, [mode, setup]);

  // ---------------------------------------------------------------- helpers
  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    setPassword("");
    setConfirmPassword("");
    setResetStep("request");
    setCode("");
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!email.trim()) errors.email = "Enter your email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = "That does not look like an email address.";

    if (mode === "reset" && emailReset && resetStep === "verify" && !/^\d{6}$/.test(code.replace(/\s/g, ""))) {
      errors.code = "Enter the six-digit code from the email.";
    }

    if (askingForCode) {
      // nothing else to check yet
    } else if (!password) errors.password = "Enter your password.";
    else if (mode !== "signIn" && password.length < MIN_PASSWORD_LENGTH)
      errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

    if (mode !== "signIn" && !askingForCode && confirmPassword !== password) {
      errors.confirmPassword = "The passwords do not match.";
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) sceneRef.current?.failure(panelRef.current);
    return Object.keys(errors).length === 0;
  };

  /**
   * Only ever called once the server has issued a session.
   *
   * Where it goes depends on how many workspaces the account holds: one is not
   * a choice and opens straight away, several mean the selector. The server
   * decides which — this only follows where it points.
   */
  const enterApp = (destination = "/dashboard") => {
    const scene = sceneRef.current;
    if (!scene) {
      router.replace(destination);
      return;
    }
    scene.success(() => router.replace(destination));
  };

  const reject = (message: string) => {
    setError(message);
    sceneRef.current?.failure(panelRef.current);
  };

  /** Asks the server to email a code. Returns whether it was accepted. */
  const requestCode = async (): Promise<boolean> => {
    const response = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      reject(body?.error?.message ?? "Could not send a code.");
      return false;
    }
    // The server's wording is deliberately the same whether or not the
    // account exists, so it is shown as given.
    setNotice(body?.message ?? "Check your email for a code.");
    return true;
  };

  const resendCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestCode();
    } catch {
      reject("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const [problems, setProblems] = useState<string[]>([]);

  /**
   * Creates the workspace from everything the form collected.
   *
   * The server validates the lot before writing a single row, and undoes the
   * workspace if any part of the setup fails — so a refusal here means nothing
   * was created and the form can simply be corrected.
   */
  const createWorkspace = async (payload: CreateWorkspacePayload) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setProblems([]);

    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setProblems(Array.isArray(body?.error?.problems) ? body.error.problems : []);
        reject(body?.error?.message ?? "The workspace was not created.");
        return;
      }

      const result = await signIn(payload.email, payload.password, true);
      if (result.ok) {
        await refresh();
        enterApp();
      } else {
        setNotice("Workspace created. Sign in to continue.");
        setMode("signIn");
        setBusy(false);
      }
    } catch {
      reject("Could not reach the server.");
    }
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
          reject(result.error ?? "Could not sign in.");
          return;
        }
        setPassword("");
        // Always the selector, even with one workspace: which company you are
        // working in should never be something the app decided for you.
        enterApp("/workspaces");
        return;
      }

      if (emailReset && resetStep === "request") {
        const sent = await requestCode();
        if (sent) setResetStep("verify");
        return;
      }

      const response = emailReset
        ? await fetch("/api/auth/password-reset/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code, password }),
          })
        : // No email on this server: the machine-only reset.
          await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        reject(body?.error?.message ?? "Could not reset the password.");
        // An exhausted or expired code cannot be retried; go back for a new one.
        if (body?.error?.code === "code_exhausted") {
          setResetStep("request");
          setCode("");
        }
        return;
      }

      setNotice("Password updated. Sign in with the new one.");
      setMode("signIn");
      setPassword("");
      setConfirmPassword("");
      setResetStep("request");
      setCode("");
    } catch {
      reject("Could not reach the server. Check your connection and try again.");
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
        : "Welcome back";

  const subheading =
    mode === "signUp"
      ? firstRun
        ? "The first account for this installation."
        : "A separate workspace, with its own leads, calls and history."
      : mode === "reset"
        ? "Set a new password for an existing account."
        : "Sign in to your workspace.";

  const submitLabel =
    mode === "signUp"
      ? "Create workspace"
      : mode === "reset"
        ? askingForCode
          ? "Send code"
          : "Update password"
        : "Sign in";

  return (
    <div
      ref={stageRef}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-5 py-10"
    >
      <CommunicationNetwork density={density} />

      {/* The panel. Sits above the scene, and nothing in the scene is allowed
          to move it — the network reacts, the form stays put. */}
      <div ref={panelRef} className={`relative z-10 w-full ${mode === "signUp" ? "max-w-[620px]" : "max-w-[400px]"}`}>
        <div className="rounded-xl border border-border bg-card px-7 py-8 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:px-8">
          {setup === null ? (
            <div className="flex h-56 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="sr-only">Loading</span>
            </div>
          ) : (
            <div ref={contentRef}>
              <div data-field className="flex items-center gap-2.5">
                <span className="h-5 w-[3px] rounded-full bg-primary" />
                <span className="text-sm font-semibold tracking-tight text-foreground">Tringlo</span>
              </div>

              <header data-field className="mt-6">
                <h1 className="text-[1.375rem] font-semibold tracking-[-0.02em] text-foreground">
                  {heading}
                </h1>
                <p className="mt-1.5 text-sm text-muted-foreground">{subheading}</p>
              </header>

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
                  browser on the machine running Tringlo.
                </Message>
              )}

              {mode === "signUp" ? (
                <div className="mt-6">
                  <CreateWorkspaceForm
                    busy={busy}
                    error={error}
                    problems={problems}
                    onSubmit={createWorkspace}
                    onBackToSignIn={() => {
                      setMode("signIn");
                      setError(null);
                      setProblems([]);
                    }}
                  />
                </div>
              ) : (
              <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>

                <Field
                  id="email"
                  label="Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  onType={() => sceneRef.current?.pulse()}
                  onFocus={() => sceneRef.current?.focusEmail()}
                  onBlur={() => sceneRef.current?.releaseFocus()}
                  placeholder="you@company.com"
                  error={fieldErrors.email}
                  disabled={busy || (mode === "reset" && emailReset && resetStep === "verify")}
                  autoComplete="username"
                />

                {mode === "reset" && emailReset && resetStep === "verify" && (
                  <Field
                    id="code"
                    label="Code from the email"
                    value={code}
                    onChange={setCode}
                    placeholder="123 456"
                    error={fieldErrors.code}
                    disabled={busy}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                )}

                {!askingForCode && (
                <Field
                  id="password"
                  label={mode === "reset" ? "New password" : "Password"}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  // No pulse while typing a password: the scene must not react
                  // in any way that tracks what is being entered.
                  onFocus={() => sceneRef.current?.focusSecure()}
                  onBlur={() => sceneRef.current?.releaseFocus()}
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
                )}

                {mode !== "signIn" && !askingForCode && (
                  <Field
                    id="confirmPassword"
                    label="Confirm password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    onFocus={() => sceneRef.current?.focusSecure()}
                    onBlur={() => sceneRef.current?.releaseFocus()}
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

                    {(canCreate || emailReset) && (
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
              )}

              <div data-field className="mt-6 border-t border-border pt-5 text-[13px]">
                {mode === "signIn" ? (
                  canCreate ? (
                    <p className="text-muted-foreground">
                      Need a separate workspace?{" "}
                      <SwitchLink onClick={() => switchMode("signUp")}>Create one</SwitchLink>
                    </p>
                  ) : (
                    <p className={signupRequested ? "leading-relaxed text-foreground" : "leading-relaxed text-muted-foreground"}>
                      {signupRequested ? "Workspaces are set up on request. " : "New workspaces are created from the machine running Tringlo. "}
                      <a href="/contact?topic=workspace" className="font-medium text-primary underline-offset-4 hover:underline">
                        Request a workspace
                      </a>
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

                {mode === "reset" && emailReset && (
                  <p className="mt-3 leading-relaxed text-muted-foreground">
                    {resetStep === "request"
                      ? "We'll email a six-digit code to the address on your account. It expires in 10 minutes."
                      : "Changing your password signs out every other session on this account."}
                    {resetStep === "verify" && (
                      <>
                        {" "}
                        <SwitchLink onClick={resendCode}>Send a new code</SwitchLink>
                      </>
                    )}
                  </p>
                )}

                {mode === "reset" && !emailReset && (
                  <p className="mt-3 leading-relaxed text-muted-foreground">
                    Email is not set up on this server, so a password can only be changed from the
                    machine running Tringlo. Doing so signs out every existing session for that
                    account.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
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
  onType,
  onFocus,
  onBlur,
  placeholder,
  type = "text",
  error,
  disabled,
  autoComplete,
  inputMode,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onType?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  error?: string;
  disabled?: boolean;
  autoComplete?: string;
  /** "numeric" brings up the number pad on phones, for the reset code. */
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  trailing?: React.ReactNode;
}) {
  return (
    <div data-field>
      <label htmlFor={id} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>

      <div className="relative mt-1.5">
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            onType?.();
          }}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`block h-11 w-full rounded-md border bg-card px-3 text-sm text-foreground transition-colors placeholder:text-muted-foreground/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60 ${
            error ? "border-destructive" : "border-input focus:border-ring"
          } ${trailing ? "pr-11" : ""}`}
        />

        {trailing && (
          <span className="absolute inset-y-0 right-2 flex items-center">{trailing}</span>
        )}
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

  // One property, one easing. Enough to feel responsive without performing.
  const lift = (to: number) => {
    if (prefersReducedMotion() || !ref.current || busy) return;
    gsap.to(ref.current, { y: to, duration: 0.24, ease: "power2.out" });
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
