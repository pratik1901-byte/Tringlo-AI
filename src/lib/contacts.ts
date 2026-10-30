// ============================================================
// Tringlo AI — Contacts: one person, every call in both directions
// ============================================================
//
// Results is organised around people, not calls. A contact is everyone in a
// workspace who shares a normalised phone number — the same identity customer
// memory uses — so a lead uploaded twice, or a caller who later appears in a
// sheet, is one person with one history.
//
// Counts are of call records, and a call record is one real call: the webhook
// pipeline is idempotent, so a redelivered webhook never adds a second one.
// ============================================================

import { isPlaceholderName, normalisePhone } from "@/lib/customers/identity";
import { callDirection, type CallRecord, type FollowUp, type Lead } from "@/lib/types";

export interface ContactSummary {
  key: string;
  name: string;
  phone: string;
  leadIds: string[];
  outboundCount: number;
  inboundCount: number;
  lastOutboundAt: string | null;
  lastInboundAt: string | null;
  lastInteractionAt: string | null;
  latest: {
    direction: "outbound" | "inbound";
    status: string;
    /** Outbound: the agent's outcome. Inbound: resolution, else the reason. */
    outcome: string | null;
  } | null;
  /** Interest from the latest connected outbound call that reported one. */
  interest: string | null;
  /** The next scheduled callback, if any. */
  followUpAt: string | null;
  suppressed: boolean;
}

export function contactKey(phone: string | null | undefined, fallback: string): string {
  return normalisePhone(phone).national ?? `lead:${fallback}`;
}

function when(record: CallRecord): string {
  return record.startedAt ?? record.endedAt ?? record.requestedAt ?? "";
}

export function buildContacts(leads: Lead[], records: CallRecord[], followUps: FollowUp[]): ContactSummary[] {
  const leadKey = new Map<string, string>();
  const byKey = new Map<string, { leads: Lead[]; calls: CallRecord[] }>();

  for (const lead of leads) {
    const key = contactKey(lead.phone, lead.id);
    leadKey.set(lead.id, key);
    const entry = byKey.get(key) ?? { leads: [], calls: [] };
    entry.leads.push(lead);
    byKey.set(key, entry);
  }
  for (const record of records) {
    const key = leadKey.get(record.leadId) ?? contactKey(record.lead?.phone, record.leadId);
    const entry = byKey.get(key) ?? { leads: [], calls: [] };
    entry.calls.push(record);
    byKey.set(key, entry);
  }

  const contacts: ContactSummary[] = [];
  for (const [key, { leads: people, calls }] of byKey) {
    if (calls.length === 0) continue; // Results lists people who have a call.
    calls.sort((a, b) => when(b).localeCompare(when(a)));
    const outbound = calls.filter((call) => callDirection(call) === "outbound");
    const inbound = calls.filter((call) => callDirection(call) === "inbound");
    const named = [...people, ...calls.map((call) => call.lead)].find((lead) => lead && !isPlaceholderName(lead.name));
    const latest = calls[0];
    const latestDirection = callDirection(latest);
    const leadIds = [...new Set([...people.map((lead) => lead.id), ...calls.map((call) => call.leadId)])];
    const openFollowUp = followUps
      .filter((followUp) => leadIds.includes(followUp.leadId) && (followUp.status === "scheduled" || followUp.status === "retry_pending" || followUp.status === "needs_scheduling"))
      .sort((a, b) => String(a.nextAttemptAt ?? a.scheduledTime ?? "").localeCompare(String(b.nextAttemptAt ?? b.scheduledTime ?? "")))[0];

    contacts.push({
      key,
      name: named?.name ?? (inbound.length ? "Unknown caller" : people[0]?.name ?? "Lead"),
      phone: (people[0] ?? latest.lead)?.phone ?? "",
      leadIds,
      outboundCount: outbound.length,
      inboundCount: inbound.length,
      lastOutboundAt: outbound[0] ? when(outbound[0]) || null : null,
      lastInboundAt: inbound[0] ? when(inbound[0]) || null : null,
      lastInteractionAt: when(latest) || null,
      latest: {
        direction: latestDirection,
        status: latest.status,
        outcome:
          latestDirection === "inbound"
            ? latest.resolutionStatus ?? latest.intent ?? null
            : latest.aiResult?.status ?? null,
      },
      interest: outbound.find((call) => call.status === "connected" && call.interestLevel)?.interestLevel ?? null,
      followUpAt: openFollowUp ? openFollowUp.nextAttemptAt ?? openFollowUp.scheduledTime ?? "needs a time" : null,
      suppressed: people.some((lead) => lead.suppressed),
    });
  }
  return contacts.sort((a, b) => String(b.lastInteractionAt ?? "").localeCompare(String(a.lastInteractionAt ?? "")));
}
