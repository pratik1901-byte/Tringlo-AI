"use client";

// ============================================================
// One call's result, opened from a campaign
// ============================================================
//
// Outcome, the agent's structured read of the conversation, the transcript
// and the recording — everything Tringlo holds for one attempt. Read from
// /api/calls/:id, the same record the Results page uses.
// ============================================================

import { useEffect, useRef } from "react";
import { Download, Loader2, X } from "lucide-react";

import { ErrorState, Tag } from "@/components/ui/data-display";
import { ModalBody } from "@/components/ui/modal-body";
import { useApi } from "@/lib/use-dialo-data";
import type { CallRecord } from "@/lib/types";

const STATUS: Record<string, { label: string; tone: "neutral" | "pending" | "positive" | "warning" | "negative" }> = {
  connected: { label: "Connected", tone: "positive" },
  no_answer: { label: "No answer", tone: "warning" },
  busy: { label: "Busy", tone: "warning" },
  failed: { label: "Failed", tone: "negative" },
  provider_error: { label: "Provider error", tone: "negative" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  calling: { label: "Awaiting result", tone: "pending" },
};

const OUTCOME: Record<string, string> = {
  interested: "Interested",
  not_interested: "Not interested",
  follow_up: "Wants a follow-up",
  human_handoff: "Needs a person",
  do_not_call: "Do not call",
  uncertain: "Unclear",
};

/** Agents write "NA" or "none" into fields they had nothing for. */
function shown(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || /^(na|n\/a|none|null|not mentioned|-)$/i.test(text)) return null;
  return text;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "Time not reported";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function CallResultPanel({ callId, onClose }: { callId: string; onClose: () => void }) {
  const { data, error, isLoading, refresh } = useApi<{ record: CallRecord }>(`/api/calls/${encodeURIComponent(callId)}`);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      returnFocusRef.current?.focus?.();
    };
  }, [onClose]);

  const record = data?.record;
  const status = record ? STATUS[record.status] ?? { label: record.status, tone: "neutral" as const } : null;
  const outcome = record?.aiResult?.status ? OUTCOME[record.aiResult.status] ?? record.aiResult.status : null;
  const recordingSrc = `/api/calls/${encodeURIComponent(callId)}/recording`;
  const hasRecording = Boolean(record && record.status === "connected" && record.providerInteractionId);

  const facts: Array<[string, string | null]> = record
    ? [
        ["Interest", shown(record.interestLevel)],
        ["Summary", shown(record.aiSummary)],
        ["Objection", shown(record.objection)],
        ["What they need", shown(record.customerRequirement)],
        ["Pain points", shown(record.painPoints)],
        ["Budget", shown(record.budgetIndication)],
        ["Timeline", shown(record.timelineToDecide)],
        ["Agreed next step", shown(record.chosenNextStep) ?? shown(record.nextAction)],
        [
          "Callback asked for",
          record.followUpRequired
            ? [shown(record.followUpDate), shown(record.followUpTime)].filter(Boolean).join(" at ") || "Yes, no time given"
            : null,
        ],
        ["Needs a person", record.humanHandoffRequired ? "Yes" : null],
        ["Asked not to be called", record.doNotCall ? "Yes" : null],
        ["Failure reason", shown(record.failureReason)],
      ]
    : [];

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="call-result-title"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[560px] flex-col bg-card shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 id="call-result-title" className="truncate text-base font-semibold">
              {record?.lead?.name ?? "Call result"}
            </h2>
            {record && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {when(record.startedAt ?? record.endedAt)}
                {record.duration ? ` · ${Math.round(record.duration)}s` : ""}
                {typeof record.retryAttempt === "number" && record.retryAttempt > 0 ? ` · retry ${record.retryAttempt}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ModalBody className="space-y-6 px-5 py-5" hint="Transcript below">
          {isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the call…
            </p>
          )}
          {error && <ErrorState message={error} onRetry={refresh} />}

          {record && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {status && <Tag tone={status.tone}>{status.label}</Tag>}
                {outcome && <Tag tone={record.aiResult?.status === "interested" ? "positive" : "neutral"}>{outcome}</Tag>}
              </div>

              {facts.some(([, value]) => value) ? (
                <dl className="space-y-3 text-sm">
                  {facts
                    .filter(([, value]) => value)
                    .map(([label, value]) => (
                      <div key={label} className="grid grid-cols-[130px_1fr] gap-3">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="whitespace-pre-line">{value}</dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {record.status === "connected" ? "The agent reported no details for this call." : "The call did not connect, so there is no conversation."}
                </p>
              )}

              {hasRecording && (
                <section>
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recording</h3>
                    <a href={`${recordingSrc}?format=mp3&download=1`} download className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80">
                      <Download className="h-3.5 w-3.5" /> Download MP3
                    </a>
                  </div>
                  <audio controls preload="none" src={recordingSrc} className="mt-2 w-full" />
                </section>
              )}

              <section>
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transcript</h3>
                {record.transcriptTurns?.length ? (
                  <ol className="mt-2 space-y-2.5">
                    {record.transcriptTurns.map((turn, index) => (
                      <li key={index} className={turn.role === "agent" ? "pr-8" : "pl-8"}>
                        <p className={`text-[11px] font-medium ${turn.role === "agent" ? "text-primary" : "text-muted-foreground"}`}>
                          {turn.role === "agent" ? record.agentName || "Agent" : record.lead?.name || "Customer"}
                        </p>
                        <p className={`mt-0.5 rounded-lg px-3 py-2 text-sm ${turn.role === "agent" ? "bg-primary/5" : "bg-muted"}`}>{turn.text}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {record.status === "connected" ? "No transcript was reported for this call." : "No conversation took place."}
                  </p>
                )}
              </section>
            </>
          )}
        </ModalBody>
      </div>
    </div>
  );
}
