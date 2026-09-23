import { NextRequest, NextResponse } from "next/server";

import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { getFollowUp, getFollowUps, getLead, getLegacyTenantId, isLeadSuppressed, saveFollowUp, updateFollowUp } from "@/lib/db";
import type { FollowUp } from "@/lib/types";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({
      followUps: scopeToTenant(getFollowUps(), auth.tenantId, getLegacyTenantId()),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GET /api/follow-ups]", message);
    return NextResponse.json({ error: "Could not load follow-ups." }, { status: 500 });
  }
}

/** Accepts a datetime only if it actually parses. An unparseable value is refused, not defaulted. */
function parseScheduledTime(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * POST /api/follow-ups
 *
 * Creates a follow-up a user scheduled by hand. Callbacks that came out of a real
 * call are created by the webhook reducer instead, and are tagged `sarvam_call`
 * so the two are never confused in the UI.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body?.leadId || !body?.lead) {
      return NextResponse.json({ error: "leadId and lead are required" }, { status: 400 });
    }

    if (isLeadSuppressed(body.leadId)) {
      return NextResponse.json(
        { error: "This lead is on the do-not-call list; no follow-up can be scheduled." },
        { status: 403 }
      );
    }

    const scheduledTime = parseScheduledTime(body.scheduledTime);
    if (scheduledTime === undefined) {
      return NextResponse.json(
        { error: "scheduledTime must be a valid date-time, or null if not yet known." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const followUp: FollowUp = {
      id: body.id || `fu_manual_${Date.now()}`,
      leadId: body.leadId,
      lead: getLead(body.leadId) ?? body.lead,
      previousResponse: body.previousResponse?.trim() || null,
      interest: body.interest ?? null,
      requestedCallback: body.scheduledTime ?? null,
      scheduledTime,
      timezone: body.timezone ?? null,
      status: scheduledTime ? "scheduled" : "needs_scheduling",
      nextAction: body.nextAction?.trim() || null,
      source: "manual",
      attemptId: null,
      callId: null,
      createdAt: now,
      updatedAt: now,
    };

    return NextResponse.json(saveFollowUp(followUp));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[POST /api/follow-ups]", message);
    return NextResponse.json({ error: "Could not create follow-up." }, { status: 500 });
  }
}

/** A reschedule may be at most this far in the past — enough for clock skew, not for backdating. */
const PAST_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * PATCH /api/follow-ups
 *
 * The admin's edit: move a callback to a new time, change its next action, or
 * cancel it.
 *
 * `status` is not a free field. The only status a person may set is
 * `cancelled`; every other state is something the scheduler or a webhook
 * observed. Accepting any status from the browser, as this used to, would let a
 * callback be marked `completed` when no call ever happened.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const existing = getFollowUp(body.id);
    if (!existing) {
      return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
    }

    if (body.status !== undefined && body.status !== "cancelled") {
      return NextResponse.json(
        { error: "The only status that can be set by hand is \"cancelled\"." },
        { status: 400 }
      );
    }

    const cancelling = body.status === "cancelled";
    const rescheduling = "scheduledTime" in body;

    if (cancelling && rescheduling) {
      return NextResponse.json(
        { error: "Cancel a follow-up or give it a new time, not both at once." },
        { status: 400 }
      );
    }

    // A call already placed cannot be recalled. Changing the row now would
    // leave it describing a call that is actually ringing.
    if ((cancelling || rescheduling) && (existing.status === "triggering" || existing.status === "calling")) {
      return NextResponse.json(
        {
          error: "This callback is being placed right now. Wait for its result, then edit it.",
          type: "call_in_progress",
        },
        { status: 409 }
      );
    }

    // Rescheduling a suppressed lead's callback would put a do-not-call customer
    // back in the queue. Cancelling it is always allowed.
    if (rescheduling && isLeadSuppressed(existing.leadId)) {
      return NextResponse.json(
        {
          error: "This lead is on the do-not-call list, so its callback cannot be rescheduled.",
          type: "call_blocked_dnd",
        },
        { status: 403 }
      );
    }

    const updates: Partial<FollowUp> = {};

    if (cancelling) {
      if (existing.status === "cancelled") {
        return NextResponse.json(existing);
      }
      updates.status = "cancelled";
      updates.nextAttemptAt = null;
      updates.lockedAt = null;
      updates.cancelledAt = new Date().toISOString();
      updates.cancelledBy = "admin";
      console.log(`FOLLOW_UP_CANCELLED followUp=${existing.id} by=admin`);
    }

    if (rescheduling) {
      const scheduledTime = parseScheduledTime(body.scheduledTime);
      if (scheduledTime === undefined) {
        return NextResponse.json(
          { error: "scheduledTime must be a valid date-time, or null." },
          { status: 400 }
        );
      }

      // A time in the past would be due immediately and then held as stale —
      // it would look accepted and never ring.
      if (scheduledTime && new Date(scheduledTime).getTime() < Date.now() - PAST_TOLERANCE_MS) {
        return NextResponse.json(
          { error: "That time has already passed. Choose a time in the future." },
          { status: 400 }
        );
      }

      updates.scheduledTime = scheduledTime;
      // Giving a callback a real time is what moves it out of `needs_scheduling`
      // — and what reopens one that was cancelled.
      updates.status = scheduledTime ? "scheduled" : "needs_scheduling";

      // A new time starts a fresh attempt. Leftover retry state made the
      // scheduler measure staleness against the old retry time and hold the
      // rescheduled call again the moment it came due.
      updates.nextAttemptAt = null;
      updates.lastError = null;
      updates.lockedAt = null;
      updates.executionAttempts = 0;
      updates.cancelledAt = null;
      updates.cancelledBy = null;
      console.log(`FOLLOW_UP_RESCHEDULED followUp=${existing.id} to=${scheduledTime ?? "unset"} by=admin`);
    }

    if ("nextAction" in body) {
      const next = typeof body.nextAction === "string" ? body.nextAction.trim().slice(0, 500) : "";
      updates.nextAction = next || null;
    }

    if ("timezone" in body) {
      updates.timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : null;
    }

    return NextResponse.json(updateFollowUp(body.id, updates));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PATCH /api/follow-ups]", message);
    return NextResponse.json({ error: "Could not update follow-up." }, { status: 500 });
  }
}
