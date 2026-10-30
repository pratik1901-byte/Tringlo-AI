// ============================================================
// GET /api/auth/me
// ============================================================
//
// Who the caller is, according to the server.
//
// The client calls this on startup to decide between the app and the login
// screen. It deliberately does not trust its own stored copy of the user: a
// session can be revoked, expire, or belong to a deleted account while the app
// was closed, and only the server knows.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuthAccount, toPublicUser } from "@/lib/auth/guard";
import { findMembership, membershipsForUser } from "@/lib/db";
import { isHospitalWorkspace } from "@/lib/hospital/context";

export async function GET(request: Request) {
  // Who you are, not which workspace you are in. Asking for a workspace here
  // would make an account with none — or one that has not chosen yet — look
  // signed out, and bounce it to the login page instead of the selector.
  const auth = await requireAuthAccount(request);
  if (!auth.ok) return auth.response;

  const open = auth.session.tenantId ? findMembership(auth.user.id, auth.session.tenantId) : undefined;

  return NextResponse.json(
    {
      user: toPublicUser(auth.user, open?.tenantId),
      /** Null until a workspace has been opened; the client shows the selector. */
      activeTenantId: open?.tenantId ?? null,
      /**
       * Whether the open workspace runs the hospital panel.
       *
       * The shell reads this to decide which application somebody is in: a
       * hospital workspace gets the hospital panel rather than the general
       * one, which is the whole point of a workspace being a hospital.
       */
      isHospital: open?.tenantId ? isHospitalWorkspace(open.tenantId) : false,
      workspaceCount: membershipsForUser(auth.user.id).length,
      session: {
        expiresAt: auth.session.expiresAt,
        createdAt: auth.session.createdAt,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
