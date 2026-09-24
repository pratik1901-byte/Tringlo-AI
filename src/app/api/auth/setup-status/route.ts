// ============================================================
// GET /api/auth/setup-status
// ============================================================
//
// Tells the login screen whether to show "sign in" or "create the first
// account".
//
// Unauthenticated by necessity — it is read before anyone can sign in. It
// discloses only whether any account exists and whether this particular
// caller could create one, which is the minimum the screen needs and reveals
// nothing about who the users are.
// ============================================================

import { NextResponse } from "next/server";

import { isLocalRequest } from "@/lib/auth/local-request";
import { countUsers } from "@/lib/db";
import { isMailConfigured } from "@/lib/mail/mailer";

export async function GET(request: Request) {
  const needsSetup = countUsers() === 0;

  return NextResponse.json(
    {
      needsSetup,
      // Whether *this* caller may create an account, so a browser on the public
      // URL is told to use the server machine rather than shown a form that
      // will fail. Unlike needsSetup this stays true once accounts exist:
      // further workspaces can still be added from the machine.
      canSetupHere: isLocalRequest(request),
      localRequest: isLocalRequest(request),
      // Whether "Forgot password" can email a code. Unlike workspace creation
      // it works from any network, because owning the inbox is the proof.
      resetByEmail: isMailConfigured(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
