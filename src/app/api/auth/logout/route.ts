// ============================================================
// POST /api/auth/logout
// ============================================================
//
// Destroys the session server-side and clears the cookie.
//
// Deleting the row is what makes this a real logout: an opaque token that is no
// longer in the table cannot be replayed, which is not true of a signed token
// that the client merely forgets.
// ============================================================

import { NextResponse } from "next/server";

import { clearedSessionCookie, extractSessionToken, hashSessionToken, isSecureRequest } from "@/lib/auth/sessions";
import { deleteSession } from "@/lib/db";

export async function POST(request: Request) {
  const token = extractSessionToken(request);
  if (token) deleteSession(hashSessionToken(token));

  // Always 200, cookie always cleared. Logging out of an already-dead session
  // is not an error, and reporting one would leave clients stuck holding a
  // token they cannot get rid of.
  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": clearedSessionCookie({ secure: isSecureRequest(request) }),
        "Cache-Control": "no-store",
      },
    }
  );
}
