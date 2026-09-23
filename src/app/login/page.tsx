"use client";

// ============================================================
// Dialo AI — Sign In
// ============================================================
//
// Two modes, decided by the server rather than by the form:
//
//   - Normal sign-in, against /api/auth/login.
//   - First-run setup, when no account exists yet. There are no demo
//     credentials anywhere in Dialo, so this is how the first account comes to
//     exist. The server only allows it from the machine it runs on.
//
// The password is never stored, never logged, and never kept in this component
// after submission. The session is an httpOnly cookie the server sets, which
// this code deliberately cannot read.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Mail, Building2, User as UserIcon } from "lucide-react";

import { useAuthStore } from "@/lib/store";

interface SetupStatus {
  needsSetup: boolean;
  canSetupHere: boolean;
}

export default function LoginPage() {
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);
  const refresh = useAuthStore((state) => state.refresh);
  const expired = useAuthStore((state) => state.expired);

  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSetupStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/setup-status", { cache: "no-store" });
      setSetup(response.ok ? await response.json() : { needsSetup: false, canSetupHere: false });
    } catch {
      // If this cannot be reached, show the ordinary sign-in form: it is the
      // right thing for an existing installation, which is the common case.
      setSetup({ needsSetup: false, canSetupHere: false });
    }
  }, []);

  // Scheduled rather than called inline, matching lib/use-dialo-data: the
  // effect subscribes to the server, and resolving it synchronously inside the
  // effect body would cascade an extra render before the first paint.
  useEffect(() => {
    const timer = setTimeout(loadSetupStatus, 0);
    return () => clearTimeout(timer);
  }, [loadSetupStatus]);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    setBusy(false);

    if (result.ok) {
      setPassword("");
      router.replace("/dashboard");
    } else {
      setError(result.error ?? "Could not sign in.");
    }
  };

  const handleCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, businessName }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error?.message ?? "Could not create the account.");
        setBusy(false);
        return;
      }

      // Created, now sign in with it so the person is not asked twice.
      const result = await signIn(email, password);
      setPassword("");
      setBusy(false);

      if (result.ok) {
        await refresh();
        router.replace("/dashboard");
      } else {
        setError("Account created. Sign in to continue.");
        await loadSetupStatus();
      }
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  };

  const isSetup = setup?.needsSetup === true && setup.canSetupHere;
  const blockedSetup = setup?.needsSetup === true && !setup.canSetupHere;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dialo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSetup ? "Create the first account for this workspace." : "Sign in to continue."}
        </p>

        {expired && !error && (
          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            Your session ended. Sign in again to continue.
          </p>
        )}

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-foreground"
          >
            {error}
          </p>
        )}

        {blockedSetup && (
          <p className="mt-5 rounded-md border border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
            No account exists yet. For safety the first account can only be created from a browser
            on the machine running Dialo, or with the internal secret.
          </p>
        )}

        {setup === null ? (
          <div className="mt-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form className="mt-7 space-y-4" onSubmit={isSetup ? handleCreateAccount : handleSignIn}>
            {isSetup && (
              <>
                <Field
                  id="businessName"
                  label="Business name"
                  icon={<Building2 className="h-4 w-4 text-muted-foreground" />}
                  value={businessName}
                  onChange={setBusinessName}
                  placeholder="Your company"
                  required
                  disabled={busy}
                />
                <Field
                  id="name"
                  label="Your name"
                  icon={<UserIcon className="h-4 w-4 text-muted-foreground" />}
                  value={name}
                  onChange={setName}
                  placeholder="Optional"
                  disabled={busy}
                />
              </>
            )}

            <Field
              id="email"
              label="Email"
              type="email"
              autoComplete="username"
              icon={<Mail className="h-4 w-4 text-muted-foreground" />}
              value={email}
              onChange={setEmail}
              placeholder="you@company.com"
              required
              disabled={busy || blockedSetup}
            />

            <Field
              id="password"
              label="Password"
              type="password"
              autoComplete={isSetup ? "new-password" : "current-password"}
              icon={<Lock className="h-4 w-4 text-muted-foreground" />}
              value={password}
              onChange={setPassword}
              placeholder={isSetup ? "At least 10 characters" : "••••••••"}
              required
              disabled={busy || blockedSetup}
              hint={isSetup ? "At least 10 characters. Stored only as a scrypt hash." : undefined}
            />

            <button
              type="submit"
              disabled={busy || blockedSetup}
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isSetup ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  disabled = false,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {icon}
        </span>
        <input
          id={id}
          name={id}
          type={type}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="block h-10 w-full rounded-md border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
        />
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
