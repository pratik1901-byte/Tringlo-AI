import { NextRequest, NextResponse } from "next/server";

import { notFound, ownedByTenant, requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { getCallRecord, getCallRecords } from "@/lib/db";

/** A page the client can render without holding thousands of rows in memory. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/records
 *
 * Call records for the caller's business, newest first. With `?id=` it returns
 * one record. This is the only source the Results, Dashboard and Analytics
 * screens read from.
 *
 * Paginated with `?limit=` and `?offset=`: the list grows by one row per call
 * placed, and a client that loads every row is a client that gets slower every
 * day. `total` is returned so the caller can page without guessing.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const id = request.nextUrl.searchParams.get("id");

    if (id) {
      const record = getCallRecord(id);
      // Another tenant's record is reported as missing, not as forbidden: a 403
      // would confirm that the id exists.
      if (!record || !ownedByTenant(record, auth.tenantId)) {
        return notFound("Record not found.");
      }
      return NextResponse.json({ record });
    }

    const all = scopeToTenant(getCallRecords(), auth.tenantId);

    const params = request.nextUrl.searchParams;
    const limit = Math.min(
      Math.max(Number(params.get("limit")) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const offset = Math.max(Number(params.get("offset")) || 0, 0);

    return NextResponse.json({
      records: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GET /api/records]", message);
    return NextResponse.json({ error: "Could not load call records." }, { status: 500 });
  }
}
