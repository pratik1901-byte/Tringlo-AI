"use client";

// ============================================================
// Inquiries & Reception
// ============================================================
//
// The approved answers the agent is allowed to give, and the questions it had
// no approved answer for.
//
// That second list is the useful half. Every row in it is a question a real
// caller asked and the agent declined to guess at — so it is both a record of
// what the agent did not know, and the list of FAQs worth writing next. A row
// is cleared by writing the answer, which creates the FAQ in one step.
// ============================================================

import { useMemo, useState } from "react";
import { MessageSquareWarning, ShieldQuestion } from "lucide-react";

import { api, formatWhen, relative, useApi } from "@/lib/hospital/panel-api";
import {
  Button,
  Card,
  CardHead,
  DemoTag,
  Dialog,
  Empty,
  Field,
  Loading,
  NotConfigured,
  PageHeader,
  Problem,
  Stat,
  Status,
  Table,
  inputClass,
} from "@/components/hospital/ui";

interface Faq {
  id: string;
  question: string;
  answer: string;
  topic: string | null;
  active: boolean;
  usedCount?: number;
  lastUsedAt?: string | null;
  demo: boolean;
  updatedAt: string;
}

interface Unanswered {
  id: string;
  at: string;
  question: string;
  callId: string | null;
  handoff: boolean;
  status: "open" | "answered" | "dismissed";
  resolvedFaqId: string | null;
}

interface Payload {
  faqs: Faq[];
  categories: string[];
  unanswered: Unanswered[];
  openUnanswered: number;
  staffContact: string | null;
  counts: { total: number; active: number };
}

