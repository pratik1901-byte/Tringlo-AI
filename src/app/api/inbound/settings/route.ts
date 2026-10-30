// ============================================================
// /api/inbound/settings
// ============================================================
//
// GET  the workspace's inbound line: its settings, the deployment status as
//      Sarvam last reported it (refreshed here, throttled), whether the server
//      is configured for inbound at all, and the most recent inbound call.
// PUT  saves settings without touching Sarvam. A line that is already live
//      keeps running on its old settings until "Update" (POST /enable).
//
// Nothing secret leaves the server: no API key, no webhook token, no app or
// connection id — only what the workspace itself entered and plain statuses.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { getCallRecords } from "@/lib/db";
import { inboundServerConfig, inboundSettingsFor, saveInboundDraft, syncInboundStatus } from "@/lib/inbound/service";
import { parseInboundInput, publicInboundSettings } from "@/lib/inbound/public";
import { callDirection } from "@/lib/types";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const settings = await syncInboundStatus(inboundSettingsFor(auth.tenantId));
  const config = inboundServerConfig(auth.tenantId);
  const lastCall = scopeToTenant(getCallRecords(), auth.tenantId)
    .filter((record) => callDirection(record) === "inbound")
    .sort((a, b) => String(b.startedAt ?? b.requestedAt).localeCompare(String(a.startedAt ?? a.requestedAt)))[0];

  return NextResponse.json(
    {
      settings: publicInboundSettings(settings),
      server: { ready: config.ready, problems: config.problems, advisories: config.advisories },
      lastInboundCall: lastCall
        ? { id: lastCall.id, at: lastCall.startedAt ?? lastCall.requestedAt, status: lastCall.status, caller: lastCall.lead?.name ?? null }
        : null,
    },
    { headers: NO_STORE }
  );
}

export async function PUT(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const input = parseInboundInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: { message: "Invalid settings." } }, { status: 400 });

  const result = saveInboundDraft(auth.tenantId, input);
  if (!result.ok) {
    return NextResponse.json({ error: { message: result.problems[0], problems: result.problems } }, { status: 400, headers: NO_STORE });
  }
  return NextResponse.json({ settings: publicInboundSettings(result.settings!) }, { headers: NO_STORE });
}
