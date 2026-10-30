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

import { useAuthStore } from "@/lib/store";
import { useCallRecords, useMetrics } from "@/lib/use-tringlo-data";
import { useNow } from "@/lib/use-now";
import { useReveal } from "@/lib/animation";
import {
  EMPTY,
  formatCount,
  formatDate,
  formatPhone,
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
import {
  ChartReadout,
  NoTooltip,
  ScaleBridge,
  SeriesChips,
  phoneBarShape,
  selectionOpacity,
  useChartSelection,
  useIsPhone,
  useSeriesVisibility,
  type Series,
} from "@/components/charts/phone-chart";

/** The activity chart's series, named once for the legend chips and the readout. */
const ACTIVITY_SERIES: Series[] = [
  { key: "calls", name: "Placed", color: CHART_COLORS.muted },
  { key: "connected", name: "Answered", color: CHART_COLORS.primary },
];

export default function DashboardPage() {
  const { data, error, isLoading, refresh } = useMetrics();
  const { records } = useCallRecords();
  const now = useNow(60_000);

  // Phone-only chart interaction. Called before the early returns below, as
  // hooks must be; on the desktop `isPhone` is false and none of it is used.
  const isPhone = useIsPhone();
  const activity = useChartSelection(data?.daily.map((point) => point.label) ?? []);
  const activitySeries = useSeriesVisibility(ACTIVITY_SERIES);
  const outcomes = useChartSelection(data?.outcomes.map((slice) => slice.name) ?? []);

  const metrics = data?.metrics;
  const kpiRef = useReveal<HTMLDivElement>({ deps: [Boolean(metrics)] });
  const chartsRef = useReveal<HTMLDivElement>({ delay: 0.1, deps: [Boolean(metrics)] });

  const user = useAuthStore((state) => state.user);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // A greeting rather than a label: the first thing on the first page.
  const hour = new Date().getHours();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const greeting = `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}${firstName ? `, ${firstName}` : ""}`;
  const header = (
    <PageHeader
      eyebrow="Overview"
      title={greeting}
      description={
        <>
          {user?.tenantName ? (
            <>
              Here&apos;s how <span className="font-medium text-foreground">{user.tenantName}</span> is doing.{" "}
            </>
          ) : null}
          {today}
        </>
      }
    />
  );

  if (isLoading && !metrics) {
    return (
      <div className="space-y-6">
        {header}
        <LoadingState label="Loading call data" />
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState message={error} onRetry={refresh} />
      </div>
    );
  }

  if (!metrics) return null;

  const hasCalls = metrics.totalCalls > 0;
  const recentCalls = records.slice(0, 8);
  const inboundCalls = records.filter((call) => call.direction === "inbound").length;

  return (
    <div className="space-y-6">
      {header}

      {error && <ErrorState message={error} onRetry={refresh} />}

      {/* KPIs. Each caption is derived — where there is no baseline it reads "—". */}
      {/* Two columns on a phone: six full-width cards would push the charts
          three screens down. */}
      <div ref={kpiRef} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 phone:grid-cols-2! phone:gap-3 phone:landscape:grid-cols-3!">
        <MetricCard
          featured
          label="Calls placed today"
          value={metrics.callsToday}
          format={(value) => formatCount(Math.round(value))}
          caption={
            metrics.callsTodayDelta === null
              ? "No calls yesterday to compare"
              : `${formatDelta(metrics.callsTodayDelta, "", 0)} vs yesterday`
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
          label="Calls placed"
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

      {/* Said plainly, because the figures above exclude them. */}
      {inboundCalls > 0 && (
        <p className="-mt-1 text-xs text-muted-foreground">
          These figures cover the calls Tringlo placed.{" "}
          <Link href="/inbound" className="font-medium text-primary hover:underline">
            {inboundCalls} inbound {inboundCalls === 1 ? "call" : "calls"}
          </Link>{" "}
          {inboundCalls === 1 ? "is" : "are"} counted separately.
        </p>
      )}

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
            <section className="rounded-xl border bg-card p-6 lg:col-span-3 phone:p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <h2 className="font-heading text-[15px] font-semibold tracking-tight">Call activity</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Last 7 days</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground phone:hidden">
                  <Legend color={CHART_COLORS.muted} label="Placed" />
                  <Legend color={CHART_COLORS.primary} label="Answered" />
                </div>
              </div>

              {isPhone && (
                <>
                  <div className="mt-4">
                    <SeriesChips
                      series={ACTIVITY_SERIES}
                      isVisible={activitySeries.isVisible}
                      onToggle={activitySeries.toggle}
                    />
                  </div>
                  <ChartReadout
                    label={activity.index === null ? null : (data?.daily[activity.index]?.label ?? null)}
                    items={ACTIVITY_SERIES.filter((series) => activitySeries.isVisible(series.key)).map(
                      (series) => ({
                        name: series.name,
                        color: series.color,
                        value: pointValue(data?.daily, activity.index, series.key),
                      })
                    )}
                  />
                </>
              )}

              {/* `touch-pan-y` on a phone: a vertical swipe still scrolls the
                  page, a horizontal one scrubs the chart. */}
              <div className="mt-5 h-56 phone:mt-3 phone:touch-pan-y" {...(isPhone ? activity.bind : {})}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data?.daily ?? []} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    {isPhone && <ScaleBridge scaleRef={activity.scaleRef} />}
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
                    <Tooltip
                      {...chartTooltipStyle}
                      cursor={isPhone ? false : { fill: "var(--muted)", opacity: 0.4 }}
                      {...(isPhone ? { content: NoTooltip } : {})}
                    />
                    {ACTIVITY_SERIES.map((series) => (
                      <Bar
                        key={series.key}
                        dataKey={series.key}
                        name={series.name}
                        fill={series.color}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                        {...(isPhone
                          ? {
                              hide: !activitySeries.isVisible(series.key),
                              shape: phoneBarShape(activity.index),
                            }
                          : {})}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-6 lg:col-span-2 phone:p-4">
              <h2 className="font-heading text-[15px] font-semibold tracking-tight">Outcomes</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">All completed attempts</p>

              {(data?.outcomes.length ?? 0) === 0 ? (
                <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No completed attempts yet
                </p>
              ) : (
                <>
                  {isPhone && outcomes.index !== null && data?.outcomes[outcomes.index] && (
                    <ChartReadout
                      label={data.outcomes[outcomes.index].name}
                      hint="Tap a slice or a row"
                      items={[
                        {
                          name: "Calls",
                          color:
                            CHART_COLORS.categorical[data.outcomes[outcomes.index].outcome] ??
                            CHART_COLORS.primary,
                          value: data.outcomes[outcomes.index].value,
                        },
                        {
                          name: "Share",
                          color: "transparent",
                          value: shareOf(data.outcomes, outcomes.index),
                        },
                      ]}
                    />
                  )}

                  <div className="mt-4 h-40 phone:h-48">
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
                          shape={isPhone ? phoneOutcomeSector(outcomes.index) : outcomeSector}
                          {...(isPhone
                            ? { onClick: (_: unknown, index: number) => outcomes.select(index) }
                            : {})}
                        />
                        <Tooltip {...chartTooltipStyle} {...(isPhone ? { content: NoTooltip } : {})} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <ul className="mt-4 space-y-1.5 phone:space-y-0.5">
                    {(data?.outcomes ?? []).map((slice, index) =>
                      isPhone ? (
                        <li key={slice.outcome}>
                          {/* A 40px row on a phone: the slices themselves are
                              too small to be the only way to select one. */}
                          <button
                            type="button"
                            onClick={() => outcomes.select(index)}
                            aria-pressed={outcomes.index === index}
                            className={
                              "flex h-10 w-full items-center justify-between rounded-md px-2 text-sm transition-colors active:bg-muted " +
                              (outcomes.index === index ? "bg-muted/70" : "")
                            }
                          >
                            <span className="flex items-center gap-2 text-muted-foreground">
                              <span
                                className="h-2.5 w-2.5 rounded-sm"
                                style={{ background: CHART_COLORS.categorical[slice.outcome] }}
                              />
                              {slice.name}
                            </span>
                            <span className="font-mono tabular-nums text-foreground">{slice.value}</span>
                          </button>
                        </li>
                      ) : (
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
                      )
                    )}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border bg-card">
            <header className="flex items-center justify-between border-b px-5 py-3.5 phone:px-4">
              <h2 className="font-heading text-[15px] font-semibold tracking-tight">Recent calls</h2>
              <Link href="/results" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            </header>

            {/* Phone: a stacked list. Five columns do not fit 375px, and a
                table that scrolls sideways hides the status — the one column
                someone checking between calls actually wants. */}
            <ul className="hidden divide-y phone:block">
              {recentCalls.map((call) => (
                <li key={call.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">{call.lead.name} {call.direction === "inbound" && <span className="ml-1.5 rounded bg-teal-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">In</span>}</p>
                    <StatusBadge
                      status={call.status}
                      requestedAt={call.requestedAt}
                      now={now}
                      showPulse
                    />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="truncate font-mono">{formatPhone(call.lead.phone)}</span>
                    <span className="shrink-0 tabular-nums">
                      {formatDuration(call.duration)} · {formatTime(call.startedAt || call.requestedAt) || EMPTY}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="overflow-x-auto phone:hidden">
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
                      <td className="px-5 py-3 font-medium">{call.lead.name} {call.direction === "inbound" && <span className="ml-1.5 rounded bg-teal-50 px-1 py-0.5 text-[10px] font-semibold uppercase text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">In</span>}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatPhone(call.lead.phone)}
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

/**
 * The phone version of the outcome slice: the selected slice stands out a few
 * pixels and the rest step back, so what the readout describes is visible in
 * the chart as well.
 */
function phoneOutcomeSector(selected: number | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts passes untyped sector props, as for outcomeSector
  return function PhoneSector({ key, ...sector }: any) {
    const outcome = sector?.payload?.outcome as string | undefined;
    const index = sector?.index as number | undefined;
    const isSelected = selected !== null && index === selected;
    return (
      <Sector
        key={key ?? outcome ?? index}
        {...sector}
        outerRadius={(sector?.outerRadius ?? 66) + (isSelected ? 5 : 0)}
        fill={(outcome && CHART_COLORS.categorical[outcome]) || CHART_COLORS.primary}
        fillOpacity={index === undefined ? 1 : selectionOpacity(index, selected)}
      />
    );
  };
}

/** One series' value at the selected point, or null where there is none. */
function pointValue(points: object[] | undefined, index: number | null, key: string): number | null {
  if (!points || index === null) return null;
  const value = (points[index] as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : null;
}

/** A slice as a percentage of all completed attempts, for the phone readout. */
function shareOf(slices: { value: number }[], index: number): string {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return EMPTY;
  return `${Math.round((slices[index].value / total) * 100)}%`;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
