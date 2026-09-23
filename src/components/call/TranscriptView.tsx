"use client";

// ============================================================
// Dialo AI — Transcript
// ============================================================
// Renders the turns Sarvam delivered in `interaction_transcript`, and nothing
// else. When there are no turns it says why, in terms of the call's actual
// state, rather than showing sample dialogue.
// ============================================================

import { useRef } from "react";

import type { TranscriptTurn } from "@/lib/types";
import { useReveal } from "@/lib/animation";
import { cn } from "@/lib/utils";

function emptyReason(status: string | null | undefined): string {
  switch (status) {
    case "no_answer":
      return "Nobody answered, so no conversation was recorded.";
    case "busy":
      return "The line was busy, so no conversation was recorded.";
    case "failed":
    case "provider_error":
      return "The call did not connect, so no conversation was recorded.";
    case "cancelled":
      return "The attempt was cancelled before it connected.";
    case "initiating":
    case "calling":
      return "The call is still in progress. The transcript appears once it finishes.";
    case "connected":
      return "The call connected, but Sarvam did not return a transcript for it.";
    default:
      return "No transcript available.";
  }
}

export function TranscriptView({
  turns,
  status,
  className,
}: {
  turns: TranscriptTurn[] | null | undefined;
  status: string | null | undefined;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useReveal<HTMLDivElement>({
    selector: "[data-turn]",
    distance: 8,
    deps: [turns?.length ?? 0],
    enabled: Boolean(turns && turns.length > 0),
  });

  const hasTurns = Boolean(turns && turns.length > 0);

  return (
    <section className={className} ref={containerRef}>
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Transcript
        </h4>
        {hasTurns && (
          <span className="text-xs text-muted-foreground">
            {turns!.length} {turns!.length === 1 ? "turn" : "turns"}
          </span>
        )}
      </div>

      {hasTurns ? (
        <div
          ref={listRef}
          className="mt-3 max-h-72 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 px-4 py-4"
        >
          {turns!.map((turn, index) => (
            <div key={index} data-turn className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 w-20 shrink-0 text-xs font-medium",
                  turn.role === "agent"
                    ? "text-primary"
                    : turn.role === "system"
                      ? "text-muted-foreground/70"
                      : "text-foreground"
                )}
              >
                {turn.role === "agent" ? "Agent" : turn.role === "system" ? "System" : "Customer"}
              </span>
              <p className="flex-1 text-sm leading-relaxed text-foreground/90">{turn.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
          {emptyReason(status)}
        </p>
      )}
    </section>
  );
}
