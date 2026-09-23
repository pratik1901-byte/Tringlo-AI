import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCallRecord, getCallRecordByAttemptId } from "@/lib/db";
import { fetchRecording, isValidInteractionId } from "@/lib/recordings";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/** Builds a download name people can recognise later, safe on any OS. */
function downloadName(leadName: string, when: string | null): string {
  const person = (leadName || "call").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "call";
  const date = when ? new Date(when) : new Date();
  const stamp = Number.isNaN(date.getTime())
    ? "unknown-date"
    : date.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `dialo-${person}-${stamp}.wav`;
}

/**
 * GET /api/calls/[id]/recording
 *
 * The call's audio, as Sarvam recorded it. `?download=1` serves it as an
 * attachment. Range requests are honoured so the player can seek.
 *
 * Addressed by Dialo's call id rather than Sarvam's interaction id: the
 * interaction id contains slashes and colons, and the browser has no business
 * handling provider identifiers anyway.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/calls/[id]/recording">) {
  const limit = rateLimit(clientKey(request, "recording"), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const { id } = await ctx.params;
  const record = getCallRecord(id) || getCallRecordByAttemptId(id);

  if (!record) {
    return NextResponse.json({ error: "No call found with that id." }, { status: 404 });
  }

  // Only a connected call was recorded. Saying so is more useful than a 404.
  if (record.status !== "connected" || !isValidInteractionId(record.providerInteractionId)) {
    return NextResponse.json(
      { error: "This call did not connect, so there is no recording." },
      { status: 404 }
    );
  }

  const result = await fetchRecording(record.providerInteractionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  const audio = result.audio;
  const total = audio.length;
  const download = request.nextUrl.searchParams.get("download") === "1";

  const headers: Record<string, string> = {
    "Content-Type": "audio/wav",
    "Accept-Ranges": "bytes",
    // Private: this is a customer's voice.
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${downloadName(
      record.lead?.name ?? "call",
      record.startedAt || record.requestedAt
    )}"`,
  };

  // --- Range requests, so seeking works ---
  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && !download) {
    let start = match[1] ? Number(match[1]) : NaN;
    let end = match[2] ? Number(match[2]) : NaN;

    if (Number.isNaN(start)) {
      // "bytes=-500" means the last 500 bytes.
      start = total - (Number.isNaN(end) ? total : end);
      end = total - 1;
    } else if (Number.isNaN(end) || end >= total) {
      end = total - 1;
    }

    if (start < 0 || start > end || start >= total) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }

    const chunk = audio.subarray(start, end + 1);
    return new NextResponse(new Uint8Array(chunk), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(chunk.length),
      },
    });
  }

  return new NextResponse(new Uint8Array(audio), {
    status: 200,
    headers: { ...headers, "Content-Length": String(total) },
  });
}
