import { NextRequest, NextResponse } from "next/server";

import { updateFollowUp } from "@/lib/db";

/**
 * Test-only state manipulation.
 *
 * Some behaviours cannot be reached through the public API — a worker that dies
 * mid-trigger, or a follow-up already linked to an in-flight callback — and they
 * are exactly the paths that broke in production. So they are reachable here,
 * behind two locks: the route refuses to exist in a production build, and it
 * requires DIALO_TEST_HOOKS to be set explicitly.
 */
function enabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DIALO_TEST_HOOKS === "true";
}

export async function POST(request: NextRequest) {
  if (!enabled()) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { action, id } = body ?? {};

  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  if (action === "strand") {
    // The state a worker leaves behind when it dies between claiming a row and
    // placing the call: claimed, with a lock old enough to have expired.
    updateFollowUp(id, {
      status: "triggering",
      lockedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "link") {
    // Stands in for the scheduler having placed this callback.
    updateFollowUp(id, {
      status: "calling",
      executedCallId: body.callId ?? null,
      executedAttemptId: body.attemptId ?? null,
      executedAt: new Date().toISOString(),
      lockedAt: null,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "retry_due") {
    // A retry Tringlo queued itself, now due.
    updateFollowUp(id, {
      status: "retry_pending",
      nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
      lockedAt: null,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
