"use client";

// ============================================================
// Patients — who the hospital has a record of
// ============================================================
//
// A patient here is someone this hospital has spoken to or booked in. Numbers
// are masked in the list: a directory is read across a desk. What is
// remembered about them is administrative — what was agreed, preferred or
// asked for — and nothing on this page is a clinical record.
// ============================================================

import { useState } from "react";
import { Search } from "lucide-react";

import { api, formatWhen, useApi } from "@/lib/hospital/panel-api";
import {
  Button,
  Card,
  DemoTag,
  Dialog,
  Empty,
  Loading,
  PageHeader,
  Problem,
  Status,
  Table,
  appointmentTone,
  inputClass,
} from "@/components/hospital/ui";

interface PatientRow {
  id: string;
  name: string;
  phoneMasked: string;
  appointments: number;
  upcoming: number;
  missed: number;
  calls: number;
  optedOut: boolean;
  demo: boolean;
}

interface PatientDetail {
  patient: { id: string; name: string; phone: string; phoneMasked: string };
  appointments: Array<{ id: string; scheduledAt: string; status: string; doctorName: string | null; specialty: string; demo: boolean }>;
  calls: Array<{ id: string; at: string | null; direction: string; status: string; duration: number | null; summary: string | null }>;
  memory: Array<{ id: string; category: string; key: string; value: string; confidence: number }>;
  consent: { optedOut: boolean; reason: string | null; since: string | null };
}

export default function PatientsPage() {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<{ patients: PatientRow[]; timezone: string }>("hospital/patients");
  const { data: detail, reload: reloadDetail } = useApi<PatientDetail>(
    chosen ? `hospital/patients?id=${encodeURIComponent(chosen)}` : null
  );

  const timezone = data?.timezone ?? "Asia/Kolkata";
  const rows = (data?.patients ?? []).filter((patient) =>
    search ? patient.name.toLowerCase().includes(search.toLowerCase()) : true
  );

  const setConsent = async (optedOut: boolean) => {
    if (!chosen) return;
    await api("hospital/patients", { method: "PUT", body: JSON.stringify({ id: chosen, optedOut }) });
    await Promise.all([reloadDetail(), reload()]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinic"
        title="Patients"
        description="People this hospital has booked in or spoken to. Records belong to Wellness Hospital alone — a number known elsewhere on Tringlo is a different person here."
      />

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input className={`${inputClass} pl-9`} placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading && <Loading label="Loading patients" />}
      {error && <Problem message={error} onRetry={reload} />}

      {!loading && !error && rows.length === 0 && (
        <Empty
          title="No patients yet"
          description="A patient record is created the first time someone is booked in or calls the hospital."
        />
      )}

      {rows.length > 0 && (
        <Card>
          <Table head={["Patient", "Number", "Appointments", "Upcoming", "Calls", "Automated calls"]}>
            {rows.map((patient) => (
              <tr key={patient.id} className="cursor-pointer hover:bg-sunken/40" onClick={() => setChosen(patient.id)}>
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{patient.name}</span>
                  {patient.demo && <span className="ml-2 align-middle"><DemoTag /></span>}
                </td>
                <td className="px-4 py-3 text-ink-soft tabular">{patient.phoneMasked}</td>
                <td className="px-4 py-3 text-ink-soft tabular">
                  {patient.appointments}
                  {patient.missed > 0 && <span className="ml-2 text-[11px] text-clay">{patient.missed} missed</span>}
                </td>
                <td className="px-4 py-3 text-ink-soft tabular">{patient.upcoming}</td>
                <td className="px-4 py-3 text-ink-soft tabular">{patient.calls}</td>
                <td className="px-4 py-3">
                  <Status label={patient.optedOut ? "Opted out" : "Allowed"} tone={patient.optedOut ? "bad" : "good"} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Dialog open={Boolean(chosen)} title={detail?.patient.name ?? "Patient"} onClose={() => setChosen(null)}>
        {!detail ? (
          <Loading label="Loading the record" />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2.5">
              <div className="text-[13px]">
                <span className="text-ink-muted">Number </span>
                <span className="text-ink tabular">{detail.patient.phone}</span>
              </div>
              <Button onClick={() => setConsent(!detail.consent.optedOut)}>
                {detail.consent.optedOut ? "Allow automated calls" : "Record an opt-out"}
              </Button>
            </div>

            {detail.consent.optedOut && (
              <p className="rounded-lg bg-alert-soft px-3 py-2 text-[13px] text-ink">
                This patient has asked not to receive automated calls. No confirmation call will be placed to
                them, and no callback is scheduled for them.
              </p>
            )}

            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Appointments</h3>
              {detail.appointments.length === 0 ? (
                <p className="text-[13px] text-ink-muted">None on record.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.appointments.map((appointment) => (
                    <li key={appointment.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]">
                      <span className="min-w-0">
                        <span className="block text-ink">{formatWhen(appointment.scheduledAt, timezone)}</span>
                        <span className="block text-[11px] text-ink-muted">
                          {appointment.doctorName ?? "—"} · {appointment.specialty}
                        </span>
                      </span>
                      <Status label={appointment.status} tone={appointmentTone(appointment.status)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold text-ink">Calls</h3>
              {detail.calls.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No calls on record.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.calls.slice(0, 6).map((call) => (
                    <li key={call.id} className="rounded-lg border px-3 py-2 text-[13px]">
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-ink">{formatWhen(call.at, timezone)}</span>
                        <span className="text-[11px] text-ink-muted">{call.direction}</span>
                      </span>
                      {call.summary && <span className="mt-1 block text-[12.5px] text-ink-muted">{call.summary}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1 text-[13px] font-semibold text-ink">What the agent remembers</h3>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                Administrative notes only — what was agreed or preferred. Not a clinical record, and not used as one.
              </p>
              {detail.memory.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Nothing remembered yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {detail.memory.map((item) => (
                    <li key={item.id} className="rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink-soft">
                      <span className="text-[11px] uppercase tracking-wide text-ink-muted">{item.category}</span>
                      <span className="mt-0.5 block">{item.value}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Dialog>
    </div>
  );
}
