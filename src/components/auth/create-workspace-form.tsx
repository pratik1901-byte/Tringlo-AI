"use client";

// ============================================================
// Tringlo AI — creating a workspace
// ============================================================
//
// Everything a workspace needs to make a call is asked for here, in three
// steps, and nothing is created until the last one is submitted. A workspace
// that exists but cannot call — no company to introduce, no agent to speak
// with — is worse than a form that asked one more question.
//
// The steps are a reading aid, not a save: moving between them writes nothing.
// ============================================================

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

import {
  draftProblems,
  draftToPayload,
  emptyDraft,
  Label,
  VoiceProviderSections,
  field,
  type VoiceProviderDraft,
} from "@/components/providers/voice-provider-editor";

export interface CreateWorkspacePayload {
  name: string;
  email: string;
  password: string;
  businessName: string;
  company: Record<string, string>;
  outbound: {
    appId: string;
    appVersion: string;
    connectionId: string;
    phoneNumber: string;
    agentName: string;
    /** The names the agent declares, as the editor collected them. */
    agentVariables: string[];
  };
  batch: Record<string, unknown>;
  inbound: Record<string, unknown> | null;
}

/** A taller input, for the descriptions on step 2. */
const area = `${field} h-auto py-2`;

export function CreateWorkspaceForm({
  busy,
  error,
  problems,
  onSubmit,
  onBackToSignIn,
  account,
  backLabel,
  submitLabel,
}: {
  busy: boolean;
  error: string | null;
  problems: string[];
  onSubmit: (payload: CreateWorkspacePayload) => void;
  onBackToSignIn: () => void;
  /**
   * The signed-in account, when one is adding a workspace to itself. Given
   * this, step 1 shows who will own the workspace instead of asking for an
   * email and a password that already exist.
   */
  account?: { name: string; email: string } | null;
  backLabel?: string;
  submitLabel?: string;
}) {
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Step 1 — who is signing in
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [businessName, setBusinessName] = useState("");

  // Step 2 — what the agent says it is
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [companyDescription, setCompanyDescription] = useState("");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [salesObjective, setSalesObjective] = useState("");
  const [agentName, setAgentName] = useState("");

  // Step 3 — the shared voice provider editor holds all of it. The wizard
  // starts from an empty draft; Settings starts from what is saved.
  const [provider, setProvider] = useState<VoiceProviderDraft>(emptyDraft);

  const checkStep = (index: number): string | null => {
    if (index === 0) {
      if (!businessName.trim()) return "Name the workspace.";
      // A signed-in creator has already proved who they are.
      if (account) return null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
      if (password.length < 10) return "Use a password of at least 10 characters.";
      if (password !== confirm) return "The passwords do not match.";
      return null;
    }
    if (index === 1) {
      if (!companyName.trim()) return "Enter the company name — the agent introduces itself with it.";
      return null;
    }
    return draftProblems(provider)[0] ?? null;
  };

  /**
   * Step 3 is long enough that an error at the foot of it can name a field
   * sitting well above the fold. Take the person to that field rather than
   * leaving them to hunt for it.
   */
  const showProblem = (problem: string) => {
    setStepError(problem);
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;
      // Every step-3 problem names its section ("Batch outbound: …"), so the
      // section is the thing to show, and its first field the thing to fill in.
      const named = problem.split(":")[0].trim().toLowerCase();
      const section = form.querySelector<HTMLElement>(`[data-section="${named}"]`);
      const target = section ?? form;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      const firstField = target.querySelector<HTMLInputElement>("input:not([type=checkbox]):not([type=hidden])");
      firstField?.focus({ preventScroll: true });
    });
  };

  const go = (next: number) => {
    if (next > step) {
      const problem = checkStep(step);
      if (problem) {
        showProblem(problem);
        return;
      }
    }
    setStepError(null);
    setStep(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    for (let index = 0; index <= 2; index++) {
      const problem = checkStep(index);
      if (problem) {
        setStep(index);
        showProblem(problem);
        return;
      }
    }
    setStepError(null);
    onSubmit({
      name: name.trim(),
      email: email.trim(),
      password,
      businessName: businessName.trim(),
      company: {
        companyName: companyName.trim(),
        industry: industry.trim(),
        companyDescription: companyDescription.trim(),
        productName: productName.trim(),
        productDescription: productDescription.trim(),
        salesObjective: salesObjective.trim(),
        agentName: agentName.trim(),
      },
      outbound: {
        ...draftToPayload(provider).outbound,
        appVersion: String(draftToPayload(provider).outbound.appVersion),
        agentName: agentName.trim(),
      },
      batch: draftToPayload(provider).batch,
      inbound: draftToPayload(provider).inbound,
    });
  };

  const steps = ["Account", "Company", "Voice provider"];

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-5">
      <ol className="flex items-center gap-2 text-xs">
        {steps.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(index)}
              className={`rounded-md px-2 py-1 font-medium transition-colors ${
                index === step ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {index + 1}. {label}
            </button>
            {index < steps.length - 1 && <span className="text-muted-foreground/50">›</span>}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-3">
          <label className="block">
            <Label hint="Your business, as it appears across Tringlo.">Workspace</Label>
            <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Your company" maxLength={80} className={field} autoFocus />
          </label>

          {account ? (
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs font-medium">This workspace will belong to your account</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {account.name ? `${account.name} · ` : ""}
                {account.email}
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                You stay signed in with the same email and password. Nothing new to create.
              </p>
            </div>
          ) : (
            <>
              <label className="block">
                <Label hint="Optional.">Your name</Label>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} />
              </label>
              <label className="block">
                <Label>Email</Label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" className={field} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label>Password</Label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 10 characters" className={field} />
                </label>
                <label className="block">
                  <Label>Confirm password</Label>
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" placeholder="Repeat it" className={field} />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            What the agent says it represents. It answers only from this, and says a colleague will confirm when
            something is not covered.
          </p>
          <label className="block">
            <Label hint="Spoken on every call.">Company name</Label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={field} autoFocus />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <Label>Industry</Label>
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} className={field} />
            </label>
            <label className="block">
              <Label hint="What the agent calls itself.">Agent name</Label>
              <input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Priya" className={field} />
            </label>
          </div>
          <label className="block">
            <Label>What the company does</Label>
            <textarea value={companyDescription} onChange={(e) => setCompanyDescription(e.target.value)} rows={2} className={area} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <Label>Product name</Label>
              <input value={productName} onChange={(e) => setProductName(e.target.value)} className={field} />
            </label>
            <label className="block">
              <Label hint="What a call is for.">Objective</Label>
              <input value={salesObjective} onChange={(e) => setSalesObjective(e.target.value)} placeholder="Introduce the product and find genuine interest" className={field} />
            </label>
          </div>
          <label className="block">
            <Label hint="The agent will not go beyond this.">What the product is</Label>
            <textarea value={productDescription} onChange={(e) => setProductDescription(e.target.value)} rows={3} className={area} />
          </label>
          <p className="text-[11px] text-muted-foreground">
            FAQs, pricing and conversation guidelines can be added on the AI Agent page afterwards.
          </p>
        </div>
      )}

      {step === 2 && (
        <VoiceProviderSections draft={provider} onChange={setProvider} autoFocus />
      )}

      {(stepError || error) && <p className="text-sm text-red-600 dark:text-red-400">{stepError ?? error}</p>}
      {problems.length > 1 && (
        <ul className="list-disc space-y-0.5 pl-4 text-xs text-red-600 dark:text-red-400">
          {problems.slice(1).map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => (step === 0 ? onBackToSignIn() : go(step - 1))}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {step === 0 ? backLabel ?? "Sign in instead" : "Back"}
        </button>

        {step < 2 ? (
          <button
            type="button"
            onClick={() => go(step + 1)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitLabel ?? "Create workspace"}
          </button>
        )}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Nothing is created until you press Create workspace.
      </p>
    </form>
  );
}
