"use client";

// ============================================================
// Dashboard — the hospital's day, and what needs a person
// ============================================================
//
// Every figure here is counted from this hospital's own records. Where there
// are none, the page says so rather than drawing an empty chart, and where the
// records are demonstration data it says that too.
//
// The second half is the queue: cancellations the hospital's system would not
// take, reports nobody has read, questions the agent could not answer and
// patients waiting to be rung back. Each is work that stalls silently if it is
// not on a screen somebody looks at.
// ============================================================

import Link from "next/link";
import { ArrowUpRight, PhoneIncoming, PhoneOutgoing } from "lucide-react";

import { formatWhen, relative, useApi } from "@/lib/hospital/panel-api";
import {
  Card,
  CardHead,
  DemoTag,
  Empty,
  Loading,
  PageHeader,
  Problem,
  Stat,
  Status,
  Table,
  appointmentTone,
  reminderTone,
} from "@/components/hospital/ui";

interface Overview {
  profile: { name: string; timezone: string; remindersEnabled: boolean };
  today: string;
  metrics: Record<string, number>;
  integration: {
    mode: "demo" | "live";
    label: string;
    configured: boolean;
    outstanding: string[];
    lastCheck: { at: string; ok: boolean; detail: string } | null;
  };
  directory: { source: "demo" | "live"; count: number; fetchedAt: string | null; stale: boolean; problem: string | null };
  upcoming: Array<{
    id: string;
    patientName: string;
    doctorName: string | null;
    specialty: string;
    scheduledAt: string;
    status: string;
    confirmation: { status: string; outcome: { response: string } | null } | null;
    demo: boolean;
  }>;
  cancellationsAwaiting: Array<{
    id: string;
    appointmentId: string;
    status: string;
    requestedAt: string;
    failureReason: string | null;
    patientName: string | null;
  }>;
  reportsAwaitingReview: Array<{
    id: string;
    patientName: string;
    collectedAt: string;
    status: string;
    failureReason: string | null;
    demo: boolean;
  }>;
  followUps: Array<{ id: string; patientName: string; reason: string; requestedAt: string; status: string; demo: boolean }>;
  unanswered: Array<{ id: string; question: string; at: string; handoff: boolean }>;
  recentCalls: Array<{
    id: string;
    name: string | null;
    phone: string | null;
    direction: string;
    at: string | null;
    status: string;
    summary: string | null;
    origin: string | null;
    handoff: string;
  }>;
  attention: {
    requested: number;
    missed: number;
    failedConfirmations: number;
    skippedConfirmations: number;
    cancellationsAwaiting: number;
    reportsAwaitingReview: number;
    unansweredInquiries: number;
    openFollowUps: number;
  };
}

