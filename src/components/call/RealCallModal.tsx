"use client";

// ============================================================
// Dialo AI — Live Call
// ============================================================
// Shows exactly what the provider has told us, and nothing else.
//
// Sarvam's instant-outbound webhook reports the *outcome* of an attempt; it does
// not stream ring or answer events. So this panel moves through two honest
// states — "Placing call" while the trigger is in flight, then "Waiting for
// provider" — and only ever shows Connected / Not picked / Busy / Failed once
// the provider says so.
//
// There is deliberately no clock while waiting. A running mm:ss reads as call
// duration no matter how it is labelled, and it made a declined call look like a
// call in progress for minutes. A duration is shown only for a call the provider
// confirms connected, and it is the provider's duration, not elapsed time here.
//
// The status comes from the database, which the webhook writes and which is also
// reconciled against Sarvam's attempt record — so a declined call settles within
// seconds instead of waiting for a webhook that arrives when Sarvam closes the
// attempt.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  PhoneOff,
  ShieldOff,
  X,
} from "lucide-react";

import type { AgentConfig, CallRecord, Lead } from "@/lib/types";
import { isTerminalCallStatus } from "@/lib/types";
import {
  EMPTY,
  RESULT_TIMEOUT_MS,
  callStatusPresentation,
  formatDuration,
  formatOutcome,
  formatText,
} from "@/lib/format";
import { useCallWatch, type ReachabilityHistory } from "@/lib/use-dialo-data";
import { useModalEntrance, useStateTransition } from "@/lib/animation";
import { Field, StatusBadge, Tag } from "@/components/ui/data-display";
import { TranscriptView } from "@/components/call/TranscriptView";

interface RealCallModalProps {
  lead: Lead;
  agentConfig: AgentConfig;
  onClose: () => void;
  /** Called once a terminal result lands, so the parent can refresh its list. */
  onSettled?: (record: CallRecord) => void;
  /**
   * Attach to a call that is already running instead of placing a new one.
   *
   * This is what makes a browser refresh mid-call recoverable: the attempt keeps
   * running at the provider either way, and reopening the panel must never dial
   * the customer a second time.
   */
  watchCallId?: string;
}

type TriggerState =
  | { phase: "placing" }
  | { phase: "placed"; callId: string; attemptId: string }
  | { phase: "rejected"; message: string; type: string; webhookUrl?: string };

