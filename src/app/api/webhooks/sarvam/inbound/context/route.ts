// ============================================================
// /api/webhooks/sarvam/inbound/context
// ============================================================
//
// For the inbound agent's on-start hook: called by Sarvam as a call begins,
// before the agent speaks, so Priya greets a known caller with their context.
//
// Returns flat agent variables — the workspace's company context, the line's
// business hours and handoff facts, and for a known caller their name and
// relevant memory. An unknown caller gets no personal details.
//
// The workspace is decided by the deployment that answered or the number that
// was dialled — never by anything the caller controls. Requires the webhook
// token, always: unlike the completion webhook, this returns customer data,
// so it refuses to run on a server with no token configured.
//
// Sarvam documents on-start hooks but not their request shape, so the caller's
// number is accepted under the common names (JSON body or query string).
// ============================================================

import { NextResponse } from "next/server";

import { ownedByTenant } from "@/lib/auth/guard";
import { normalisePhone } from "@/lib/customers/identity";
import { getCallRecords } from "@/lib/db";
import { inboundSettingsForCall, variablesForCaller } from "@/lib/inbound/service";
import { callDirection, isTerminalCallStatus } from "@/lib/types";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { authenticateWebhook } from "@/lib/security/webhook-auth";

function pick(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * True when this hook fired for a call Tringlo is placing, not one it received.
 * The same Sarvam agent may serve both, and its on-start hook fires for both:
 * an outbound call must keep the variables Tringlo sent when placing it.
 */
function isOutboundCall(source: Record<string, unknown>, tenantId: string, caller: string | null): boolean {
  if (source.campaign_id || source.attempt_id) return true;
  const direction = String(source.direction ?? source.call_direction ?? source.channel_direction ?? "").toLowerCase();
  if (direction.startsWith("out")) return true;
  if (direction.startsWith("in")) return false;
  // Tringlo is dialling this number right now.
  const national = normalisePhone(caller).national;
  if (!national) return false;
  const recent = Date.now() - 10 * 60 * 1000;
  return getCallRecords().some(
    (record) =>
      ownedByTenant(record, tenantId) &&
      callDirection(record) === "outbound" &&
      !isTerminalCallStatus(record.status) &&
      new Date(record.requestedAt ?? 0).getTime() > recent &&
      normalisePhone(record.lead?.phone).national === national
  );
}

async function handle(request: Request) {
  const limit = rateLimit(clientKey(request, "inbound-context"), 600, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  // Only a workspace's own token opens this door. It carries the workspace,
  // which is then checked against the one the deployment belongs to.
  const auth = authenticateWebhook(request);
  if (!auth.ok || !auth.tenantId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // Some providers nest the call details.
    for (const nested of ["call", "channel_info", "data", "metadata"]) {
      if (body[nested] && typeof body[nested] === "object") body = { ...(body[nested] as Record<string, unknown>), ...body };
    }
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const source = { ...query, ...body };

  const caller = pick(source, ["user_phone_number", "caller", "caller_number", "from", "from_number", "phone", "phone_number"]);
  const dialled = pick(source, ["agent_phone_number", "to", "to_number", "called_number", "inbound_number"]);
  const deploymentId = pick(source, ["deployment_id"]);

  const settings = inboundSettingsForCall(deploymentId, dialled);
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: "No inbound line matches this call." }, { status: 404 });
  }

  // A workspace token may only ask about its own line. Routing is still by
  // deployment; the token is the second lock, not the first.
  if (auth.tenantId !== settings.tenantId) {
    console.warn(`INBOUND_CONTEXT_WRONG_WORKSPACE token=${auth.tenantId} line=${settings.tenantId}`);
    return NextResponse.json({ error: "No inbound line matches this call." }, { status: 404 });
  }
  if (!caller) {
    return NextResponse.json({ error: "The caller's number is required." }, { status: 400 });
  }

  // Sarvam does not document this request, so its field names (never values)
  // are logged to confirm what it sends.
  console.log(`INBOUND_CONTEXT_REQUEST method=${request.method} fields=${Object.keys(source).filter((key) => key !== "k").sort().join(",")}`);

  if (isOutboundCall(source, settings.tenantId, caller)) {
    console.log(`INBOUND_CONTEXT_SKIPPED_OUTBOUND tenant=${settings.tenantId}`);
    return NextResponse.json({ call_direction: "outbound" }, { headers: { "Cache-Control": "no-store" } });
  }

  const variables = variablesForCaller(settings, caller, { forHook: true });
  console.log(`INBOUND_CONTEXT_SERVED tenant=${settings.tenantId} known=${variables.caller_known === "yes"}`);
  return NextResponse.json(variables, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
