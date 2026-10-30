// ============================================================
// POST /api/workspaces/{id}/enter
// ============================================================
//
// Opens a workspace on the current session.
//
// Signing in is what proves who you are; choosing which of your own companies
// to look at is not a second security boundary, so it asks for nothing. What
// it does check, every time, is that the account actually belongs to the
// workspace it names:
//
//   - The workspace id arrives from the client and is worth nothing until it
//     comes back from `findMembership`. Knowing an id, a name or a URL grants
//     nothing, and a workspace the account is not a member of is refused.
//   - Opening a workspace is a server-side fact. The session row changes;
//     the browser is told what happened but is never the authority.
//   - There is no workspace password, and there never was: the credential has
//     always belonged to the account.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuthAccount } from "@/lib/auth/guard";
import { findMembership, getTenant, setSessionTenant, touchMembership } from "@/lib/db";
import { isHospitalWorkspace } from "@/lib/hospital/context";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

/** One message for every refusal, so a refusal never reveals what exists. */
const REFUSED = "That workspace is not available to this account.";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthAccount(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  // Per account. Switching between your own workspaces is ordinary, so this is
  // set high enough never to interrupt it, and only stops a script walking
  // workspace ids to find one that answers differently.
  const limit = rateLimit(clientKey(request, `workspace-enter:${auth.user.id}`), 120, 5 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many attempts. Wait a few minutes and try again." } },
      { status: 429, headers: NO_STORE }
    );
  }

  const membership = findMembership(auth.user.id, id);
  const workspace = membership ? getTenant(membership.tenantId) : undefined;

  if (!membership || !workspace) {
    console.log(
      `WORKSPACE_ENTER_REFUSED user=${auth.user.id} reason=${membership ? "missing_workspace" : "no_membership"}`
    );
    return NextResponse.json({ error: { code: "refused", message: REFUSED } }, { status: 403, headers: NO_STORE });
  }

  setSessionTenant(auth.session.id, membership.tenantId);
  touchMembership(auth.user.id, membership.tenantId);
  console.log(`WORKSPACE_OPENED user=${auth.user.id} tenant=${membership.tenantId}`);

  return NextResponse.json(
    {
      workspace: {
        tenantId: workspace.id,
        name: workspace.name,
        role: membership.role,
        // Where to send the browser: the hospital panel, or the general one.
        isHospital: isHospitalWorkspace(workspace.id),
      },
    },
    { headers: NO_STORE }
  );
}