export function RealCallModal({
  lead,
  agentConfig,
  onClose,
  onSettled,
  watchCallId,
}: RealCallModalProps) {
  const router = useRouter();
  const { backdropRef, panelRef } = useModalEntrance();

  const [trigger, setTrigger] = useState<TriggerState>(
    watchCallId
      ? { phase: "placed", callId: watchCallId, attemptId: "" }
      : { phase: "placing" }
  );
  const [waitSeconds, setWaitSeconds] = useState(0);
  const hasTriggered = useRef(false);
  const hasSettled = useRef(false);

  const callId = trigger.phase === "placed" ? trigger.callId : null;
  const { record, reachability, error: watchError } = useCallWatch(callId, trigger.phase === "placed");

  const attemptId =
    (trigger.phase === "placed" && trigger.attemptId) || record?.providerAttemptId || null;
  const status = record?.status ?? (trigger.phase === "placed" ? "calling" : "initiating");
  const settled = isTerminalCallStatus(record?.status);
  const bodyRef = useStateTransition<HTMLDivElement>(trigger.phase === "rejected" ? "rejected" : status);

  // --- Place the call exactly once, even under React's double-invoked effects ---
  useEffect(() => {
    // Attaching to an existing call must not trigger a second one.
    if (watchCallId) return;
    if (hasTriggered.current) return;
    hasTriggered.current = true;

    (async () => {
      try {
        const response = await fetch("/api/calls/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: lead.id,
            leadName: lead.name,
            leadPhone: lead.phone,
            leadCompany: lead.company,
            leadNotes: lead.notes,
            campaignId: lead.campaign,
            agentConfig,
          }),
        });

        const body = await response.json();

        if (!response.ok) {
          setTrigger({
            phase: "rejected",
            message: body.error || "Sarvam did not accept the call.",
            type: body.type || "provider_error",
            webhookUrl: body.webhookUrl,
          });
          return;
        }

        setTrigger({ phase: "placed", callId: body.callId, attemptId: body.attemptId });
      } catch {
        setTrigger({
          phase: "rejected",
          message: "Could not reach the Dialo server to place the call.",
          type: "network_error",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Waiting-time counter. Display only: it never changes the call state ---
  // When attaching to a call already in progress it counts from when the request
  // was sent, so a refresh does not appear to restart the wait.
  const requestedAt = record?.requestedAt ?? null;
  useEffect(() => {
    if (trigger.phase !== "placed" || settled) return;

    const tick = () => {
      if (requestedAt) {
        const elapsed = Math.floor((Date.now() - new Date(requestedAt).getTime()) / 1000);
        setWaitSeconds(elapsed > 0 ? elapsed : 0);
      } else {
        setWaitSeconds((seconds) => seconds + 1);
      }
    };

    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [trigger.phase, settled, requestedAt]);

  useEffect(() => {
    if (!settled || !record || hasSettled.current) return;
    hasSettled.current = true;
    onSettled?.(record);
  }, [settled, record, onSettled]);

  const presentation = callStatusPresentation(status);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4 phone:items-end phone:p-0"
      role="dialog"
      aria-modal="true"
      aria-label={`Call to ${lead.name}`}
    >
      <div
        ref={panelRef}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-card shadow-xl phone:max-h-[92dvh] phone:max-w-none phone:rounded-b-none phone:rounded-t-2xl phone:border-x-0 phone:border-b-0 phone:pb-safe"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="font-heading text-base font-semibold tracking-tight">{lead.name}</h2>
              {/* A refused request never reached the phone network, so it gets its
                  own label rather than borrowing an in-progress call status. */}
              {trigger.phase === "rejected" ? (
                <Tag tone={trigger.type === "duplicate_call_prevented" ? "neutral" : "negative"}>
                  {trigger.type === "duplicate_call_prevented" ? "Already calling" : "Not placed"}
                </Tag>
              ) : (
                <StatusBadge status={status} showPulse={!settled && trigger.phase === "placed"} />
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              <span className="font-mono">{lead.phone}</span>
              {lead.company ? ` · ${lead.company}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-6">
          {trigger.phase === "rejected" ? (
            <RejectedBody
              message={trigger.message}
              type={trigger.type}
              webhookUrl={trigger.webhookUrl}
            />
          ) : !settled ? (
            <WaitingBody
              phase={trigger.phase}
              waitSeconds={waitSeconds}
              attemptId={attemptId}
              watchError={watchError}
              description={presentation.description}
              timedOut={waitSeconds * 1000 > RESULT_TIMEOUT_MS}
            />
          ) : record?.status === "connected" ? (
            <ConnectedBody record={record} />
          ) : (
            <NotReachedBody record={record as CallRecord} reachability={reachability} />
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {attemptId ? (
              <>
                Attempt <span className="font-mono text-[11px]">{attemptId.slice(0, 8)}</span> ·
                Sarvam / Vobiz
              </>
            ) : (
              "Sarvam / Vobiz"
            )}
          </p>
          <div className="flex items-center gap-2">
            {settled && (
              <button
                onClick={() => {
                  onClose();
                  router.push("/results");
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                View in results
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="h-9 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------

function WaitingBody({
  phase,
  waitSeconds,
  attemptId,
  watchError,
  description,
  timedOut,
}: {
  phase: "placing" | "placed";
  waitSeconds: number;
  attemptId: string | null;
  watchError: string | null;
  description: string;
  /** True once the wait has run far past how long a completion webhook should take. */
  timedOut: boolean;
}) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/60">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>

      <h3 className="mt-5 font-heading text-lg font-semibold tracking-tight">
        {phase === "placing"
          ? "Placing call"
          : timedOut
            ? "No result received"
            : "Waiting for provider"}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {timedOut
          ? "Sarvam has not delivered a result. This usually means the webhook URL is not reachable from the internet. What happened on the call is unknown."
          : description}
      </p>

      {phase === "placed" && (
        <>
          {/* No clock here on purpose.
              A running mm:ss reads as call duration however it is labelled, and
              nobody has answered yet — this used to look like a call in progress
              while the customer had already declined. Elapsed time appears only
              as prose, and only once the wait is long enough to be worth saying. */}
          {waitSeconds >= 20 && !timedOut && (
            <p className="mt-6 max-w-sm text-sm text-muted-foreground">
              Still no result after {waitSeconds} seconds.
            </p>
          )}

          <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted-foreground">
            Sarvam does not publish ring or answer events, so Dialo will not claim the phone is
            ringing. It checks with Sarvam every few seconds and shows the outcome as soon as the
            call ends — including if it is declined.
          </p>

          {attemptId && (
            <p className="mt-3 font-mono text-[11px] text-muted-foreground/70">{attemptId}</p>
          )}
        </>
      )}

      {watchError && (
        <p className="mt-5 max-w-sm text-xs text-amber-700 dark:text-amber-400">
          {watchError} The call is still running — reopen this lead from Results to see the outcome.
        </p>
      )}
    </div>
  );
}

function ConnectedBody({ record }: { record: CallRecord }) {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm text-emerald-900 dark:text-emerald-200">
          The customer answered and spoke with the agent.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <Field label="Duration" value={formatDuration(record.duration)} mono />
        <Field label="Outcome" value={formatOutcome(record.aiResult?.status)} />
        <Field
          label="Interest"
          value={record.interestLevel ? record.interestLevel : EMPTY}
          className="capitalize"
        />
        <Field
          label="Confidence"
          value={record.interestConfidence === null || record.interestConfidence === undefined
            ? EMPTY
            : `${record.interestConfidence}%`}
          mono
        />
      </dl>

      {(record.doNotCall || record.humanHandoffRequired) && (
        <div className="space-y-2">
          {record.doNotCall && (
            <FlagNotice
              icon={ShieldOff}
              tone="negative"
              text="The customer asked not to be called again. This lead is now suppressed and its pending callbacks are cancelled."
            />
          )}
          {record.humanHandoffRequired && (
            <FlagNotice
              icon={ArrowRight}
              tone="warning"
              text="The customer asked to speak with a person. This call is flagged for handoff."
            />
          )}
        </div>
      )}

      <section>
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Summary
        </h4>
        <p className="mt-2 rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
          {record.aiSummary ? (
            record.aiSummary
          ) : (
            <span className="text-muted-foreground">
              The agent did not return a summary for this call.
            </span>
          )}
        </p>
      </section>

      {(record.painPoints || record.objection || record.nextAction) && (
        <dl className="grid gap-5 rounded-lg border bg-muted/20 px-4 py-4 sm:grid-cols-2">
          <Field label="Pain points" value={formatText(record.painPoints)} className="sm:col-span-2" />
          <Field label="Objection" value={formatText(record.objection)} />
          <Field label="Next action" value={formatText(record.nextAction)} />
        </dl>
      )}

      <TranscriptView turns={record.transcriptTurns} status={record.status} />
    </div>
  );
}

function NotReachedBody({
  record,
  reachability,
}: {
  record: CallRecord;
  reachability: ReachabilityHistory | null;
}) {
  const presentation = callStatusPresentation(record.status);

  // One carrier failure says little; a number that has never once connected
  // says a great deal, and is worth checking before dialling it again.
  const looksUnreachable =
    reachability !== null &&
    !reachability.everConnected &&
    reachability.consecutiveFailures >= 2;

  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border bg-muted/60">
        <PhoneOff className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-5 font-heading text-lg font-semibold tracking-tight">
        {presentation.label}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {presentation.description}
      </p>

      {record.failureReason && (
        <p className="mt-4 max-w-sm rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          {record.failureReason}
        </p>
      )}

      {looksUnreachable && (
        <p className="mt-5 max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          This number has failed {reachability!.consecutiveFailures} times in a row and has never
          connected. Worth checking the number is correct and can receive calls before trying again.
        </p>
      )}

      {/* No conversation happened, so there is nothing to report. Said plainly
          rather than shown as empty metric tiles that imply a measurement. */}
      <p className="mt-6 max-w-sm text-xs leading-relaxed text-muted-foreground">
        No conversation took place, so there is no transcript, duration or interest level for this
        attempt.
      </p>
    </div>
  );
}

function RejectedBody({
  message,
  type,
  webhookUrl,
}: {
  message: string;
  type: string;
  webhookUrl?: string;
}) {
  const isDnd = type === "call_blocked_dnd";
  const isDuplicate = type === "duplicate_call_prevented";
  const isWebhook = type === "webhook_unreachable";

  const title = isDnd
    ? "Blocked — do not call"
    : isDuplicate
      ? "Already calling this lead"
      : "Call could not be placed";

  const Icon = isDnd ? ShieldOff : isDuplicate ? Loader2 : AlertTriangle;
  const neutral = isDuplicate;

  return (
    <div className="flex flex-col items-center py-8 text-center">
      <div
        className={
          neutral
            ? "flex h-12 w-12 items-center justify-center rounded-full border bg-muted/60"
            : "flex h-12 w-12 items-center justify-center rounded-full border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30"
        }
      >
        <Icon
          className={
            neutral ? "h-5 w-5 text-muted-foreground" : "h-5 w-5 text-red-600 dark:text-red-400"
          }
        />
      </div>

      <h3 className="mt-5 font-heading text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">{message}</p>

      {/* The unreachable-webhook case is a setup problem, so it gets the URL that
          failed and the specific thing to do about it, rather than one long line. */}
      {isWebhook && (
        <div className="mt-6 w-full max-w-md space-y-3 text-left">
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Result would be delivered to
            </p>
            <p className="mt-1 break-all font-mono text-xs text-foreground">{webhookUrl}</p>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Sarvam sends each result to that URL once. Nothing is listening, so the call would
            connect and its transcript, outcome and follow-up would be lost. Start your tunnel or
            update <span className="font-mono text-xs">APP_URL</span>, restart the server, then try
            again.
          </p>
        </div>
      )}
    </div>
  );
}

function FlagNotice({
  icon: Icon,
  tone,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: "negative" | "warning";
  text: string;
}) {
  const classes =
    tone === "negative"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300";

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${classes}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}
