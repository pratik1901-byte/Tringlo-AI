"use client";

// ============================================================
// Call history — what actually happened on the line
// ============================================================
//
// These are the platform's own call records. A summary, a duration or a
// transcript shows because the provider reported one; a call with none shows
// none, and nothing is filled in to make the table look complete.
// ============================================================

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PhoneIncoming, PhoneOutgoing, Search } from "lucide-react";

import { formatWhen, useApi } from "@/lib/hospital/panel-api";
import {
  Card,
  Dialog,
  Empty,
  Loading,
  PageHeader,
  Problem,
  Status,
  Table,
  inputClass,
} from "@/components/hospital/ui";

interface Call {
  id: string;
  name: string | null;
  phoneMasked: string | null;
  direction: string;
  at: string | null;
  status: string;
  duration: number | null;
  summary: string | null;
  purpose: string;
  appointmentId: string | null;
  doctorName: string | null;
  handoff: string;
  agent: string | null;
  hasTranscript: boolean;
}

interface CallDetail extends Call {
  transcriptTurns: Array<{ role: string; text: string }> | null;
  transcript: string | null;
  failureReason: string | null;
}

const tone = (status: string) =>
  status === "connected" ? "good" : status === "failed" || status === "provider_error" ? "bad" : status === "no_answer" || status === "busy" ? "warn" : "neutral";

export default function CallsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Calls />
    </Suspense>
  );
}

function Calls() {
  const params = useSearchParams();
  const [direction, setDirection] = useState(params.get("direction") ?? "");
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(params.get("id"));

  const query = `hospital/calls${direction ? `?direction=${direction}` : ""}`;
  const { data, error, loading, reload } = useApi<{ calls: Call[]; timezone: string }>(query);
  const { data: detail } = useApi<{ call: CallDetail }>(chosen ? `hospital/calls?id=${encodeURIComponent(chosen)}` : null);

  const timezone = data?.timezone ?? "Asia/Kolkata";
  const rows = (data?.calls ?? []).filter((call) =>
    search ? (call.name ?? "").toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Calling"
        title="Call history"
        description="Every call this hospital has made or received, as the provider reported it."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input className={`${inputClass} pl-9`} placeholder="Search by caller" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={`${inputClass} w-auto`} value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">Both directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </div>

      {loading && <Loading label="Loading calls" />}
      {error && <Problem message={error} onRetry={reload} />}

      {!loading && !error && rows.length === 0 && (
        <Empty
          title="No calls recorded"
          description="Calls appear here once the hospital's line is live and the provider has reported them. Nothing on this page is generated."
        />
      )}

      {rows.length > 0 && (
        <Card>
          <Table head={["", "Caller", "When", "Purpose", "Status", "Summary"]}>
            {rows.map((call) => (
              <tr key={call.id} className="cursor-pointer hover:bg-sunken/40" onClick={() => setChosen(call.id)}>
                <td className="px-4 py-3">
                  {call.direction === "inbound" ? (
                    <PhoneIncoming className="h-4 w-4 text-sage" aria-label="Inbound" />
                  ) : (
                    <PhoneOutgoing className="h-4 w-4 text-ink-muted" aria-label="Outbound" />
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{call.name ?? "Unknown caller"}</span>
                  <span className="block text-[11px] text-ink-muted tabular">{call.phoneMasked ?? "—"}</span>
                </td>
                <td className="px-4 py-3 text-ink-soft">{formatWhen(call.at, timezone)}</td>
                <td className="px-4 py-3 text-[12.5px] text-ink-soft">
                  {call.purpose}
                  {call.doctorName && <span className="block text-[11px] text-ink-muted">{call.doctorName}</span>}
                </td>
                <td className="px-4 py-3">
                  <Status label={call.status} tone={tone(call.status)} />
                  {call.handoff !== "none" && (
                    <span className="mt-1 block text-[11px] text-clay">handoff: {call.handoff}</span>
                  )}
                </td>
                <td className="max-w-[22rem] px-4 py-3 text-ink-muted">
                  {call.summary ? <span className="line-clamp-2">{call.summary}</span> : <span className="text-xs">No summary reported</span>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(chosen)} title="Call" onClose={() => setChosen(null)}>
        {!detail ? (
          <Loading label="Loading the call" />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Caller", detail.call.name ?? "Unknown"],
                ["Number", detail.call.phoneMasked ?? "—"],
                ["When", formatWhen(detail.call.at, timezone)],
                ["Direction", detail.call.direction],
                ["Status", detail.call.status],
                ["Duration", detail.call.duration ? `${detail.call.duration}s` : "not reported"],
                ["Purpose", detail.call.purpose],
                ["Agent", detail.call.agent ?? "—"],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
                  <dd className="mt-0.5 text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            {detail.call.failureReason && (
              <p className="rounded-lg bg-alert-soft px-3 py-2 text-[13px] text-ink">{detail.call.failureReason}</p>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Summary</p>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                {detail.call.summary ?? "The provider reported no summary for this call."}
              </p>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-soft">Transcript</p>
              {detail.call.transcriptTurns?.length ? (
                <ol className="space-y-2">
                  {detail.call.transcriptTurns.map((turn, index) => (
                    <li key={index} className="grid grid-cols-[72px_1fr] gap-3 text-[13px]">
                      <span className="text-[11px] uppercase tracking-wide text-ink-muted">{turn.role}</span>
                      <span className="text-ink-soft">{turn.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] text-ink-muted">No transcript was recorded for this call.</p>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
