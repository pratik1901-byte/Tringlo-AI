"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import { gsap } from "@/components/site/motion";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

const TOPICS = ["General question", "Request a workspace", "Privacy or data request", "Something else"];

type Errors = Partial<Record<"name" | "email" | "message" | "consent" | "form", string>>;

const input =
  "h-11 w-full rounded-[4px] border border-stone bg-paper px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink/40 focus:border-ink focus:shadow-[0_0_0_0.5px_var(--color-ink)] aria-[invalid=true]:border-[#ba1a1a]";

function FieldError({ id, field, errors }: { id: string; field: keyof Errors; errors: Errors }) {
  if (!errors[field]) return null;
  return (
    <p id={`${id}-${field}-error`} className="mt-1.5 text-[13px] text-[#ba1a1a]">
      {errors[field]}
    </p>
  );
}

export function ContactForm({ initialTopic }: { initialTopic?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [topic, setTopic] = useState(initialTopic ?? TOPICS[0]);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const doneRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  const validate = (): Errors => {
    const next: Errors = {};
    if (!name.trim()) next.name = "Please tell us your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "Please enter a valid email address.";
    if (message.trim().length < 10) next.message = "Please write a little more — at least 10 characters.";
    if (!consent) next.consent = "Please confirm we may use your details to reply.";
    return next;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // Move focus to the first problem so keyboard and screen-reader users land on it.
      const first = (["name", "email", "message", "consent"] as const).find((key) => found[key]);
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, topic, message, consent, website }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const field = body?.error?.field as keyof Errors | undefined;
        setErrors({ [field ?? "form"]: body?.error?.message ?? "Your message could not be sent. Please try again." });
        if (field) document.getElementById(`${id}-${field}`)?.focus();
        return;
      }
      setSent(true);
      requestAnimationFrame(() => {
        doneRef.current?.focus();
        if (doneRef.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          gsap.from(doneRef.current, { y: 16, opacity: 0, duration: 0.6, ease: "power3.out" });
        }
      });
    } catch {
      setErrors({ form: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="rounded-lg border border-ink bg-paper p-8">
        <p className="mono-label text-ink-faint">Message sent</p>
        <p className="serif mt-3 text-[32px] leading-10">Thank you — we’ll reply to {email.trim()}.</p>
        <p className="mt-3 text-[15px] leading-6 text-ink-muted">Your message went straight to our inbox; it isn’t stored on this website.</p>
      </div>
    );
  }

  const describe = (key: keyof Errors) => (errors[key] ? `${id}-${key}-error` : undefined);

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="rounded-lg border border-stone bg-paper p-6 md:p-8" aria-describedby={`${id}-note`}>
      <p id={`${id}-note`} className="text-[13px] text-ink-faint">
        All fields are required unless marked optional.
      </p>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className="text-[14px] font-medium text-ink">Name</label>
          <input id={`${id}-name`} className={cn(input, "mt-1.5")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} aria-invalid={Boolean(errors.name)} aria-describedby={describe("name")} />
          <FieldError id={id} field="name" errors={errors} />
        </div>
        <div>
          <label htmlFor={`${id}-email`} className="text-[14px] font-medium text-ink">Email</label>
          <input id={`${id}-email`} type="email" inputMode="email" className={cn(input, "mt-1.5")} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} aria-invalid={Boolean(errors.email)} aria-describedby={describe("email")} />
          <FieldError id={id} field="email" errors={errors} />
        </div>
        <div>
          <label htmlFor={`${id}-company`} className="text-[14px] font-medium text-ink">
            Company <span className="font-normal text-ink-faint">(optional)</span>
          </label>
          <input id={`${id}-company`} className={cn(input, "mt-1.5")} value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="organization" maxLength={160} />
        </div>
        <div>
          <label htmlFor={`${id}-topic`} className="text-[14px] font-medium text-ink">Topic</label>
          <select id={`${id}-topic`} className={cn(input, "mt-1.5 appearance-none bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-9")} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%23171614' stroke-width='1.5'/%3E%3C/svg%3E\")" }} value={topic} onChange={(e) => setTopic(e.target.value)}>
            {TOPICS.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor={`${id}-message`} className="text-[14px] font-medium text-ink">Message</label>
        <textarea id={`${id}-message`} rows={6} className={cn(input, "mt-1.5 h-auto py-3 leading-6")} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} aria-invalid={Boolean(errors.message)} aria-describedby={describe("message")} />
        <FieldError id={id} field="message" errors={errors} />
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <div className="mt-6">
        <label htmlFor={`${id}-consent`} className="flex cursor-pointer items-start gap-3 text-[14px] leading-[22px] text-ink-muted">
          <input
            id={`${id}-consent`}
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-invalid={Boolean(errors.consent)}
            aria-describedby={describe("consent")}
            className="mt-[3px] h-[18px] w-[18px] shrink-0 cursor-pointer accent-[var(--color-ink)]"
          />
          <span>
            I agree that {SITE.name} may use the details above to reply to this message. They are emailed to our inbox and not
            used for marketing. See the{" "}
            <Link href="/privacy" className="text-iris-deep underline underline-offset-4">Privacy Policy</Link>.
          </span>
        </label>
        <FieldError id={id} field="consent" errors={errors} />
      </div>

      {errors.form && (
        <p role="alert" className="mt-5 rounded-[4px] border border-[#ba1a1a]/40 bg-[#ffdad6]/40 px-4 py-3 text-[14px] text-[#93000a]">
          {errors.form}
        </p>
      )}

      <button type="submit" disabled={busy} className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-[4px] bg-ink px-5 text-[15px] font-medium text-cream transition-colors hover:bg-ink-soft disabled:opacity-60 sm:w-auto">
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
