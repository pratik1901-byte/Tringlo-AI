// ============================================================
// /api/customers/:id/memory/:memoryId
// ============================================================
//
// DELETE suppresses one memory — "that is not right", "do not bring that up".
// The row is kept, marked forgotten, so the agent is never told it and a later
// call repeating it does not bring it back. `?hard=1` erases the row instead.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { forgetMemoryItem, getCustomerProfile } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memoryId: string }> }
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id, memoryId } = await params;
  const notFound = () =>
    NextResponse.json(
      { error: { code: "not_found", message: "No such memory." } },
      { status: 404 }
    );

  if (!getCustomerProfile(auth.tenantId, id)) return notFound();

  const hard = new URL(request.url).searchParams.get("hard") === "1";
  if (!forgetMemoryItem(auth.tenantId, id, memoryId, { hard })) return notFound();

  console.log(`MEMORY_ITEM_FORGOTTEN customer=${id} tenant=${auth.tenantId} hard=${hard}`);
  return NextResponse.json({ ok: true, hard }, { headers: { "Cache-Control": "no-store" } });
}
