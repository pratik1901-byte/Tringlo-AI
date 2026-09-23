"use client";

import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useMetrics } from "@/lib/use-dialo-data";
import { useReveal } from "@/lib/animation";
import { formatCount, formatDelta, formatDuration, formatPercent } from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  PageHeader,
} from "@/components/ui/data-display";
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-theme";

export default function AnalyticsPage() {
  const { data, error, isLoading, refresh } = useMetrics();
  const metrics = data?.metrics;

  const kpiRef = useReveal<HTMLDivElement>({ deps: [Boolean(metrics)] });
  const chartsRef = useReveal<HTMLDivElement>({ delay: 0.1, deps: [Boolean(metrics)] });

  const description = "Performance across every call Sarvam has reported";

  if (isLoading && !metrics) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" description={description} />
        <LoadingState label="Computing metrics" />
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" description={description} />
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  if (!metrics) return null;

  if (metrics.totalCalls === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" description={description} />
        <EmptyState
          icon={BarChart3}
          title="Nothing to analyse yet"
          description="Analytics are computed from real call outcomes. Place your first call and the charts fill in as results arrive."
        />
      </div>
    );
  }

  const weekly = data?.weekly ?? [];
  const hourly = data?.hourly ?? [];
  const hasWeeklyData = weekly.some((point) => point.calls > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description={description} />

      {error && <ErrorState message={error} onRetry={refresh} />}

      <div ref={kpiRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Avg. call duration"
          value={metrics.averageDurationSeconds}
          format={(value) => formatDuration(Math.round(value))}
          caption={
            metrics.connectedCalls > 0
              ? `Across ${metrics.connectedCalls} answered ${metrics.connectedCalls === 1 ? "call" : "calls"}`
              : "No answered calls yet"
          }
        />
        <MetricCard
          label="Avg. calls per active day"
          value={metrics.averageCallsPerActiveDay}
          format={(value) => value.toFixed(1)}
          caption={
            metrics.peakDay
              ? `Busiest: ${metrics.peakDay.name} (${metrics.peakDay.count})`
              : "No dated calls yet"
          }
        />
        <MetricCard
          label="Contact rate"
          value={metrics.contactRate?.value ?? null}
          format={(value) => formatPercent(value)}
          caption={
            metrics.contactRate
              ? `${metrics.connectedCalls} of ${metrics.contactRate.of} attempts answered`
              : "No completed attempts yet"
          }
        />
        <MetricCard
          label="Interest rate"
          value={metrics.interestRate?.value ?? null}
          format={(value) => formatPercent(value)}
          caption={
            metrics.interestRateDelta === null
              ? "No prior week to compare against"
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
          label="Follow-up rate"
          value={metrics.followUpRate?.value ?? null}
          format={(value) => formatPercent(value)}
          caption={
            metrics.followUpRate
              ? `${metrics.pendingFollowUps} still open`
              : "No answered calls yet"
          }
        />
        <MetricCard
          label="Avg. confidence"
          value={metrics.averageConfidence}
          format={(value) => `${Math.round(value)}%`}
          caption={
            /* Only calls where the agent actually reported a confidence count
               toward this average — a missing value is not treated as zero. */
            metrics.averageConfidence === null
              ? "The agent has not reported a confidence yet"
              : "Where the agent reported one"
          }
        />
      </div>

      <div ref={chartsRef} className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border bg-card p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="font-heading text-sm font-semibold tracking-tight">
                Weekly calls and interest rate
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Last 8 weeks</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: CHART_COLORS.muted }} />
                Calls
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full border-2"
                  style={{ borderColor: CHART_COLORS.primary }}
                />
                Interest rate
              </span>
            </div>
          </div>

          <div className="mt-5 h-60">
            {hasWeeklyData ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weekly} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    yAxisId="calls"
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    yAxisId="rate"
                    orientation="right"
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip {...chartTooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Bar
                    yAxisId="calls"
                    dataKey="calls"
                    name="Calls"
                    fill={CHART_COLORS.muted}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={30}
                  />
                  {/* connectNulls stays false: a week with no answered call has no
                      interest rate, and the line breaks rather than implying one. */}
                  <Line
                    yAxisId="rate"
                    type="monotone"
                    dataKey="interestRate"
                    name="Interest rate %"
                    stroke={CHART_COLORS.primary}
                    strokeWidth={2}
                    dot={{ r: 3, fill: CHART_COLORS.primary, strokeWidth: 0 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label="No calls in the last 8 weeks" />
            )}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="font-heading text-sm font-semibold tracking-tight">Calls by hour</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {/* Only hours with real activity are plotted, rather than a fixed 8am–6pm
                axis that would imply coverage the data does not show. */}
            Hours with recorded activity
          </p>

          <div className="mt-5 h-60">
            {hourly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly} margin={{ top: 8, right: 4, left: -26, bottom: 0 }}>
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip {...chartTooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <Bar
                    dataKey="connected"
                    name="Answered"
                    fill={CHART_COLORS.primary}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart label="No timed calls yet" />
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-heading text-sm font-semibold tracking-tight">
          Interested leads over time
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Weekly count of answered calls the agent marked interested
        </p>

        <div className="mt-5 h-52">
          {hasWeeklyData ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekly} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="3 3" vertical={false} />
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
                <Tooltip {...chartTooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="interested"
                  name="Interested"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART_COLORS.primary, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart label="No calls in the last 8 weeks" />
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        {formatCount(metrics.totalCalls)} attempts · {formatCount(metrics.connectedCalls)} answered ·{" "}
        {formatDuration(metrics.totalTalkTimeSeconds)} total talk time
        {metrics.inFlightCalls > 0 && ` · ${metrics.inFlightCalls} in progress`}
        {metrics.abandonedCalls > 0 &&
          ` · ${metrics.abandonedCalls} with no result from the provider`}
      </p>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {label}
    </div>
  );
}