export default function OverviewPage() {
  const { data, error, status, loading, reload } = useApi<Overview>("hospital");

  if (loading) return <Loading label="Loading today" />;
  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Dashboard" />
        <Problem message={error} onRetry={status === 401 ? undefined : reload} />
        {status === 401 && (
          <Empty
            title="Sign in first"
            description="This panel reads Wellness Hospital's records from Tringlo. Sign in to the platform, open the hospital's workspace, then come back."
            action={
              <a
                href="/login"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-sage px-4 text-[13px] font-medium text-white"
              >
                Open Tringlo <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            }
          />
        )}
      </div>
    );
  }
  if (!data) return null;

  const { metrics, profile } = data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const nothingYet = metrics.appointmentsToday === 0 && metrics.upcoming === 0 && metrics.inboundCalls === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title={greeting}
        description={
          <>
            {profile.name} · {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: profile.timezone })}
            {metrics.demoAppointments > 0 && (
              <> · <span className="text-ink-soft">{metrics.demoAppointments} demonstration appointments included</span></>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Appointments today" value={metrics.appointmentsToday} tone="sage" href="/hospital/appointments" />
        <Stat
          label="Upcoming"
          value={metrics.upcoming}
          note={`${metrics.confirmationsScheduled} confirmation calls ${profile.remindersEnabled ? "scheduled" : "held · calling is off"}`}
          href="/hospital/appointments"
        />
        <Stat
          label="Awaiting confirmation"
          value={metrics.awaitingConfirmation}
          note={metrics.awaitingConfirmation ? "Requests to confirm" : "Nothing waiting"}
          tone={metrics.awaitingConfirmation ? "clay" : "plain"}
          href="/hospital/appointments?status=requested"
        />
        <Stat
          label="Calls"
          value={metrics.inboundCalls + metrics.outboundCalls}
          note={`${metrics.inboundCalls} inbound · ${metrics.outboundCalls} outbound`}
          href="/hospital/calls"
        />
      </div>

      {nothingYet && (
        <Empty
          title="Nothing booked yet"
          description="Once appointments are made — at the desk or by the agent on a call — today's figures, the confirmation call schedule and the call history fill in here. You can load demonstration data from Settings to see how it all works."
          action={
            <Link href="/hospital/settings" className="inline-flex h-9 items-center rounded-lg bg-sage px-4 text-[13px] font-medium text-white">
              Open Settings
            </Link>
          }
        />
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead
            title="Next appointments"
            note="The soonest still standing"
            actions={
              <Link href="/hospital/appointments" className="text-[13px] font-medium text-sage hover:underline">
                All appointments
              </Link>
            }
          />
          {data.upcoming.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-muted">Nothing is booked ahead.</p>
          ) : (
            <Table head={["Patient", "Doctor", "When", "Status", "Confirmation"]}>
              {data.upcoming.map((appointment) => (
                <tr key={appointment.id} className="hover:bg-sunken/40">
                  <td className="px-4 py-3">
                    <Link href={`/hospital/appointments?id=${appointment.id}`} className="font-medium text-ink hover:text-sage">
                      {appointment.patientName}
                    </Link>
                    {appointment.demo && <span className="ml-2 align-middle"><DemoTag /></span>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {appointment.doctorName ?? "—"}
                    <span className="block text-[11px] text-ink-muted">{appointment.specialty}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {formatWhen(appointment.scheduledAt, profile.timezone)}
                    <span className="block text-[11px] text-ink-muted">{relative(appointment.scheduledAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Status label={appointment.status} tone={appointmentTone(appointment.status)} />
                  </td>
                  <td className="px-4 py-3">
                    {appointment.confirmation ? (
                      <Status
                        label={appointment.confirmation.outcome?.response.replace(/_/g, " ") ?? appointment.confirmation.status}
                        tone={reminderTone(appointment.confirmation.status)}
                      />
                    ) : (
                      <span className="text-xs text-ink-muted">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHead title="Needs attention" note="Only what the records show" />
            <ul className="divide-y text-sm">
              {[
                { label: "Appointment requests to confirm", value: data.attention.requested, href: "/hospital/appointments?status=requested" },
                { label: "Missed appointments", value: data.attention.missed, href: "/hospital/appointments?status=missed" },
                { label: "Cancellations not confirmed", value: data.attention.cancellationsAwaiting, href: "/hospital/appointments" },
                { label: "Reports awaiting review", value: data.attention.reportsAwaitingReview, href: "/hospital/medical-history" },
                { label: "Inquiries with no approved answer", value: data.attention.unansweredInquiries, href: "/hospital/inquiries" },
                { label: "Open follow-up requests", value: data.attention.openFollowUps, href: "/hospital/follow-ups" },
                { label: "Confirmation calls that failed", value: data.attention.failedConfirmations, href: "/hospital/reminders?status=failed" },
                { label: "Confirmation calls skipped", value: data.attention.skippedConfirmations, href: "/hospital/reminders?status=skipped" },
              ].map((row) => (
                <li key={row.label}>
                  <Link href={row.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-sunken/40">
                    <span className="text-ink-soft">{row.label}</span>
                    <span className={row.value ? "font-semibold text-clay tabular" : "text-ink-muted tabular"}>{row.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHead
              title="Hospital server"
              note={`${metrics.doctorsListed} doctors listed`}
              actions={
                <Link href="/hospital/settings" className="text-[13px] font-medium text-sage hover:underline">
                  Settings
                </Link>
              }
            />
            <div className="space-y-2.5 px-5 py-4 text-sm">
              <p className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{data.integration.label}</span>
                {data.integration.mode === "demo" ? (
                  <Status label="Demonstration" tone="warn" />
                ) : data.integration.configured ? (
                  <Status label="Configured" tone="good" />
                ) : (
                  <Status label="Not configured" tone="bad" />
                )}
              </p>
              <p className="leading-relaxed text-ink-muted">
                {data.integration.mode === "demo"
                  ? "No hospital server is connected. Doctors, patient identity and appointments come from a demonstration stand-in, and every record it serves is marked as demonstration data."
                  : data.integration.configured
                    ? "Doctors, patient records and appointments are read from the hospital's own system."
                    : "A hospital server is selected but not usable yet. Until it is, patient lookups return no result rather than a guess."}
              </p>
              {data.integration.outstanding.length > 0 && (
                <ul className="space-y-1 text-[12.5px] text-clay">
                  {data.integration.outstanding.slice(0, 3).map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              )}
              {data.directory.problem && (
                <p className="text-[12.5px] leading-relaxed text-alert">{data.directory.problem}</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Only rendered when there is something in it — an empty queue needs no card. */}
      {(data.cancellationsAwaiting.length > 0 ||
        data.reportsAwaitingReview.length > 0 ||
        data.followUps.length > 0 ||
        data.unanswered.length > 0) && (
        <Card>
          <CardHead title="Waiting on staff" note="The oldest items from each queue" />
          <div className="grid gap-px bg-[color:var(--line)] sm:grid-cols-2">
            <Queue
              title="Cancellations not confirmed"
              href="/hospital/appointments"
              empty="None outstanding"
              items={data.cancellationsAwaiting.map((entry) => ({
                id: entry.id,
                primary: entry.patientName ?? "Unknown patient",
                secondary: entry.failureReason ?? `Status: ${entry.status}`,
                at: entry.requestedAt,
              }))}
            />
            <Queue
              title="Reports awaiting review"
              href="/hospital/medical-history"
              empty="Nothing to read"
              items={data.reportsAwaitingReview.map((entry) => ({
                id: entry.id,
                primary: entry.patientName || "Unknown patient",
                secondary: entry.failureReason ?? "Preliminary, patient-reported history",
                at: entry.collectedAt,
                demo: entry.demo,
              }))}
            />
            <Queue
              title="Follow-up requests"
              href="/hospital/follow-ups"
              empty="Nobody waiting"
              items={data.followUps.map((entry) => ({
                id: entry.id,
                primary: entry.patientName,
                secondary: entry.reason,
                at: entry.requestedAt,
                demo: entry.demo,
              }))}
            />
            <Queue
              title="Inquiries with no approved answer"
              href="/hospital/inquiries"
              empty="All answered"
              items={data.unanswered.map((entry) => ({
                id: entry.id,
                primary: entry.question,
                secondary: entry.handoff ? "Caller offered reception" : "No handoff contact configured",
                at: entry.at,
              }))}
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHead
          title="Recent calls"
          note="From the platform's own call records"
          actions={
            <Link href="/hospital/calls" className="text-[13px] font-medium text-sage hover:underline">
              Call history
            </Link>
          }
        />
        {data.recentCalls.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-ink-muted">
            No calls recorded for this hospital yet. Inbound calls appear here once the line is live.
          </p>
        ) : (
          <Table head={["", "Caller", "When", "Status", "Summary"]}>
            {data.recentCalls.map((call) => (
              <tr key={call.id} className="hover:bg-sunken/40">
                <td className="px-4 py-3">
                  {call.direction === "inbound" ? (
                    <PhoneIncoming className="h-4 w-4 text-sage" aria-label="Inbound" />
                  ) : (
                    <PhoneOutgoing className="h-4 w-4 text-ink-muted" aria-label="Outbound" />
                  )}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/hospital/calls?id=${call.id}`} className="font-medium text-ink hover:text-sage">
                    {call.name ?? "Unknown caller"}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-soft">{formatWhen(call.at, profile.timezone)}</td>
                <td className="px-4 py-3">
                  <Status label={call.status} tone={call.status === "connected" ? "good" : call.status === "failed" ? "bad" : "neutral"} />
                </td>
                <td className="max-w-[26rem] px-4 py-3 text-ink-muted">
                  {call.summary ? <span className="line-clamp-2">{call.summary}</span> : <span className="text-xs">No summary reported</span>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/** One queue of work, with the oldest few in it. */
function Queue({
  title,
  href,
  empty,
  items,
}: {
  title: string;
  href: string;
  empty: string;
  items: Array<{ id: string; primary: string; secondary: string; at: string; demo?: boolean }>;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="flex items-center justify-between gap-3">
        <Link href={href} className="text-[13px] font-semibold text-ink hover:text-sage">
          {title}
        </Link>
        <span className="tabular text-[13px] text-ink-muted">{items.length}</span>
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {items.slice(0, 4).map((item) => (
            <li key={item.id} className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] text-ink">{item.primary}</span>
                {item.demo && <DemoTag />}
              </span>
              <span className="mt-0.5 flex items-baseline justify-between gap-3">
                <span className="truncate text-[11.5px] text-ink-muted">{item.secondary}</span>
                <span className="shrink-0 text-[11px] text-ink-muted">{relative(item.at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
