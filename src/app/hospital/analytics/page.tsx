"use client";

// ============================================================
// Analytics — counted, not estimated
// ============================================================
//
// Everything here is a count of rows in this hospital's own records over a
// window. There is no benchmark, no rate of improvement and nothing about
// patient outcomes: call volume does not measure care, and saying it does
// would be an invention.
// ============================================================

import { useState } from "react";

import { useApi } from "@/lib/hospital/panel-api";
import { Card, CardHead, Empty, Loading, PageHeader, Problem, Stat, Table } from "@/components/hospital/ui";

interface Analytics {
  days: number;
  totals: Record<string, number>;
  /** The intake side: questionnaires, histories, reports, follow-ups. */
  intake: Record<string, number>;
  series: Array<{ date: string; inbound: number; outbound: number; appointments: number }>;
  utilisation: Array<{ doctorId: string; name: string; specialty: string; booked: number }>;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useApi<Analytics>(`hospital/analytics?days=${days}`);

  const totals = data?.totals ?? {};
  const intake = data?.intake ?? {};
  const peak = Math.max(1, ...(data?.series ?? []).map((day) => day.inbound + day.outbound + day.appointments));
  const empty = data && Object.values(totals).every((value) => value === 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Hospital"
        title="Analytics"
        description="Counted from this hospital's records. Nothing here is estimated or compared against a benchmark."
        actions={
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            {[7, 30, 90].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`h-8 rounded-md px-3 text-xs font-medium ${days === option ? "bg-sage text-white" : "text-ink-muted"}`}
              >
                {option} days
              </button>
            ))}
          </div>
        }
      />

      {loading && <Loading />}
      {error && <Problem message={error} onRetry={reload} />}

      {empty && (
        <Empty
          title="Nothing to count yet"
          description="Once appointments are booked and calls are made, this page fills in. Demonstration data can be loaded from Settings."
        />
      )}

      {data && !empty && (
        <>
          {totals.fromDemoData > 0 && (
            <p className="rounded-xl border bg-surface px-4 py-3 text-[13px] text-ink-muted">
              {totals.fromDemoData} of the appointments counted below are demonstration records.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Inbound calls" value={totals.inboundCalls} tone="sage" />
            <Stat label="Outbound calls" value={totals.outboundCalls} />
            <Stat label="Appointments created" value={totals.appointmentsCreated} />
            <Stat label="Calls needing a person" value={totals.handoffs} tone={totals.handoffs ? "clay" : "plain"} />
          </div>

          <Card>
            <CardHead title="By day" note="Calls and appointments created" />
            <div className="overflow-x-auto p-5">
              <div className="flex min-w-[560px] items-end gap-1" style={{ height: 160 }}>
                {data.series.map((day) => {
                  const total = day.inbound + day.outbound + day.appointments;
                  return (
                    <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date}: ${total}`}>
                      <div className="flex w-full flex-col-reverse items-stretch gap-[1px]" style={{ height: 130 }}>
                        <span
                          className="w-full rounded-sm bg-sage"
                          style={{ height: `${(day.inbound / peak) * 100}%` }}
                          aria-hidden="true"
                        />
                        <span
                          className="w-full rounded-sm bg-sage/45"
                          style={{ height: `${(day.outbound / peak) * 100}%` }}
                          aria-hidden="true"
                        />
                        <span
                          className="w-full rounded-sm bg-clay/50"
                          style={{ height: `${(day.appointments / peak) * 100}%` }}
                          aria-hidden="true"
                        />
                      </div>
                      <span className="text-[9px] text-ink-muted">{day.date.slice(8)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-[11.5px] text-ink-muted">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sage" /> Inbound</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-sage/45" /> Outbound</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-clay/50" /> Appointments created</span>
              </div>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHead title="Appointments" note={`Created in the last ${data.days} days`} />
              <ul className="divide-y text-sm">
                {[
                  ["Confirmed", totals.confirmed],
                  ["Rescheduled", totals.rescheduled],
                  ["Completed", totals.completed],
                  ["Cancelled", totals.cancelled],
                  ["Missed", totals.missed],
                ].map(([label, value]) => (
                  <li key={String(label)} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-ink-soft">{label}</span>
                    <span className="text-ink tabular">{value}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHead title="Confirmation calls" note="What became of them" />
              <ul className="divide-y text-sm">
                {[
                  ["Placed", totals.remindersSent],
                  ["Failed", totals.remindersFailed],
                  ["Skipped, with a reason", totals.remindersSkipped],
                  ["Answered by the patient", intake.confirmationsAnswered],
                  ["Attendance confirmed", intake.confirmationsConfirmedByPatient],
                ].map(([label, value]) => (
                  <li key={String(label)} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-ink-soft">{label}</span>
                    <span className="text-ink tabular">{value}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHead title="Preliminary histories" note="Collected by the agent, reviewed by staff" />
              <ul className="divide-y text-sm">
                {[
                  ["Questionnaires started", intake.questionnairesStarted],
                  ["Completed", intake.questionnairesCompleted],
                  ["Stopped and escalated", intake.questionnairesEscalated],
                  ["Consent declined", intake.consentDeclined],
                  ["Histories on file (one per patient)", intake.historiesOnFile],
                  ["Reports ready for review", intake.reportsReady],
                  ["Reports submitted", intake.reportsSubmitted],
                  ["Reports that failed to submit", intake.reportsFailed],
                  ["Reports reviewed", intake.reportsReviewed],
                ].map(([label, value]) => (
                  <li key={String(label)} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-ink-soft">{label}</span>
                    <span className="text-ink tabular">{value}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHead title="Reception" note="Cancellations, follow-ups and inquiries" />
              <ul className="divide-y text-sm">
                {[
                  ["Cancellations requested", intake.cancellationsRequested],
                  ["Cancellations confirmed by the hospital", intake.cancellationsConfirmed],
                  ["Cancellations still unresolved", intake.cancellationsUnresolved],
                  ["Follow-ups requested", intake.followUpsRequested],
                  ["Follow-ups completed", intake.followUpsCompleted],
                  ["Inquiries with no approved answer", intake.inquiriesUnanswered],
                ].map(([label, value]) => (
                  <li key={String(label)} className="flex items-center justify-between px-5 py-2.5">
                    <span className="text-ink-soft">{label}</span>
                    <span className="text-ink tabular">{value}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card>
            <CardHead title="Doctors" note="From the hospital's directory. Appointments still ahead of them." />
            {data.utilisation.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-muted">No doctors in the directory.</p>
            ) : (
              <Table head={["Doctor", "Specialty", "Booked ahead"]}>
                {data.utilisation.slice(0, 12).map((doctor) => (
                  <tr key={doctor.doctorId}>
                    <td className="px-4 py-2.5 font-medium text-ink">{doctor.name}</td>
                    <td className="px-4 py-2.5 text-ink-soft">{doctor.specialty}</td>
                    <td className="px-4 py-2.5 text-ink-soft tabular">{doctor.booked}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
