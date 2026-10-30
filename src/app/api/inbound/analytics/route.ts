// ============================================================
// GET /api/inbound/analytics?days=30
// ============================================================
//
// Inbound analytics for the signed-in workspace, computed on the server from
// its own call records. Outbound appears only in the daily comparison series.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { getCallRecords } from "@/lib/db";
import { computeInboundAnalytics } from "@/lib/inbound/analytics";
import { inboundSettingsFor } from "@/lib/inbound/service";

const RANGES = [7, 30, 90];

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const requested = Number(new URL(request.url).searchParams.get("days"));
  const days = RANGES.includes(requested) ? requested : 30;
  const settings = inboundSettingsFor(auth.tenantId);
  const records = scopeToTenant(getCallRecords(), auth.tenantId);

  return NextResponse.json(
    {
      enabled: settings.enabled,
      deploymentStatus: settings.deploymentStatus,
      analytics: computeInboundAnalytics(records, settings.timezone || "Asia/Kolkata", days),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
