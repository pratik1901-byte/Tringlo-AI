// ============================================================
// Hospital — which hospital, which agent, and is this one at all
// ============================================================
//
// Small by design: the panel's frame reads it on every page, so it can name
// the workspace it is showing and the agent that speaks for it.
//
// Unlike the panel's other endpoints this one does NOT require the workspace
// to be a hospital — it is what answers the question. A workspace that is not
// one gets `isHospital: false` and the panel offers to turn it on, which is a
// better answer than an error page for something nobody has set up yet.
//
// Turning it on is the POST below, and it is the only way a workspace becomes
// a hospital. That used to happen by accident: a hospital profile was created
// the first time anything read one, so a panel pointed at the wrong workspace
// quietly made that workspace a hospital. Now somebody has to say so.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { getTenant } from "@/lib/db";
import { DEFAULT_AGENT_NAME } from "@/lib/hospital/agent";
import { isHospitalWorkspace } from "@/lib/hospital/context";
import { workspaceView } from "@/lib/hospital/guard";
import { disableHospital, enableHospital, hospitalProfile } from "@/lib/hospital/service";
import { providerConfigFor } from "@/lib/providers/config";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const isHospital = isHospitalWorkspace(auth.tenantId);
  const profile = hospitalProfile(auth.tenantId, getTenant(auth.tenantId)?.name);
  const provider = providerConfigFor(auth.tenantId);

  return NextResponse.json(
    {
      isHospital,
      workspace: workspaceView(auth.tenantId),
      hospital: { name: profile.name, timezone: profile.timezone },
      agent: {
        // What the workspace has configured, or the hospital agent's own name
        // where nothing is set. Never another workspace's agent.
        name: provider?.outbound?.agentName?.trim() || DEFAULT_AGENT_NAME,
        configured: Boolean(provider?.outbound?.agentName?.trim()),
      },
    },
    { headers: noStore }
  );
}

/** Turns the hospital panel on for this workspace. */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // Only an owner or an admin decides what a workspace is.
  if (auth.role !== "owner" && auth.role !== "admin") {
    return NextResponse.json(
      { error: { message: "Only an owner or admin can turn the hospital panel on for a workspace." } },
      { status: 403, headers: noStore }
    );
  }

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" && body.name.trim()
    ? body.name.trim()
    : getTenant(auth.tenantId)?.name ?? "Hospital";

  const profile = enableHospital(auth.tenantId, name, auth.user.id);
  return NextResponse.json({ isHospital: true, hospital: { name: profile.name, timezone: profile.timezone } }, { headers: noStore });
}

/** Turns it off again. Nothing is deleted; the records stay where they are. */
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (auth.role !== "owner" && auth.role !== "admin") {
    return NextResponse.json(
      { error: { message: "Only an owner or admin can turn the hospital panel off." } },
      { status: 403, headers: noStore }
    );
  }

  disableHospital(auth.tenantId, auth.user.id);
  return NextResponse.json({ isHospital: false }, { headers: noStore });
}
