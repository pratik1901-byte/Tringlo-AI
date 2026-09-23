"use client";

import Link from "next/link";
import { Bot, Upload } from "lucide-react";
import {
  Bar,
  BarChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useCallRecords, useMetrics } from "@/lib/use-dialo-data";
import { useNow } from "@/lib/use-now";
import { useReveal } from "@/lib/animation";
import {
  EMPTY,
  formatCount,
  formatDate,
  formatDelta,
  formatDuration,
  formatPercent,
  formatTime,
} from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/ui/data-display";
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-theme";

export default function DashboardPage() {
  const { data, error, isLoading, refresh } = useMetrics();
  const { records } = useCallRecords();
  const now = useNow(60_000);

  const metrics = data?.metrics;
  const kpiRef = useReveal<HTMLDivElement>({ deps: [Boolean(metrics)] });
  const chartsRef = useReveal<HTMLDivElement>({ delay: 0.1, deps: [Boolean(metrics)] });

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (isLoading && !metrics) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={today} />
        <LoadingState label="Loading call data" />
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={today} />
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  if (!metrics) return null;

  const hasCalls = metrics.totalCalls > 0;
  const recentCalls = records.slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" description={today} />

      {error && <ErrorState message={error} onRetry={refresh} />}

      {/* KPIs. Each caption is derived — where there is no baseline it reads "—". */}
      <div ref={kpiRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Calls today"
          value={metrics.callsToday}
          format={(value) => formatCount(Math.round(value))}
          caption={
            metrics.callsTodayDelta === null
              ? "No calls yesterday to compare"
              : `${formatDelta(metrics.callsTodayDelta)} vs yesterday`
          }
          captionTone={
            metrics.callsTodayDelta === null
              ? "neutral"
              : metrics.callsTodayDelta >= 0
                ? "positive"
                : "negative"
          }
        />
        <MetricCard
          label="Total calls"
          value={metrics.totalCalls}
          format={(value) => formatCount(Math.round(value))}
          caption={
            metrics.firstCallAt ? `Since ${formatDate(metrics.firstCallAt)}` : "No calls placed yet"
          }
        />
        <MetricCard
          label="Contact rate"
          value={metrics.contactRate?.value ?? null}
          format={(value) => formatPercent(value)}
          caption={
            metrics.contactRate
              ? `${metrics.connectedCalls} answered of ${metrics.contactRate.of} completed`
              : "No completed attempts yet"
          }
        />
        <MetricCard
          label="Interested"
          value={metrics.interestedCalls}
          format={(value) => formatCount(Math.round(value))}
          caption={
            metrics.interestRate
              ? `${formatPercent(metrics.interestRate.value)} of answered calls`
              : "No answered calls yet"
          }
        />
        <MetricCard
          label="Interest rate"
          value={metrics.interestRate?.value ?? null}
          format={(value) => formatPercent(value)}
          caption={
            metrics.interestRateDelta === null
              ? "Not enough history to compare"
              : `${formatDelta(metrics.interestRateDelta, "pp")} vs last week`
          }
          captionTone={
            metrics.interestRateDelta === null
              ? "neutral"
              : metrics.interestRateDelta >= 0
                ? "positive"
                : "negative"
          }
        />
        <MetricCard
          label="Follow-ups"
          value={metrics.pendingFollowUps}
          format={(value) => formatCount(Math.round(value))}
          caption={
            metrics.pendingFollowUps === 0
              ? "Nothing scheduled"
              : [
                  metrics.overdueFollowUps > 0 ? `${metrics.overdueFollowUps} overdue` : null,
                  metrics.unscheduledFollowUps > 0
                    ? `${metrics.unscheduledFollowUps} need a time`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "All on schedule"
          }
          captionTone={metrics.overdueFollowUps > 0 ? "negative" : "neutral"}
        />
      </div>

      {!hasCalls ? (
        <EmptyState
          icon={Upload}
          title="No calls yet"
          description="Upload your leads and configure the agent, then place your first call. Results appear here as soon as Sarvam reports them."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/upload"
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Upload className="h-4 w-4" />
                Upload leads
              </Link>
              <Link
                href="/agent"
                className="inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Bot className="h-4 w-4" />
                Configure agent
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div ref={chartsRef} className="grid gap-4 lg:grid-cols-5">
            <section className="rounded-lg border bg-card p-5 lg:col-span-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <h2 className="font-heading text-sm font-semibold tracking-tight">Call activity</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Last 7 days</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <Legend color={CHART_COLORS.muted} label="Placed" />
                  <Legend color={CHART_COLORS.primary} label="Answered" />
                </div>
              </div>

              <div className="mt-5 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.daily ?? []} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip {...chartTooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                    <Bar dataKey="calls" name="Placed" fill={CHART_COLORS.muted} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="connected" name="Answered" fill={CHART_COLORS.primary} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-lg border bg-card p-5 lg:col-span-2">
              <h2 className="font-heading text-sm font-semibold tracking-tight">Outcomes</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">All completed attempts</p>

              {(data?.outcomes.length ?? 0) === 0 ? (
                <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No completed attempts yet
                </p>
              ) : (
                <>
                  <div className="mt-4 h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data?.outcomes}
                          dataKey="value"
                          cx="50%"
                          cy="50%"
                          innerRadius={44}
                          outerRadius={66}
                          paddingAngle={2}
                          stroke="none"
                          animationDuration={600}
                          shape={outcomeSector}
                        />
                        <Tooltip {...chartTooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <ul className="mt-4 space-y-1.5">
                    {(data?.outcomes ?? []).map((slice) => (
                      <li key={slice.outcome} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ background: CHART_COLORS.categorical[slice.outcome] }}
                          />
                          {slice.name}
                        </span>
                        <span className="font-mono tabular-nums text-foreground">{slice.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-5 py-3.5">
              <h2 className="font-heading text-sm font-semibold tracking-tight">Recent calls</h2>
              <Link href="/results" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-5 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Phone</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Duration</th>
                    <th className="px-5 py-2.5 text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentCalls.map((call) => (
                    <tr key={call.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/40">
                      <td className="px-5 py-3 font-medium">{call.lead.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {call.lead.phone}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={call.status}
                          requestedAt={call.requestedAt}
                          now={now}
                          showPulse
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatDuration(call.duration)}
                      </td>
                      <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                        {formatTime(call.startedAt || call.requestedAt) || EMPTY}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Colours each slice from its outcome, keeping the chart and the legend in step.
 * Recharts 3 deprecated `<Cell>` in favour of this shape renderer.
 *
 * `key` is lifted out of the spread deliberately: Recharts hands React's key
 * through inside the props object, and spreading it into JSX makes React treat
 * it as an ordinary prop and warn.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function outcomeSector({ key, ...sector }: any) {
  const outcome = sector?.payload?.outcome as string | undefined;
  return (
    // Recharts supplies the key, but it re-renders sectors during the entrance
    // animation and does not always carry one through. Falling back to the
    // outcome — which is unique per slice — keeps every sector keyed.
    <Sector
      key={key ?? outcome ?? sector?.index}
      {...sector}
      fill={(outcome && CHART_COLORS.categorical[outcome]) || CHART_COLORS.primary}
    />
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
