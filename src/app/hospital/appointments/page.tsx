"use client";

// ============================================================
// Appointments — booking, moving and closing
// ============================================================
//
// Booking offers only slots that are genuinely free, and the server rechecks
// the slot as it writes: between picking 11:00 and confirming it, the desk may
// have taken it. Moving an appointment re-times its reminder; cancelling stops
// it. Nothing is deleted quietly — the trail stays either way.
// ============================================================

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, List, Plus, Search } from "lucide-react";

import { api, formatTime, formatWhen, todayIn, useApi } from "@/lib/hospital/panel-api";
import {
  Button,
  Card,
  CardHead,
  DemoTag,
  Dialog,
  Empty,
  Field,
  Loading,
  PageHeader,
  Problem,
  Status,
  Table,
  appointmentTone,
  inputClass,
  reminderTone,
} from "@/components/hospital/ui";

interface Appointment {
  id: string;
  patientName: string;
  patientPhone: string;
  doctorId: string;
  doctorName: string | null;
  specialty: string;
  scheduledAt: string;
  status: string;
  source: string;
  reason: string | null;
  statusNote: string | null;
  confirmationCall: { status: string; outcome: { response: string } | null } | null;
  cancellationPending: boolean;
  demo: boolean;
}

/** A doctor as the hospital's own system lists them. Read-only here. */
interface Provider {
  id: string;
  name: string;
  specialty: string;
  accepting: boolean;
}

interface DirectoryStatus {
  source: "demo" | "live";
  count: number;
  fetchedAt: string | null;
  stale: boolean;
  problem: string | null;
}

const STATUSES = ["requested", "confirmed", "rescheduled", "completed", "cancelled", "missed"];

export default function AppointmentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Appointments />
    </Suspense>
  );
}

