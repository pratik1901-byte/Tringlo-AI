// ============================================================
// Hospital — the hospital's own settings
// ============================================================
//
// The hospital's facts, its confirmation-call policy, its escalation
// procedure, and the one controlled way to put demonstration data into an
// empty workspace.
//
// Nothing here is invented. An address, a helpline, a set of opening hours or
// an escalation procedure is a claim about a real hospital: each stays empty
// until somebody enters it, and the panel shows it as unconfigured rather than
// filling the gap. An escalation procedure in particular is a clinical safety
// document, and a plausible-sounding invented one would be worse than the
// visible absence of a real one.
//
// FAQs are not here. They belong to Inquiries & Reception and are managed at
// /api/hospital/inquiries — one place, so two screens cannot disagree about
// what the agent is allowed to say.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth, workspaceView } from "@/lib/hospital/guard";
import { getHospitalAudit } from "@/lib/db";
import { hospitalContext, intakeGuidance } from "@/lib/hospital/context";
import { integrationStatus } from "@/lib/hospital/his";
import { seedHospital } from "@/lib/hospital/seed";
import { audit, hospitalProfile, updateHospitalProfile } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const profile = hospitalProfile(auth.tenantId);
  return NextResponse.json(
    {
      // The credential never travels: it lives on the profile server-side and
      // the integration status reports only whether one is set.
      profile: { ...profile, integration: undefined },
      workspace: workspaceView(auth.tenantId),
      integration: integrationStatus(auth.tenantId),
      audit: getHospitalAudit(auth.tenantId, 50),
      /** Exactly what the agent is given at the start of a call. */
      agentContext: hospitalContext(auth.tenantId),
      agentRules: intakeGuidance(auth.tenantId),
    },
    { headers: noStore }
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const changes: Record<string, unknown> = {};

  for (const field of [
    "name",
    "timezone",
    "address",
    "helpline",
    "email",
    "website",
    "notes",
    "escalationProtocol",
    "staffContact",
  ]) {
    if (body?.[field] !== undefined) changes[field] = String(body[field]).trim() || null;
  }
  if (body?.openingHours !== undefined) changes.openingHours = body.openingHours;
  if (body?.remindersEnabled !== undefined) changes.remindersEnabled = Boolean(body.remindersEnabled);
  if (body?.reminderLeadHours !== undefined) {
    const hours = Number(body.reminderLeadHours);
    if (Number.isFinite(hours) && hours > 0 && hours <= 168) changes.reminderLeadHours = Math.round(hours);
  }
  if (body?.reminderMaxAttempts !== undefined) {
    const attempts = Number(body.reminderMaxAttempts);
    if (Number.isInteger(attempts) && attempts >= 1 && attempts <= 5) changes.reminderMaxAttempts = attempts;
  }
  // The hospital name is what the agent says; it must never become empty.
  if (changes.name === null) delete changes.name;

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: { message: "Nothing to change." } }, { status: 400, headers: noStore });
  }

  const profile = updateHospitalProfile(auth.tenantId, changes, auth.user.id);
  return NextResponse.json({ profile: { ...profile, integration: undefined } }, { headers: noStore });
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);

  // Demonstration data, on request only, and never on a restart.
  if (body?.action === "seed") {
    const report = seedHospital(auth.tenantId);
    audit(
      auth.tenantId,
      auth.user.id,
      "hospital.seeded",
      "demo",
      `doctors=${report.doctors} appointments=${report.appointments} faqs=${report.faqs}`
    );
    return NextResponse.json({ seeded: report }, { headers: noStore });
  }

  return NextResponse.json(
    { error: { message: "Unknown action. FAQs are managed at /api/hospital/inquiries." } },
    { status: 400, headers: noStore }
  );
}
