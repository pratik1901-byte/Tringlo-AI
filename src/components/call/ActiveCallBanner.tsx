"use client";

// ============================================================
// Dialo AI — Active Call Banner
// ============================================================
// Makes a call that is still running findable from anywhere, including after a
// browser refresh.
//
// The attempt lives at the provider, not in this tab, so refreshing loses only
// the panel — never the call or its result. This banner reads the in-flight
// state back from the database, so it works after a reload, in a second tab, and
// on a different machine. Reopening attaches to the existing call and never
// dials the customer again.
// ============================================================

import { useState } from "react";

import type { CallRecord } from "@/lib/types";
import { useAgentConfigStore } from "@/lib/store";
import { useCallRecords } from "@/lib/use-dialo-data";
import { useNow } from "@/lib/use-now";
import { RESULT_TIMEOUT_MS } from "@/lib/format";
import { RealCallModal } from "@/components/call/RealCallModal";

export function ActiveCallBanner() {
  const { records, refresh } = useCallRecords(8000);
  const { config: agentConfig } = useAgentConfigStore();
  const now = useNow(15_000);
  const [watching, setWatching] = useState<CallRecord | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Only a genuinely live attempt qualifies. One that has gone quiet past the
  // webhook timeout is reported on the Results page instead, since claiming it is
  // still in progress would be a guess.
  const active = records.find((record) => {
    if (record.status !== "calling" && record.status !== "initiating") return false;
    if (!record.requestedAt || now === 0) return false;
    return now - new Date(record.requestedAt).getTime() < RESULT_TIMEOUT_MS;
  });

  if (!active || dismissed === active.id) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
        </span>

        <p className="text-amber-900 dark:text-amber-300">
          Calling <span className="font-medium">{active.lead.name}</span> — waiting for the
          provider.
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setWatching(active)}
            className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950/60"
          >
            View call
          </button>
          <button
            onClick={() => setDismissed(active.id)}
            className="rounded-md px-2 py-1 text-xs text-amber-800/80 transition-colors hover:bg-amber-100 dark:text-amber-400/80 dark:hover:bg-amber-950/60"
          >
            Hide
          </button>
        </div>
      </div>

      {watching && (
        <RealCallModal
          lead={watching.lead}
          agentConfig={agentConfig}
          watchCallId={watching.id}
          onClose={() => {
            setWatching(null);
            refresh();
          }}
          onSettled={refresh}
        />
      )}
    </>
  );
}