export default function InquiriesPage() {
  const { data, error, loading, reload } = useApi<Payload>("hospital/inquiries");
  const [tab, setTab] = useState<"faqs" | "unanswered">("faqs");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState<Partial<Faq> | null>(null);
  const [resolving, setResolving] = useState<Unanswered | null>(null);
  const [resolution, setResolution] = useState({ answer: "", topic: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const faqs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.faqs ?? []).filter((faq) => {
      if (category && (faq.topic ?? "Other") !== category) return false;
      if (term && !`${faq.question} ${faq.answer}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [data?.faqs, search, category]);

  const unanswered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.unanswered ?? []).filter((inquiry) =>
      term ? inquiry.question.toLowerCase().includes(term) : true
    );
  }, [data?.unanswered, search]);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await api("hospital/inquiries", { method: "POST", body: JSON.stringify(body) });
      setNotice(success);
      await reload();
      return true;
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (faq: Faq) => {
    if (!confirm(`Delete "${faq.question}"? The agent will no longer have an approved answer for it.`)) return;
    setBusy(true);
    try {
      await api(`hospital/inquiries?id=${encodeURIComponent(faq.id)}`, { method: "DELETE" });
      setNotice("Deleted.");
      await reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading label="Loading inquiries" />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reception"
        title="Inquiries & Reception"
        description="General service questions and the answers the agent is approved to give. Nothing clinical, and nothing the agent invents."
        actions={
          <Button variant="primary" onClick={() => setEditing({ active: true })}>
            New FAQ
          </Button>
        }
      />

      {error && <Problem message={error} onRetry={reload} />}
      {problem && <Problem message={problem} />}
      {notice && (
        <p className="rounded-xl border border-sage/30 bg-sage-soft px-4 py-3 text-[13px] text-sage-ink">{notice}</p>
      )}

      {!data?.staffContact && (
        <NotConfigured
          what="No handoff contact is configured"
          how="When the agent has no approved answer it can only say the hospital will confirm. Add a reception contact in Settings and it can offer to put the caller through."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Approved answers" value={data?.counts.active ?? 0} note={`${data?.counts.total ?? 0} written in total`} />
        <Stat
          label="Unanswered inquiries"
          value={data?.openUnanswered ?? 0}
          tone={data?.openUnanswered ? "clay" : "plain"}
          note="Questions with no approved answer"
        />
        <Stat
          label="Answered from a FAQ"
          value={(data?.faqs ?? []).reduce((total, faq) => total + (faq.usedCount ?? 0), 0)}
          note="Times the agent used approved text"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={tab === "faqs" ? "primary" : "plain"} onClick={() => setTab("faqs")}>
          Approved answers
        </Button>
        <Button variant={tab === "unanswered" ? "primary" : "plain"} onClick={() => setTab("unanswered")}>
          Unanswered {data?.openUnanswered ? `(${data.openUnanswered})` : ""}
        </Button>
        <input
          className={`${inputClass} ml-auto max-w-[240px]`}
          placeholder="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {tab === "faqs" && (
          <select className={`${inputClass} max-w-[200px]`} value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {(data?.categories ?? []).map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === "faqs" && (
        <Card>
          <CardHead title="Approved answers" note="The agent reads these as written and does not paraphrase them." />
          {faqs.length === 0 ? (
            <Empty
              title="No approved answers yet"
              description="Until a FAQ is written, the agent tells callers that the hospital will confirm. It does not answer from general knowledge."
              action={
                <Button variant="primary" onClick={() => setEditing({ active: true })}>
                  Write the first one
                </Button>
              }
            />
          ) : (
            <Table head={["Question", "Category", "Used", "Updated", "State", ""]}>
              {faqs.map((faq) => (
                <tr key={faq.id}>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="text-ink">{faq.question}</span>
                      {faq.demo && <DemoTag />}
                    </span>
                    <span className="mt-0.5 block max-w-[420px] truncate text-[11.5px] text-ink-muted">{faq.answer}</span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{faq.topic ?? "Other"}</td>
                  <td className="px-4 py-2.5 tabular text-ink-muted">
                    {faq.usedCount ?? 0}
                    {faq.lastUsedAt && (
                      <span className="block text-[11px] text-ink-muted">{relative(faq.lastUsedAt)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">{formatWhen(faq.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    {faq.active ? <Status label="Active" tone="good" /> : <Status label="Disabled" tone="neutral" />}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center justify-end gap-1">
                      <Button variant="quiet" onClick={() => setEditing(faq)}>
                        Edit
                      </Button>
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => act({ action: "toggle", id: faq.id, active: !faq.active }, faq.active ? "Disabled." : "Enabled.")}
                      >
                        {faq.active ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="quiet" disabled={busy} onClick={() => remove(faq)}>
                        Delete
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "unanswered" && (
        <Card>
          <CardHead
            title="Questions with no approved answer"
            note="What callers asked that the agent would not guess at. Answering one writes the FAQ."
          />
          {unanswered.length === 0 ? (
            <Empty
              title="Nothing outstanding"
              description="Every question callers have asked had an approved answer, or has been dealt with."
            />
          ) : (
            <Table head={["Asked", "Question", "Handed over", "State", ""]}>
              {unanswered.map((inquiry) => (
                <tr key={inquiry.id}>
                  <td className="px-4 py-2.5 text-ink-muted">{formatWhen(inquiry.at)}</td>
                  <td className="px-4 py-2.5 text-ink">{inquiry.question}</td>
                  <td className="px-4 py-2.5">
                    {inquiry.handoff ? <Status label="To reception" tone="good" /> : <Status label="No contact set" tone="warn" />}
                  </td>
                  <td className="px-4 py-2.5">
                    <Status
                      label={inquiry.status}
                      tone={inquiry.status === "answered" ? "good" : inquiry.status === "dismissed" ? "neutral" : "waiting"}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {inquiry.status === "open" && (
                      <Button
                        variant="quiet"
                        onClick={() => {
                          setResolving(inquiry);
                          setResolution({ answer: "", topic: "" });
                        }}
                      >
                        Answer
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-muted">
        <ShieldQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        The agent answers a service question from this list or it does not answer it. It never offers an opinion on
        symptoms, treatment or anything clinical, whatever is written here.
      </p>

      {/* ---------------- writing a FAQ ---------------- */}
      <Dialog
        open={Boolean(editing)}
        title={editing?.id ? "Edit approved answer" : "New approved answer"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !editing?.question?.trim() || !editing?.answer?.trim()}
              onClick={async () => {
                const saved = await act(
                  {
                    action: "save",
                    id: editing?.id ?? null,
                    question: editing?.question,
                    answer: editing?.answer,
                    topic: editing?.topic ?? null,
                    active: editing?.active ?? true,
                  },
                  "Saved."
                );
                if (saved) setEditing(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Question" hint="How a caller would put it.">
            <input
              className={inputClass}
              value={editing?.question ?? ""}
              onChange={(event) => setEditing({ ...editing, question: event.target.value })}
            />
          </Field>
          <Field label="Approved answer" hint="The agent says this as written. Keep it to facts the hospital stands behind.">
            <textarea
              className="min-h-[110px] w-full rounded-lg border px-3 py-2 text-sm text-ink outline-none focus-visible:border-sage"
              value={editing?.answer ?? ""}
              onChange={(event) => setEditing({ ...editing, answer: event.target.value })}
            />
          </Field>
          <Field label="Category">
            <select
              className={inputClass}
              value={editing?.topic ?? ""}
              onChange={(event) => setEditing({ ...editing, topic: event.target.value || null })}
            >
              <option value="">Uncategorised</option>
              {(data?.categories ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Dialog>

      {/* ---------------- answering an outstanding inquiry ---------------- */}
      <Dialog
        open={Boolean(resolving)}
        title="Answer this inquiry"
        onClose={() => setResolving(null)}
        footer={
          <>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={async () => {
                const done = await act({ action: "resolve", inquiryId: resolving?.id, dismiss: true }, "Dismissed.");
                if (done) setResolving(null);
              }}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              disabled={busy || !resolution.answer.trim()}
              onClick={async () => {
                const done = await act(
                  {
                    action: "resolve",
                    inquiryId: resolving?.id,
                    answer: resolution.answer,
                    topic: resolution.topic || null,
                  },
                  "Answered, and the FAQ is now available to the agent."
                );
                if (done) setResolving(null);
              }}
            >
              Save as approved answer
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-lg bg-sunken px-3.5 py-3 text-[13px] leading-relaxed text-ink">
            <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
            {resolving?.question}
          </p>
          <Field label="Approved answer" hint="Saved as a FAQ, so the next caller who asks gets it straight away.">
            <textarea
              className="min-h-[110px] w-full rounded-lg border px-3 py-2 text-sm text-ink outline-none focus-visible:border-sage"
              value={resolution.answer}
              onChange={(event) => setResolution({ ...resolution, answer: event.target.value })}
            />
          </Field>
          <Field label="Category">
            <select
              className={inputClass}
              value={resolution.topic}
              onChange={(event) => setResolution({ ...resolution, topic: event.target.value })}
            >
              <option value="">Uncategorised</option>
              {(data?.categories ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
