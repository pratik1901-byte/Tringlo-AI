import { NextResponse } from "next/server";

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
export async function GET() {
  try {
    const records = getCallRecords();
    const leads = getLeads();
    const followUps = getFollowUps();

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
