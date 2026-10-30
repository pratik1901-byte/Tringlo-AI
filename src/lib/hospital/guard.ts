// ============================================================
// Tringlo AI — Which hospital is this request about?
// ============================================================
//
// The workspace the person has open, and it must actually be a hospital.
//
// That second half has history worth keeping. The hospital panel began as a
// separate application on its own port, which meant it had no workspace of
// its own and followed whichever one the session had open — so signing in to
// a sales workspace and opening the panel showed that workspace's calls, its
// agent and its customers under a hospital's name. Worse, the code used to
// create a hospital profile the first time anything read one, so merely
// looking made the wrong workspace a little more hospital-shaped.
//
// Both are gone. The panel is a section of the platform, so the workspace is
// simply the one on screen; and a workspace is a hospital only once somebody
// has enabled it. A workspace that has not is refused here with a code the
// panel understands, so it can offer to enable it rather than show an error.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, type AuthResult } from "@/lib/auth/guard";
import { getTenant } from "@/lib/db";
import { isHospitalWorkspace } from "./context";

/**
 * Authenticates, and establishes that this workspace runs the hospital panel.
 *
 * `409 not_a_hospital` is deliberately not a 403: nothing is forbidden, the
 * workspace simply is not set up as a hospital yet, and the panel turns that
 * into an invitation rather than a wall.
 */
export async function requireHospitalAuth(request: Request): Promise<AuthResult> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth;

  if (!isHospitalWorkspace(auth.tenantId)) {
    return {
      ok: false,
      reason: "no_workspace",
      response: NextResponse.json(
        {
          error: {
            code: "not_a_hospital",
            message: `"${getTenant(auth.tenantId)?.name ?? "This workspace"}" is not set up as a hospital. Turn the hospital panel on for it to begin.`,
          },
        },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      ),
    };
  }

  return auth;
}

/** Which workspace the panel is showing, so it can name it on screen. */
export function workspaceView(tenantId: string) {
  return { id: tenantId, name: getTenant(tenantId)?.name ?? "Unknown workspace" };
}
