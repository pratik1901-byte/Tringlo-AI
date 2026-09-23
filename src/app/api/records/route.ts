import { NextRequest, NextResponse } from "next/server";

import { getCallRecord, getCallRecords } from "@/lib/db";

/**
 * GET /api/records
 *
 * All call records, newest first. With `?id=` it returns one record. This is the
 * only source the Results, Dashboard and Analytics screens read from.
 */
export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");

    if (id) {
      const record = getCallRecord(id);
      if (!record) {
        return NextResponse.json({ error: "Record not found" }, { status: 404 });
      }
      return NextResponse.json({ record });
    }

    return NextResponse.json({ records: getCallRecords() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GET /api/records]", message);
    return NextResponse.json({ error: "Could not load call records." }, { status: 500 });
  }
}
