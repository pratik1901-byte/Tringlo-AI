// ============================================================
// POST /api/hospital/agent-tools
// ============================================================
//
// The one endpoint Maya calls DURING a live call to act on the hospital's
// database: look up doctors, check real availability, and book / reschedule /
// cancel. It is deterministic — the agent names a tool and its arguments, the
// server runs the corresponding backend service, and a structured result comes
// straight back within the voice turn. The LLM never reaches the database.
//
// Authentication is the workspace's webhook token, which carries the workspace
// id, exactly as the inbound-context hook authenticates. A call may only act on
// its own hospital. Every call is logged with its tool, duration and outcome so
// a slow or failing tool is visible rather than silently stalling the call.
//
// Body: { "tool": "<name>", "args": { ... } }  (also accepts "action"/"name").
// ============================================================

import { NextResponse } from "next/server";

import { isHospitalWorkspace } from "@/lib/hospital/context";
import { agentToolsDiagnostics, runAgentTool } from "@/lib/hospital/agent-tools";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { authenticateWebhook } from "@/lib/security/webhook-auth";

const noStore = { "Cache-Control": "no-store" };

/** A short id tying the logs for one tool call together, echoed to the caller. */
function correlationId(): string {
  return `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  const limit = rateLimit(clientKey(request, "agent-tools"), 600, 60_000);
  if (!limit.allowed) return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: noStore });

  // Only a workspace's own token opens this door, and it carries the workspace.
  const auth = authenticateWebhook(request);
  if (!auth.ok || !auth.tenantId) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401, headers: noStore });
  }
  const tenantId = auth.tenantId;
  if (!isHospitalWorkspace(tenantId)) {
    return NextResponse.json({ ok: false, error: "This workspace does not run the hospital panel." }, { status: 409, headers: noStore });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400, headers: noStore });
  }

  const tool = String(body.tool ?? body.action ?? body.name ?? "").trim();
  const cid = correlationId();
  if (!tool) return NextResponse.json({ ok: false, error: "No tool was named.", correlationId: cid }, { status: 400, headers: noStore });
  const args = (body.args ?? body.arguments ?? body.parameters ?? {}) as Record<string, unknown>;

  console.log(`AGENT_TOOL_RECV cid=${cid} workspace=${tenantId} tool=${tool} doctor=${String(args.doctor_id ?? "")} appointment=${String(args.appointment_id ?? "")}`);

  const result = await runAgentTool(tenantId, tool, args);
  const tookMs = Date.now() - startedAt;

  // Names, booleans, ids and timing only — never a patient value. The result
  // count / appointment id help trace an availability or booking call.
  const data = result.ok ? (result.data as Record<string, unknown>) : null;
  const resultCount = Array.isArray(data?.doctors) ? (data!.doctors as unknown[]).length : Array.isArray(data?.slots) ? (data!.slots as unknown[]).length : Array.isArray(data?.appointments) ? (data!.appointments as unknown[]).length : undefined;
  console.log(
    `AGENT_TOOL_DONE cid=${cid} workspace=${tenantId} tool=${tool} ok=${result.ok} tookMs=${tookMs}` +
      (resultCount !== undefined ? ` results=${resultCount}` : "") +
      (data?.appointment_id ? ` appointment=${data.appointment_id}` : "") +
      (result.ok ? "" : ` code=${result.code ?? "none"} error="${result.error}"`)
  );

  // A failed tool is still a 200: it is a result the agent should speak, not a
  // transport error. The agent reads `ok` and explains the problem politely.
  return NextResponse.json({ ...result, tookMs, correlationId: cid }, { headers: noStore });
}

/**
 * GET /api/hospital/agent-tools — a diagnostics health probe.
 *
 * Reports whether the endpoint and database are reachable, the doctor and demo
 * counts, how many slots are free today, and the latest tool errors — so a
 * stuck call can be diagnosed without guessing. Authenticated by the workspace
 * token, exactly like the tool calls.
 */
export async function GET(request: Request) {
  const auth = authenticateWebhook(request);
  if (!auth.ok || !auth.tenantId) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401, headers: noStore });
  }
  if (!isHospitalWorkspace(auth.tenantId)) {
    return NextResponse.json({ ok: false, error: "This workspace does not run the hospital panel." }, { status: 409, headers: noStore });
  }
  return NextResponse.json(agentToolsDiagnostics(auth.tenantId), { headers: noStore });
}
