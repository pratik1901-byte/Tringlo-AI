// ============================================================
// /api/integrations/provider
// ============================================================
//
// The signed-in workspace's voice provider configuration: which Sarvam agent
// speaks for it, on which connection, from which number.
//
// Tringlo's own Sarvam credentials are not here. They belong to the platform,
// live in the server environment, and are never sent to a browser — this
// endpoint reports only whether they are present.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { publicProviderConfig, saveWorkspaceProvider } from "@/lib/providers/config";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json(publicProviderConfig(auth.tenantId), { headers: NO_STORE });
}

export async function PUT(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    outbound?: Record<string, unknown> | null;
    batch?: Record<string, unknown> | null;
    inbound?: Record<string, unknown> | null;
  } | null;
  if (!body) return NextResponse.json({ error: { message: "Invalid configuration." } }, { status: 400 });

  // Only the sections actually sent are touched, so saving one of them never
  // quietly clears another. The workspace is the signed-in one; nothing in the
  // body chooses it.
  const result = saveWorkspaceProvider(
    auth.tenantId,
    {
      outbound: body.outbound === undefined ? undefined : (body.outbound as never),
      batch: body.batch === undefined ? undefined : (body.batch as never),
      inbound: body.inbound === undefined ? undefined : (body.inbound as never),
    },
    auth.user.email
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: { message: result.problems[0], problems: result.problems } },
      { status: 400, headers: NO_STORE }
    );
  }

  return NextResponse.json(publicProviderConfig(auth.tenantId), { headers: NO_STORE });
}
