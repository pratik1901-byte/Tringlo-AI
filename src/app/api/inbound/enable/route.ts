// ============================================================
// POST /api/inbound/enable
// ============================================================
//
// Turns the workspace's inbound line on — or, when it is already on, applies
// changed settings to it. This is the ONLY path that creates a Sarvam
// deployment, and a deployment answers calls the moment it exists, so the
// request must carry `confirm: true` (the UI asks first).
//
// The status returned is the one Sarvam reported, never assumed.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { parseInboundInput, publicInboundSettings } from "@/lib/inbound/public";
import { enableInbound } from "@/lib/inbound/service";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(clientKey(request, `inbound-enable:${auth.tenantId}`), 6, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: { message: "Too many attempts. Wait a minute." } }, { status: 429 });

  const body = await request.json().catch(() => null);
  if (body?.confirm !== true) {
    return NextResponse.json({ error: { message: "Confirm that the line goes live." } }, { status: 400 });
  }
  const input = parseInboundInput(body);
  if (!input) return NextResponse.json({ error: { message: "Invalid settings." } }, { status: 400 });

  const result = await enableInbound(auth.tenantId, input);
  return NextResponse.json(
    result.ok
      ? { settings: publicInboundSettings(result.settings) }
      : { error: { message: result.problems[0] ?? "Inbound could not be turned on.", problems: result.problems }, settings: publicInboundSettings(result.settings) },
    { status: result.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } }
  );
}
