// ============================================================
// POST /api/inbound/disable
// ============================================================
//
// Turns the inbound line off by pausing the Sarvam deployment. The deployment
// is kept (paused), so turning inbound back on resumes the same line. Past
// inbound calls and their contacts are untouched.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { publicInboundSettings } from "@/lib/inbound/public";
import { disableInbound } from "@/lib/inbound/service";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const result = await disableInbound(auth.tenantId);
  return NextResponse.json(
    result.ok
      ? { settings: publicInboundSettings(result.settings) }
      : { error: { message: result.problems[0] ?? "Sarvam did not pause the line." }, settings: publicInboundSettings(result.settings) },
    { status: result.ok ? 200 : 409, headers: { "Cache-Control": "no-store" } }
  );
}
