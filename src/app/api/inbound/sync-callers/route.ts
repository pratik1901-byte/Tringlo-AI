// ============================================================
// POST /api/inbound/sync-callers
// ============================================================
//
// Re-sends the workspace's known contacts to the live inbound line now,
// instead of waiting for the daily refresh — e.g. right after a lead upload.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { getInboundSettings } from "@/lib/db";
import { syncKnownCallers } from "@/lib/inbound/service";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(clientKey(request, `inbound-sync:${auth.tenantId}`), 4, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: { message: "Too many attempts. Wait a minute." } }, { status: 429 });

  const settings = getInboundSettings(auth.tenantId);
  if (!settings?.enabled || !settings.deploymentId) {
    return NextResponse.json({ error: { message: "Inbound is not on." } }, { status: 409 });
  }
  try {
    const { count } = await syncKnownCallers(auth.tenantId);
    return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : "Sarvam did not accept the contacts." } },
      { status: 502 }
    );
  }
}
