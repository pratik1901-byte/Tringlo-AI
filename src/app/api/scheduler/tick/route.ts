import { NextResponse } from "next/server";

import { runSchedulerTick } from "@/lib/scheduling/scheduler";
import { getDueFollowUps } from "@/lib/db";
import { LOCK_TIMEOUT_MS } from "@/lib/scheduling/scheduler";

/**
 * POST /api/scheduler/tick
 *
 * Runs one scheduler pass on demand.
 *
 * The in-process worker is the normal driver. This exists so an external cron
 * can drive it instead on a host that does not keep a process alive between
 * requests, and so the behaviour can be tested without waiting for a tick.
 */
export async function POST() {
  try {
    return NextResponse.json(await runSchedulerTick());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[POST /api/scheduler/tick]", message);
    return NextResponse.json({ error: "Scheduler tick failed." }, { status: 500 });
  }
}

/** GET reports what is waiting, without placing anything. */
export function GET() {
  const due = getDueFollowUps(Date.now(), LOCK_TIMEOUT_MS);
  return NextResponse.json({
    due: due.length,
    followUps: due.map((followUp) => ({
      id: followUp.id,
      lead: followUp.lead?.name ?? null,
      scheduledTime: followUp.scheduledTime,
      attempts: followUp.executionAttempts ?? 0,
    })),
  });
}
