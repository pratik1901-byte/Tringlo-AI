"use client";

// ============================================================
// Demo Doctor List — a demonstration-only directory
// ============================================================
//
// Fictional doctors for showing the booking flow. They live in the hospital's
// own directory, so editing a schedule here immediately changes the slots Maya
// offers on a call. Every record is marked a demonstration and kept apart from
// real doctors; nothing here can touch a real one.
// ============================================================

import { useState } from "react";

import { api, useApi } from "@/lib/hospital/panel-api";
import { Button, Card, DemoTag, Dialog, Empty, Field, Loading, PageHeader, Problem, Status, Table } from "@/components/hospital/ui";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type Weekday = (typeof WEEKDAYS)[number];

interface DemoDoctor {
  id: string;
  name: string;
  specialty: string;
  department: string | null;
  days: Weekday[];
  hours: { start: string; end: string };
  slotMinutes: number;
  status: "active" | "archived";
  blockedDates: Array<{ date: string; note?: string | null }>;
  week: Array<{ date: string; available: number; booked: number; blocked: number }>;
}

export default function DemoDoctorsPage() {
  const { data, error, loading, reload } = useApi<{ doctors: DemoDoctor[] }>("hospital/demo-doctors");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<DemoDoctor | null>(null);
  const [blockFor, setBlockFor] = useState<DemoDoctor | null>(null);

  const doctors = data?.doctors ?? [];

  const act = async (method: string, bodyOrQuery: Record<string, unknown> | string) => {
    setProblem(null);
    setBusy(true);
    try {
      if (method === "DELETE") await api(`hospital/demo-doctors?id=${encodeURIComponent(bodyOrQuery as string)}`, { method });
      else await api("hospital/demo-doctors", { method, body: JSON.stringify(bodyOrQuery) });
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Clinic"
        title="Demo Doctor List"
        description="Fictional doctors for demonstrations. Edits here change the availability Maya offers on a call. Demonstration data only — kept separate from real doctors."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => act("POST", { action: "seed" })}>
          Seed demo doctors
        </Button>
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => act("POST", { action: "create", name: "Dr. Demo New", specialty: "General Medicine", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], start: "09:00", end: "17:00", slotMinutes: 30 })}
        >
          Add a demo doctor
        </Button>
      </div>

      {loading && <Loading label="Loading demo doctors" />}
      {error && <Problem message={error} onRetry={reload} />}
      {problem && <Problem message={problem} />}

      {!loading && doctors.length === 0 && (
        <Empty title="No demo doctors yet" description="Seed a few to demonstrate the booking flow. They appear to Maya immediately." />
      )}

      {doctors.length > 0 && (
        <Card>
          <Table head={["Doctor", "Days & hours", "Slot", "This week (free / booked / blocked)", "Status", ""]}>
            {doctors.map((doc) => {
              const free = doc.week.reduce((n, d) => n + d.available, 0);
              const booked = doc.week.reduce((n, d) => n + d.booked, 0);
              const blocked = doc.week.reduce((n, d) => n + d.blocked, 0);
              return (
                <tr key={doc.id} className="hover:bg-sunken/40">
                  <td className="px-4 py-3">
                    <span className="font-medium text-ink">{doc.name}</span>
                    <span className="ml-2 align-middle"><DemoTag /></span>
                    <span className="block text-[11px] text-ink-muted">{doc.specialty}{doc.department ? ` · ${doc.department}` : ""}</span>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-ink-soft">
                    {doc.days.map((d) => d.slice(0, 3)).join(", ")}
                    <span className="block text-ink-muted">{doc.hours.start}–{doc.hours.end}</span>
                    {doc.blockedDates.length > 0 && <span className="block text-[11px] text-amber-700">Blocked: {doc.blockedDates.map((b) => b.date).join(", ")}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{doc.slotMinutes} min</td>
                  <td className="px-4 py-3 text-[12px]">
                    <span className="text-sage-ink">{free}</span> / <span className="text-ink-soft">{booked}</span> / <span className="text-ink-muted">{blocked}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Status label={doc.status === "active" ? "enabled" : "disabled"} tone={doc.status === "active" ? "good" : "neutral"} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="quiet" onClick={() => setEditing(doc)}>Edit</Button>
                      <Button variant="quiet" onClick={() => setBlockFor(doc)}>Block date</Button>
                      <Button variant="quiet" onClick={() => act("PUT", { id: doc.id, action: "status", status: doc.status === "active" ? "archived" : "active" })}>
                        {doc.status === "active" ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="quiet" onClick={() => act("DELETE", doc.id)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {editing && <EditDialog doctor={editing} busy={busy} onClose={() => setEditing(null)} onSave={(changes) => { act("PUT", { id: editing.id, ...changes }); setEditing(null); }} />}
      {blockFor && <BlockDialog doctor={blockFor} busy={busy} onClose={() => setBlockFor(null)} onBlock={(date) => { act("PUT", { id: blockFor.id, action: "block", date }); setBlockFor(null); }} onUnblock={(date) => { act("PUT", { id: blockFor.id, action: "unblock", date }); }} />}
    </div>
  );
}

function EditDialog({ doctor, busy, onClose, onSave }: { doctor: DemoDoctor; busy: boolean; onClose: () => void; onSave: (changes: Record<string, unknown>) => void }) {
  const [days, setDays] = useState<Weekday[]>(doctor.days);
  const [start, setStart] = useState(doctor.hours.start);
  const [end, setEnd] = useState(doctor.hours.end);
  const [slotMinutes, setSlot] = useState(doctor.slotMinutes);
  const [specialty, setSpecialty] = useState(doctor.specialty);

  const toggle = (d: Weekday) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  return (
    <Dialog open title={`Edit ${doctor.name}`} onClose={onClose} footer={<><Button variant="quiet" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={() => onSave({ days, start, end, slotMinutes, specialty })}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Specialty"><input className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:border-sage" value={specialty} onChange={(e) => setSpecialty(e.target.value)} /></Field>
        <Field label="Consulting days">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <button key={d} type="button" onClick={() => toggle(d)} className={`h-8 rounded-lg px-2.5 text-xs font-medium ${days.includes(d) ? "bg-sage text-white" : "border text-ink-muted"}`}>{d.slice(0, 3)}</button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start"><input className="w-full rounded-lg border px-3 py-2 text-sm" value={start} onChange={(e) => setStart(e.target.value)} placeholder="09:00" /></Field>
          <Field label="End"><input className="w-full rounded-lg border px-3 py-2 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="17:00" /></Field>
          <Field label="Slot (min)"><input type="number" className="w-full rounded-lg border px-3 py-2 text-sm" value={slotMinutes} onChange={(e) => setSlot(Number(e.target.value))} /></Field>
        </div>
      </div>
    </Dialog>
  );
}

function BlockDialog({ doctor, busy, onClose, onBlock, onUnblock }: { doctor: DemoDoctor; busy: boolean; onClose: () => void; onBlock: (date: string) => void; onUnblock: (date: string) => void }) {
  const [date, setDate] = useState("");
  return (
    <Dialog open title={`Block a date for ${doctor.name}`} onClose={onClose} footer={<><Button variant="quiet" onClick={onClose}>Close</Button><Button variant="primary" disabled={busy || !date} onClick={() => onBlock(date)}>Block</Button></>}>
      <div className="space-y-4">
        <Field label="Date to block" hint="No slots are offered on a blocked day."><input type="date" className="w-full rounded-lg border px-3 py-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {doctor.blockedDates.length > 0 && (
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-ink-soft">Currently blocked</p>
            {doctor.blockedDates.map((b) => (
              <div key={b.date} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-soft">{b.date}</span>
                <button type="button" className="text-sage-ink hover:underline" onClick={() => onUnblock(b.date)}>Unblock</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
