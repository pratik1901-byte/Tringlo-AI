// ============================================================
// PATCH /api/account/profile
// ============================================================
//
// Changes the signed-in person's display name, and — for the workspace owner —
// the workspace's name. Neither is a security credential, so no password is
// asked for; email and password have their own routes that do ask.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, toPublicUser } from "@/lib/auth/guard";
import { getTenant, saveTenant, updateUser } from "@/lib/db";

const MAX_LENGTH = 80;

function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

/** Trims, collapses inner whitespace, and strips control characters. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  let body: { name?: unknown; workspaceName?: unknown };
  try {
    body = await request.json();
  } catch {
    return fail(400, "invalid_body", "Expected a JSON body.");
  }

  const name = body.name === undefined ? undefined : cleanName(body.name);
  const workspaceName =
    body.workspaceName === undefined ? undefined : cleanName(body.workspaceName);

  if (name !== undefined) {
    if (!name) return fail(400, "invalid_name", "Enter your name.");
    if (name.length > MAX_LENGTH) return fail(400, "invalid_name", `Keep your name under ${MAX_LENGTH} characters.`);
  }

  if (workspaceName !== undefined) {
    if (auth.user.role !== "owner") {
      return fail(403, "not_owner", "Only the workspace owner can rename the workspace.");
    }
    if (!workspaceName) return fail(400, "invalid_workspace", "Enter a workspace name.");
    if (workspaceName.length > MAX_LENGTH) {
      return fail(400, "invalid_workspace", `Keep the workspace name under ${MAX_LENGTH} characters.`);
    }
  }

  const user = name !== undefined ? updateUser(auth.user.id, { name }) ?? auth.user : auth.user;

  if (workspaceName !== undefined) {
    const tenant = getTenant(auth.tenantId);
    if (tenant) saveTenant({ ...tenant, name: workspaceName });
  }

  console.log(
    `ACCOUNT_PROFILE_UPDATED user=${auth.user.id} name=${name !== undefined} workspace=${workspaceName !== undefined}`
  );

  return NextResponse.json(
    { ok: true, user: toPublicUser(user, auth.tenantId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
