// ============================================================
// Hospital — a demonstration call
// ============================================================
//
// One real call, to one number somebody typed, so the hospital's agent can be
// shown working.
//
// It is a real call: it reaches the provider, rings a phone and costs money.
// There is no simulated mode pretending otherwise, because a demonstration
// that does not actually ring proves nothing. What there is instead is a
// short list of things it refuses to do:
//
//   - It dials only the number given in the request. It never reads a list,
//     a campaign or a patient table, so there is no shape of mistake here
//     that ends with everyone being rung.
//   - It refuses a number belonging to a patient who has opted out, even
//     typed by hand, because opting out is not a preference the demo may
//     override.
//   - It refuses a number belonging to a seeded demonstration patient. Those
//     numbers are fictional and may now belong to a real person.
//   - It is rate limited well below anything that could be used to dial
//     repeatedly.
//
// The call itself goes through `placeCall`, the same path the panel's own
// calling and the follow-up scheduler use. No second provider client exists
// here, and the Sarvam key stays on the server.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { getAgentConfig, getAppointments, getLeads, getTenant } from "@/lib/db";
import { normalisePhone } from "@/lib/customers/identity";
import { placeCall } from "@/lib/calls/place-call";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { DEFAULT_AGENT_NAME } from "@/lib/hospital/agent";
import { requireHospitalAuth } from "@/lib/hospital/guard";
import { audit, hospitalProfile } from "@/lib/hospital/service";
import { providerConfigFor } from "@/lib/providers/config";

const noStore = { "Cache-Control": "no-store" };

function resolveWebhookBaseUrl(request: NextRequest): string {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = request.headers.get("host") || "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${protocol}://${host}`;
}

/** What the agent will be told, so the panel can show it before dialling. */
export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const profile = hospitalProfile(auth.tenantId);
  const provider = providerConfigFor(auth.tenantId);
  const agentName = provider?.outbound?.agentName?.trim() || DEFAULT_AGENT_NAME;

  const problems: string[] = [];
  if (!provider?.outbound?.appId) problems.push("No voice agent is connected to this workspace.");
  if (!provider?.outbound?.phoneNumber) problems.push("No calling number is configured.");
  const base = resolveWebhookBaseUrl(request);
  if (!/^https:\/\//i.test(base) && !base.includes("localhost")) {
    problems.push("No public HTTPS address is registered for call results.");
  }

  return NextResponse.json(
    {
      ready: problems.length === 0,
      problems,
      agent: { name: agentName, callsFrom: provider?.outbound?.phoneNumber ?? null },
      hospital: { name: profile.name, timezone: profile.timezone },
      /** Said plainly on the button, so nobody presses it expecting a mock. */
      warning: "This places a real call. The number you enter will ring, and the call is billed like any other.",
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  // Far below what the platform allows for working a list: this is for
  // showing somebody the agent, not for dialling.
  const limit = rateLimit(clientKey(request, "hospital:demo-call"), 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { message: "Too many demonstration calls in a minute. Wait a moment." } },
      { status: 429, headers: noStore }
    );
  }

  const body = await request.json().catch(() => null);
  const rawPhone = String(body?.phone ?? "").trim();
  const name = String(body?.name ?? "").trim() || "Demonstration";

  if (!rawPhone) {
    return NextResponse.json({ error: { message: "Enter the number to call." } }, { status: 400, headers: noStore });
  }

  const normalised = normalisePhone(rawPhone);
  if (!normalised.e164) {
    return NextResponse.json(
      { error: { message: "That number could not be read. Include the country code, for example +91…" } },
      { status: 400, headers: noStore }
    );
  }

  // Whoever this number already is in this workspace decides whether it may
  // be rung — the two refusals that matter.
  const existing = getLeads().find(
    (lead) => lead.tenantId === auth.tenantId && normalisePhone(lead.phone).national === normalised.national
  );
  if (existing?.suppressed) {
    return NextResponse.json(
      {
        error: {
          message: `${existing.name} has opted out of automated calls, so this number is not dialled — not even for a demonstration.`,
        },
      },
      { status: 409, headers: noStore }
    );
  }
  if (existing && isSeededDemoPatient(auth.tenantId, existing.id)) {
    return NextResponse.json(
      {
        error: {
          message:
            "That number belongs to a seeded demonstration patient. Those numbers are fictional and may belong to a real person, so they are never dialled. Enter your own number instead.",
        },
      },
      { status: 409, headers: noStore }
    );
  }

  const profile = hospitalProfile(auth.tenantId);
  const agentConfig = getAgentConfig(auth.tenantId);

  const result = await placeCall({
    leadName: name,
    leadPhone: normalised.e164,
    leadCompany: profile.name || getTenant(auth.tenantId)?.name,
    agentConfig,
    webhookBaseUrl: resolveWebhookBaseUrl(request),
    origin: "manual",
    tenantId: auth.tenantId,
  });

  if (!result.ok) {
    audit(auth.tenantId, auth.user.id, "demo_call.failed", normalised.e164, result.message);
    return NextResponse.json(
      { error: { message: result.message, type: result.reason } },
      { status: result.status, headers: noStore }
    );
  }

  // Recorded like anything else that rings a phone.
  audit(auth.tenantId, auth.user.id, "demo_call.placed", normalised.e164, `call ${result.callId}`);

  return NextResponse.json(
    { callId: result.callId, attemptId: result.attemptId, status: "calling", phone: normalised.e164 },
    { headers: noStore }
  );
}

/**
 * Whether this patient came from the demonstration seed.
 *
 * Read from their appointments rather than from the lead, because the seed
 * marks what it creates and a lead has no mark of its own. One demonstration
 * appointment is enough: it means this record was invented here.
 */
function isSeededDemoPatient(tenantId: string, patientLeadId: string): boolean {
  return getAppointments(tenantId).some(
    (appointment) => appointment.patientLeadId === patientLeadId && appointment.demo
  );
}
