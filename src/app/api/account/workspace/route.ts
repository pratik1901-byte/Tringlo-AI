// ============================================================
// DELETE /api/account/workspace
// ============================================================
//
// Deletes the signed-in workspace and everything in it: its leads, calls,
// transcripts, recordings, customers and their memory, campaigns, follow-ups,
// provider configuration and the accounts that could sign into it.
//
// Guarded three ways, because there is no undo:
//   - only an owner may do it;
//   - the workspace's name must be typed back exactly;
//   - an inbound line must be switched off first, so a workspace is never
//     deleted while a Sarvam deployment is still sending calls to it.
//
// Nothing outside the database is touched. The Sarvam deployment, agent and
// phone number remain; removing those is the operator's decision, in Sarvam.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { clearedSessionCookie, isSecureRequest } from "@/lib/auth/sessions";
import { deleteTenant, getInboundSettings, getTenant } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(clientKey(request, `workspace-delete:${auth.tenantId}`), 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: { message: "Too many attempts. Wait a minute." } }, { status: 429 });
  }

  if (auth.user.role !== "owner") {
    return NextResponse.json(
      { error: { message: "Only the workspace owner can delete it." } },
      { status: 403 }
    );
  }

  const workspace = getTenant(auth.tenantId);
  if (!workspace) return NextResponse.json({ error: { message: "No such workspace." } }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { confirmName?: unknown };
  const typed = typeof body.confirmName === "string" ? body.confirmName.trim() : "";
  if (typed !== workspace.name) {
    return NextResponse.json(
      { error: { message: `Type the workspace name exactly — "${workspace.name}" — to confirm.` } },
      { status: 400 }
    );
  }

  const inbound = getInboundSettings(auth.tenantId);
  if (inbound?.enabled) {
    return NextResponse.json(
      {
        error: {
          message:
            "Turn inbound calling off first. While it is on, Sarvam is still sending calls to this workspace.",
        },
      },
      { status: 409 }
    );
  }

  const counts = deleteTenant(auth.tenantId);
  if (!counts) return NextResponse.json({ error: { message: "No such workspace." } }, { status: 404 });

  // The session died with the workspace; the cookie goes with it.
  return NextResponse.json(
    { deleted: true, workspace: workspace.name, counts },
    { headers: { "Set-Cookie": clearedSessionCookie({ secure: isSecureRequest(request) }) } }
  );
}
