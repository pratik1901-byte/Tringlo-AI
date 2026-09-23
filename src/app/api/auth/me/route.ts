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

import { requireAuth, toPublicUser } from "@/lib/auth/guard";

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    {
      user: toPublicUser(auth.user),
      session: {
        expiresAt: auth.session.expiresAt,
        createdAt: auth.session.createdAt,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
