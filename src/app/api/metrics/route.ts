import { NextResponse } from "next/server";

import { callDirection } from "@/lib/types";
import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { getCallRecords, getFollowUps, getLeads } from "@/lib/db";
import {
  computeCallMetrics,
  computeDailySeries,
  computeHourlySeries,
  computeOutcomeBreakdown,
  computeWeeklySeries,
} from "@/lib/metrics";

/**
 * GET /api/metrics
 *
 * Every figure the dashboard and analytics pages show, computed server-side from
 * the same call records the Sarvam webhook writes. Computing them here rather
 * than in each page is what keeps two screens from disagreeing about the same
 * call — and leaves nowhere for a hardcoded number to hide.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    // Every figure is computed from this tenant's rows only, so one business
    // can never see another reflected in its own totals.
    // Outbound analytics: calls Tringlo placed. Inbound has its own analytics.
    const records = scopeToTenant(getCallRecords(), auth.tenantId).filter(
      (record) => callDirection(record) === "outbound"
    );
    const leads = scopeToTenant(getLeads(), auth.tenantId);
    const followUps = scopeToTenant(getFollowUps(), auth.tenantId);

    const metrics = computeCallMetrics(records, leads, followUps);

    return NextResponse.json({
      metrics,
      outcomes: computeOutcomeBreakdown(metrics),
      daily: computeDailySeries(records, 7),
      weekly: computeWeeklySeries(records, 8),
      hourly: computeHourlySeries(records),
      generatedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GET /api/metrics]", message);
    return NextResponse.json({ error: "Could not compute metrics." }, { status: 500 });
  }
}
