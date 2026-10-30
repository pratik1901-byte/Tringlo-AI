"use client";

// ============================================================
// Tringlo AI — Inbound analytics
// ============================================================
//
// Calls customers made to the workspace's inbound line — kept apart from the
// outbound Analytics page. Every figure comes from /api/inbound/analytics,
// computed on the server from real call records.
// ============================================================

import Link from "next/link";
import { useState } from "react";
import { PhoneIncoming, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { InboundAnalytics } from "@/lib/inbound/analytics";
import { useApi } from "@/lib/use-tringlo-data";
import { formatCount, formatDuration, formatLabel, formatPercent } from "@/lib/format";
import { EmptyState, ErrorState, LoadingState, MetricCard, PageHeader } from "@/components/ui/data-display";
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-theme";

interface Response {
  enabled: boolean;
  deploymentStatus: string;
  analytics: InboundAnalytics;
}

const RANGES = [7, 30, 90] as const;
const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const OUTBOUND_COLOR = CHART_COLORS.muted;
const INBOUND_COLOR = "#0F766E";



export default function InboundAnalyticsPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, error, isLoading, isRefreshing, refresh } = useApi<Response>(`/api/inbound/analytics?days=${days}`, 30_000);
  const a = data?.analytics;
  const t = a?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbound calls"
        description="Calls customers made to your inbound line. Outbound results are on the Analytics page."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border p-0.5" role="group" aria-label="Range">
              {RANGES.map((range) => (
                <button
                  key={range}
                  onClick={() => setDays(range)}
                  aria-pressed={days === range}
                  className={`h-8 rounded px-2.5 text-xs font-medium transition-colors ${
                    days === range ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {range} days
                </button>
              ))}
            </div>
            <button
              onClick={refresh}
              aria-label="Refresh"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors hover:bg-muted"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      />

      {error && <ErrorState message={error} onRetry={refresh} />}
      {isLoading && !data && <LoadingState label="Loading inbound analytics" />}

      {data && a && t && (
        <>
          {!data.enabled && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Inbound calling is off for this workspace{t.inboundCalls ? " — figures below are from when it was on" : ""}.
              </span>
              <Link href="/settings" className="text-sm font-medium text-primary hover:text-primary/80">
                Set up inbound calling
              </Link>
            </div>
          )}

          {t.inboundCalls === 0 ? (
            <EmptyState
              icon={PhoneIncoming}
              title="No inbound calls in this range"
              description="When a customer calls your inbound number, the call appears here once Sarvam reports it."
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 phone:gap-2.5">
                <MetricCard
                  label="Inbound calls"
                  value={t.inboundCalls}
                  format={formatCount}
                  caption={`${t.connected} answered by the agent`}
                />
                <MetricCard
                  label="Resolved by AI"
                  value={t.resolutionRate === null ? null : t.resolutionRate * 100}
                  format={(value) => formatPercent(value, 0)}
                  caption={`${t.resolvedByAi} of ${t.connected} answered calls`}
                  captionTone="positive"
                />
                <MetricCard
                  label="Transferred to a person"
                  value={t.humanHandoffs}
                  format={formatCount}
                  caption={
                    t.handoffsRequested
                      ? `${t.handoffsRequested} asked for a person${t.transferFailed ? ` · ${t.transferFailed} not transferred` : ""}`
                      : "No caller asked for a person"
                  }
                  captionTone={t.transferFailed ? "negative" : "neutral"}
                />
                <MetricCard
                  label="Avg. call duration"
                  value={t.averageDurationSeconds}
                  format={(value) => formatDuration(Math.round(value))}
                  caption={t.connected ? `Across ${t.connected} answered calls` : null}
                />
                <MetricCard label="Unresolved" value={t.unresolved} format={formatCount} caption={t.resolutionNotReported ? `${t.resolutionNotReported} with no outcome reported` : null} />
                <MetricCard label="Unique callers" value={t.uniqueCallers} format={formatCount} caption={`${t.repeatCallers} called more than once`} />
                <MetricCard label="Follow-ups requested" value={t.followUpRequests} format={formatCount} caption="Handled on the Follow-ups page" />
                <MetricCard
                  label="Handoff rate"
                  value={t.handoffRate === null ? null : t.handoffRate * 100}
                  format={(value) => formatPercent(value, 0)}
                  caption="Of answered calls"
                />
              </div>

              <section className="rounded-lg border bg-card p-5">
                <h2 className="text-sm font-semibold">Inbound vs outbound, per day</h2>
                <div className="mt-4 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={a.daily} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                      <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(d: string) => d.slice(5)} minTickGap={18} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
                      <Tooltip {...chartTooltipStyle} cursor={{ fill: "var(--muted)" }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="outbound" name="Outbound" fill={OUTBOUND_COLOR} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="inbound" name="Inbound" fill={INBOUND_COLOR} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-lg border bg-card p-5">
                  <h2 className="text-sm font-semibold">When people call ({a.timezone})</h2>
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={a.byHour} margin={{ top: 8, right: 4, left: -26, bottom: 0 }}>
                        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="hour" tickLine={false} axisLine={false} tick={AXIS_TICK} tickFormatter={(h: number) => `${h}h`} minTickGap={12} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
                        <Tooltip {...chartTooltipStyle} cursor={{ fill: "var(--muted)" }} labelFormatter={(h) => `${h}:00–${h}:59`} />
                        <Bar dataKey="calls" name="Calls" fill={INBOUND_COLOR} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
                <section className="rounded-lg border bg-card p-5">
                  <h2 className="text-sm font-semibold">By day of week</h2>
                  <div className="mt-4 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={a.byWeekday} margin={{ top: 8, right: 4, left: -26, bottom: 0 }}>
                        <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={AXIS_TICK} />
                        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
                        <Tooltip {...chartTooltipStyle} cursor={{ fill: "var(--muted)" }} />
                        <Bar dataKey="calls" name="Calls" fill={INBOUND_COLOR} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-lg border bg-card p-5">
                  <h2 className="text-sm font-semibold">Why people called</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">As reported by the agent on answered calls.</p>
                  <BarList items={a.reasons.map((r) => ({ label: formatLabel(r.reason), value: r.calls }))} />
                </section>
                <section className="rounded-lg border bg-card p-5">
                  <h2 className="text-sm font-semibold">Outcomes</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Transfers are counted only when Sarvam confirms the call was transferred.
                  </p>
                  <BarList items={a.outcomes.map((o) => ({ label: o.label, value: o.calls }))} />
                  <p className="mt-4 text-xs text-muted-foreground">
                    Callers: {a.callers.firstTime} called once · {a.callers.repeat} called again
                  </p>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BarList({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (items.every((item) => item.value === 0)) {
    return <p className="mt-4 text-sm text-muted-foreground">Nothing reported yet.</p>;
  }
  return (
    <ul className="mt-4 space-y-2.5">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between text-sm">
            <span>{item.label}</span>
            <span className="font-mono text-xs text-muted-foreground">{item.value}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(item.value / max) * 100}%`, background: INBOUND_COLOR }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