function Appointments() {
  const params = useSearchParams();
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [view, setView] = useState<"list" | "day">("list");
  const [booking, setBooking] = useState(false);
  const [chosen, setChosen] = useState<Appointment | null>(null);

  const query = useMemo(() => {
    const search_ = new URLSearchParams();
    if (status) search_.set("status", status);
    if (date) search_.set("date", date);
    return `hospital/appointments${search_.toString() ? `?${search_}` : ""}`;
  }, [status, date]);

  const { data, error, loading, reload } = useApi<{ appointments: Appointment[]; timezone: string }>(query);
  // Doctors come from the hospital's system, not from Tringlo.
  const { data: directory } = useApi<{ providers: Provider[]; directory: DirectoryStatus }>("hospital/providers");
  const timezone = data?.timezone ?? "Asia/Kolkata";

  const rows = (data?.appointments ?? []).filter((appointment) =>
    search
      ? appointment.patientName.toLowerCase().includes(search.toLowerCase()) ||
        (appointment.doctorName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        appointment.patientPhone.includes(search) ||
        appointment.id.includes(search)
      : true
  );

  // The day view groups the same rows by their local date.
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const appointment of rows) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(appointment.scheduledAt));
      map.set(day, [...(map.get(day) ?? []), appointment]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows, timezone]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinic"
        title="Appointments"
        description="Everything booked at this hospital, however it was booked — at the desk, or by the agent on a call."
        actions={
          <Button variant="primary" onClick={() => setBooking(true)}>
            <Plus className="h-4 w-4" />
            Book appointment
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            className={`${inputClass} pl-9`}
            placeholder="Search patient, doctor or reference"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className={`${inputClass} w-auto`} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <input type="date" className={`${inputClass} w-auto`} value={date} onChange={(event) => setDate(event.target.value)} />
        {date && (
          <Button variant="quiet" onClick={() => setDate("")}>
            Clear date
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${view === "list" ? "bg-sage text-white" : "text-ink-muted"}`}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            type="button"
            onClick={() => setView("day")}
            aria-pressed={view === "day"}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${view === "day" ? "bg-sage text-white" : "text-ink-muted"}`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> By day
          </button>
        </div>
      </div>

      {loading && <Loading label="Loading appointments" />}
      {error && <Problem message={error} onRetry={reload} />}

      {!loading && !error && rows.length === 0 && (
        <Empty
          title="Nothing matches"
          description="No appointment matches these filters. Clear them, or book one."
          action={
            <Button variant="primary" onClick={() => setBooking(true)}>
              <Plus className="h-4 w-4" />
              Book appointment
            </Button>
          }
        />
      )}

      {rows.length > 0 && view === "list" && (
        <Card>
          <Table head={["Patient", "Doctor", "When", "Status", "Reminder", "Source"]}>
            {rows.map((appointment) => (
              <tr key={appointment.id} className="cursor-pointer hover:bg-sunken/40" onClick={() => setChosen(appointment)}>
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{appointment.patientName}</span>
                  {appointment.demo && <span className="ml-2 align-middle"><DemoTag /></span>}
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {appointment.doctorName ?? "—"}
                  <span className="block text-[11px] text-ink-muted">{appointment.specialty}</span>
                </td>
                <td className="px-4 py-3 text-ink-soft">{formatWhen(appointment.scheduledAt, timezone)}</td>
                <td className="px-4 py-3">
                  <Status label={appointment.status} tone={appointmentTone(appointment.status)} />
                </td>
                <td className="px-4 py-3">
                  {appointment.cancellationPending ? (
                    <Status label="Cancellation pending" tone="warn" />
                  ) : appointment.confirmationCall ? (
                    <Status
                      label={appointment.confirmationCall.outcome?.response.replace(/_/g, " ") ?? appointment.confirmationCall.status}
                      tone={reminderTone(appointment.confirmationCall.status)}
                    />
                  ) : (
                    <span className="text-xs text-ink-muted">none</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-ink-muted">{appointment.source}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {rows.length > 0 && view === "day" && (
        <div className="space-y-4">
          {byDay.map(([day, items]) => (
            <Card key={day}>
              <CardHead
                title={new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
                note={`${items.length} appointment${items.length === 1 ? "" : "s"}`}
              />
              <ul className="divide-y">
                {items
                  .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
                  .map((appointment) => (
                    <li key={appointment.id}>
                      <button
                        type="button"
                        onClick={() => setChosen(appointment)}
                        className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-sunken/40"
                      >
                        <span className="w-14 shrink-0 font-medium text-ink tabular">{formatTime(appointment.scheduledAt, timezone)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-ink">{appointment.patientName}</span>
                          <span className="block truncate text-[12.5px] text-ink-muted">
                            {appointment.doctorName ?? "—"} · {appointment.specialty}
                          </span>
                        </span>
                        <Status label={appointment.status} tone={appointmentTone(appointment.status)} />
                      </button>
                    </li>
                  ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <BookDialog
        open={booking}
        doctors={(directory?.providers ?? []).filter((provider) => provider.accepting)}
        timezone={timezone}
        onClose={() => setBooking(false)}
        onBooked={async () => {
          setBooking(false);
          await reload();
        }}
      />

      {/*
        Keyed on the appointment so a different one gets a fresh dialog with
        its own initial state, rather than an effect reaching in to reset the
        last one's.
      */}
      <DetailDialog
        key={chosen?.id ?? "none"}
        appointment={chosen}
        doctors={(directory?.providers ?? []).filter((provider) => provider.accepting)}
        timezone={timezone}
        onClose={() => setChosen(null)}
        onChanged={async () => {
          setChosen(null);
          await reload();
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------

function BookDialog({
  open,
  doctors,
  timezone,
  onClose,
  onBooked,
}: {
  open: boolean;
  doctors: Provider[];
  timezone: string;
  onClose: () => void;
  onBooked: () => void;
}) {
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(todayIn(timezone));
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [slots, setSlots] = useState<Array<{ time: string; available: boolean; reason?: string }>>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Free slots are read for the doctor and date actually chosen, each time.
  // Nothing is cleared here: `offered` below ignores whatever was last read
  // when there is no doctor or date, which keeps this effect to one job.
  useEffect(() => {
    if (!open || !doctorId || !date) return;
    let cancelled = false;
    void api<{ slots: Array<{ time: string; available: boolean; reason?: string }> }>(
      `hospital/appointments?slots=1&doctorId=${encodeURIComponent(doctorId)}&date=${date}`
    )
      .then((answer) => {
        if (!cancelled) setSlots(answer.slots);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, doctorId, date]);

  const book = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api("hospital/appointments", {
        method: "POST",
        body: JSON.stringify({ doctorId, date, time, patientName: name, patientPhone: phone, reason: reason || null }),
      });
      setDoctorId("");
      setTime("");
      setName("");
      setPhone("");
      setReason("");
      onBooked();
    } catch (failure) {
      // The server rechecks the slot as it writes, so this is where a slot
      // taken a moment ago is reported.
      setProblem(failure instanceof Error ? failure.message : "That booking did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const free = slots.filter((slot) => slot.available);

  return (
    <Dialog
      open={open}
      title="Book an appointment"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={book} disabled={busy || !doctorId || !time || !name.trim() || !phone.trim()}>
            {busy ? "Booking…" : "Book"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && <Problem message={problem} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Doctor">
            <select className={inputClass} value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setTime(""); }}>
              <option value="">Choose a doctor</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name} — {doctor.specialty}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" className={inputClass} value={date} onChange={(event) => { setDate(event.target.value); setTime(""); }} />
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-soft">Time</p>
          {!doctorId ? (
            <p className="text-[13px] text-ink-muted">Choose a doctor to see when they are free.</p>
          ) : free.length === 0 ? (
            <p className="text-[13px] text-ink-muted">
              No free slots that day. {slots.length > 0 ? "Every slot is taken, in a break, or past." : "This doctor does not consult on that date."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {free.map((slot) => (
                <button
                  key={slot.time}
                  type="button"
                  onClick={() => setTime(slot.time)}
                  className={`h-8 rounded-lg px-2.5 text-xs font-medium tabular transition-colors ${
                    time === slot.time ? "bg-sage text-white" : "border text-ink-soft hover:bg-sunken"
                  }`}
                >
                  {slot.time}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Patient name">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Phone" hint="Used to recognise them when they call.">
            <input className={inputClass} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91…" />
          </Field>
        </div>
        <Field label="Reason" hint="Optional. Kept for the desk; not read out on a reminder call.">
          <input className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------

function DetailDialog({
  appointment,
  doctors,
  timezone,
  onClose,
  onChanged,
}: {
  appointment: Appointment | null;
  doctors: Provider[];
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [moving, setMoving] = useState(false);
  // Initialised from the appointment this dialog was opened for. The component
  // is keyed on its id, so a different appointment means a new component with
  // its own initial values.
  const [date, setDate] = useState(() =>
    appointment ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(appointment.scheduledAt)) : ""
  );
  const [time, setTime] = useState("");
  const [doctorId, setDoctorId] = useState(() => appointment?.doctorId ?? "");
  const [slots, setSlots] = useState<Array<{ time: string; available: boolean }>>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!moving || !doctorId || !date) return;
    let cancelled = false;
    void api<{ slots: Array<{ time: string; available: boolean }> }>(
      `hospital/appointments?slots=1&doctorId=${encodeURIComponent(doctorId)}&date=${date}`
    )
      .then((answer) => {
        if (!cancelled) setSlots(answer.slots.filter((slot) => slot.available));
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [moving, doctorId, date]);

  if (!appointment) return null;

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await api("hospital/appointments", { method: "PUT", body: JSON.stringify({ id: appointment.id, ...body }) });
      onChanged();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That change did not go through.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cancels through the hospital's own system.
   *
   * The appointment comes off the book only if that confirms. Anything else
   * leaves it standing and says so, rather than showing a cancellation the
   * hospital never accepted.
   */
  const cancel = async () => {
    if (!confirm("Ask the hospital's system to cancel this appointment?")) return;
    setBusy(true);
    setProblem(null);
    setCancelNote(null);
    try {
      const result = await api<{ cancelled: boolean; message: string; needsStaff: boolean }>(
        "hospital/appointments",
        {
          method: "PUT",
          body: JSON.stringify({ id: appointment.id, status: "cancelled", note: "cancelled by staff" }),
        }
      );
      setCancelNote(result.message);
      if (!result.cancelled) setProblem(result.message);
      onChanged();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That change did not go through.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this appointment? Its history stays on record, and any pending confirmation call is cancelled.")) return;
    setBusy(true);
    try {
      await api(`hospital/appointments?id=${encodeURIComponent(appointment.id)}`, { method: "DELETE" });
      onChanged();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      title={appointment.patientName}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" onClick={remove} disabled={busy}>
            Delete
          </Button>
          <span className="flex-1" />
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-4">
        {problem && <Problem message={problem} />}
        {cancelNote && !problem && (
          <p className="rounded-lg border border-sage/30 bg-sage-soft px-3 py-2 text-[13px] text-sage-ink">{cancelNote}</p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          {[
            ["Doctor", appointment.doctorName ?? "—"],
            ["Specialty", appointment.specialty],
            ["When", formatWhen(appointment.scheduledAt, timezone)],
            ["Status", appointment.status],
            ["Booked by", appointment.source],
            ["Confirmation call", appointment.confirmationCall?.status ?? "none"],
            ["Patient said", appointment.confirmationCall?.outcome?.response.replace(/_/g, " ") ?? "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</dt>
              <dd className="mt-0.5 text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        {appointment.reason && (
          <p className="rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink-soft">{appointment.reason}</p>
        )}
        {appointment.demo && (
          <p className="rounded-lg bg-sunken px-3 py-2 text-[13px] text-ink-muted">
            Demonstration appointment. Its confirmation call is recorded but never dialled.
          </p>
        )}

        {!moving ? (
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => setMoving(true)} disabled={busy}>
              Reschedule
            </Button>
            {appointment.status === "requested" && (
              <Button variant="primary" onClick={() => act({ status: "confirmed" })} disabled={busy}>
                Confirm
              </Button>
            )}
            <Button onClick={() => act({ status: "completed" })} disabled={busy}>
              Mark completed
            </Button>
            <Button onClick={() => act({ status: "missed" })} disabled={busy}>
              Mark missed
            </Button>
            <Button variant="danger" onClick={cancel} disabled={busy}>
              Cancel appointment
            </Button>
          </div>
        ) : (
          <div className="space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Doctor">
                <select className={inputClass} value={doctorId} onChange={(event) => { setDoctorId(event.target.value); setTime(""); }}>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" className={inputClass} value={date} onChange={(event) => { setDate(event.target.value); setTime(""); }} />
              </Field>
            </div>
            {slots.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No free slots on that date.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    onClick={() => setTime(slot.time)}
                    className={`h-8 rounded-lg px-2.5 text-xs font-medium tabular ${time === slot.time ? "bg-sage text-white" : "border text-ink-soft hover:bg-sunken"}`}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={() => setMoving(false)}>Back</Button>
              <Button variant="primary" onClick={() => act({ doctorId, date, time })} disabled={busy || !time}>
                Move appointment
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-muted">
              Moving it cancels the confirmation call for the old time and schedules a new one, timed from the new
              appointment.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
