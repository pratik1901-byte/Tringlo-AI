// ============================================================
// GET /api/contacts
// ============================================================
//
// The Results list: one row per person (by normalised phone), with how many
// times we called them and they called us, and where things stand.
//
// `?key=` returns one contact with all of their calls, newest first, for the
// contact panel's Outbound and Inbound tabs.
//
// Tenant-scoped: leads, calls and follow-ups of other workspaces never enter
// the aggregation.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { buildContacts, contactKey } from "@/lib/contacts";
import { getCallRecords, getFollowUps, getLeads } from "@/lib/db";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const leads = scopeToTenant(getLeads(), auth.tenantId);
  const records = scopeToTenant(getCallRecords(), auth.tenantId);
  const followUps = scopeToTenant(getFollowUps(), auth.tenantId);
  const contacts = buildContacts(leads, records, followUps);

  const key = new URL(request.url).searchParams.get("key");
  if (key) {
    const contact = contacts.find((candidate) => candidate.key === key);
    if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
    const calls = records
      .filter((record) => contact.leadIds.includes(record.leadId) || contactKey(record.lead?.phone, record.leadId) === key)
      .sort((a, b) => String(b.startedAt ?? b.requestedAt).localeCompare(String(a.startedAt ?? a.requestedAt)));
    return NextResponse.json({ contact, calls }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    {
      contacts,
      totals: {
        contacts: contacts.length,
        outbound: contacts.reduce((sum, contact) => sum + contact.outboundCount, 0),
        inbound: contacts.reduce((sum, contact) => sum + contact.inboundCount, 0),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
