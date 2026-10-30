// ============================================================
// GET /api/workspaces
// ============================================================
//
// The workspaces this account may open — and only those. A workspace the
// account has no membership in is not listed, not counted, and not hinted at,
// because the existence of another company is itself that company's business.
//
// Nothing here describes what is inside a workspace: a name, an industry and
// the caller's own role, which is what the selector needs to draw a card.
// ============================================================

import { NextResponse } from "next/server";

import { isHospitalWorkspace } from "@/lib/hospital/context";

import { requireAuthAccount } from "@/lib/auth/guard";
import { getAgentConfig, getTenant, membershipsForUser, setSessionTenant, touchMembership } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { createWorkspace, readWorkspaceDraft } from "@/lib/workspaces/create";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  // Deliberately not requireAuth: choosing a workspace happens before one is
  // open, so requiring one here would make the selector unreachable.
  const auth = await requireAuthAccount(request);
  if (!auth.ok) return auth.response;

  const workspaces = membershipsForUser(auth.user.id)
    .map((membership) => {
      const tenant = getTenant(membership.tenantId);
      if (!tenant) return null;
      const profile = getAgentConfig(membership.tenantId);
      return {
        tenantId: tenant.id,
        name: tenant.name,
        companyName: profile?.companyName?.trim() || tenant.name,
        industry: profile?.industry?.trim() || null,
        role: membership.role,
        lastAccessedAt: membership.lastAccessedAt,
        createdAt: tenant.createdAt,
        // Whether selecting this opens the hospital panel rather than the
        // general one. Read from the enablement flag, never inferred.
        isHospital: isHospitalWorkspace(tenant.id),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    // Most recently opened first; never opened falls back to newest workspace.
    .sort((a, b) =>
      String(b.lastAccessedAt ?? b.createdAt).localeCompare(String(a.lastAccessedAt ?? a.createdAt))
    );

  return NextResponse.json(
    {
      workspaces,
      activeTenantId: auth.session.tenantId || null,
      account: { email: auth.user.email, name: auth.user.name },
    },
    { headers: NO_STORE }
  );
}

/**
 * POST /api/workspaces — an authenticated account adds another workspace.
 *
 * Deliberately separate from /api/auth/bootstrap, which creates the *first*
 * account and stays restricted to the server machine or an internal secret.
 * Adding a company to an account you are already signed into is an ordinary
 * application action, not a privileged one, so it lives here with ordinary
 * session authentication.
 *
 * The owner is the authenticated account and nothing else: no user id is read
 * from the body, so a request cannot nominate someone else as owner.
 */
export async function POST(request: Request) {
  const auth = await requireAuthAccount(request);
  if (!auth.ok) return auth.response;

  const limit = rateLimit(clientKey(request, `workspace-create:${auth.user.id}`), 10, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many workspaces created. Try again later." } },
      { status: 429, headers: NO_STORE }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: { code: "invalid_body", message: "Expected a JSON body." } }, { status: 400, headers: NO_STORE });
  }

  const draft = readWorkspaceDraft(body);
  const result = createWorkspace(draft, auth.user.id, auth.user.id);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "incomplete_setup", message: result.problems[0], problems: result.problems } },
      { status: 400, headers: NO_STORE }
    );
  }

  // Land in what was just created, rather than back where they were.
  setSessionTenant(auth.session.id, result.tenant.id);
  touchMembership(auth.user.id, result.tenant.id);

  return NextResponse.json(
    { workspace: { tenantId: result.tenant.id, name: result.tenant.name, role: "owner" } },
    { status: 201, headers: NO_STORE }
  );
}
