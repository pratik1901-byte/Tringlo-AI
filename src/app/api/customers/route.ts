// ============================================================
// /api/customers
// ============================================================
//
// The customers Tringlo remembers in the signed-in workspace.
//
// GET lists them, most recently active first. `?leadId=` or `?phone=` narrows
// to the one customer a lead resolves to, which is how a lead row finds its
// memory without the client ever computing a customer id.
//
// Tenant-scoped in the lookup; another workspace's customers never appear.
// ============================================================

import { NextResponse } from "next/server";

import { ownedByTenant, requireAuth } from "@/lib/auth/guard";
import { normalisePhone } from "@/lib/customers/identity";
import { getCustomerProfiles, getLead, getMemoryItems } from "@/lib/db";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const leadId = url.searchParams.get("leadId");
  const phoneParam = url.searchParams.get("phone");

  let phone: string | null = null;
  if (leadId) {
    const lead = getLead(leadId);
    // A lead from another workspace is reported the same as no lead.
    if (!lead || !ownedByTenant(lead, auth.tenantId)) {
      return NextResponse.json({ customers: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    phone = normalisePhone(lead.phone).national;
  } else if (phoneParam) {
    phone = normalisePhone(phoneParam).national;
  }

  const profiles = getCustomerProfiles(auth.tenantId)
    .filter((profile) => {
      if (leadId) {
        return profile.leadIds.includes(leadId) || (phone !== null && profile.phoneNational === phone);
      }
      if (phoneParam) return phone !== null && profile.phoneNational === phone;
      return true;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return NextResponse.json(
    {
      customers: profiles.map((profile) => ({
        id: profile.id,
        name: profile.names[0] ?? null,
        phone: profile.phoneE164 ?? profile.phoneNational,
        identityAmbiguous: profile.identityAmbiguous,
        memories: getMemoryItems(auth.tenantId, profile.id).filter((item) => item.status === "active")
          .length,
        recentCalls: profile.recentSummaries.length,
        lastCallAt: profile.recentSummaries[0]?.at ?? null,
        knownSince: profile.createdAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
