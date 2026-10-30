import { resolveCallAgent } from "@/lib/providers/config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { notFound, ownedByTenant, requireAuth } from "@/lib/auth/guard";
import { getCallRecord, getCallRecordByAttemptId } from "@/lib/db";
import { fetchRecording, getRecordingAsMp3, isValidInteractionId } from "@/lib/recordings";
import { withId3Tag } from "@/lib/recordings/mp3";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/** Builds a download name people can recognise later, safe on any OS. */
function downloadName(leadName: string, when: string | null, extension: "mp3" | "wav"): string {
  const person = (leadName || "call").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "call";
  const date = when ? new Date(when) : new Date();
  const stamp = Number.isNaN(date.getTime())
    ? "unknown-date"
    : date.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `dialo-${person}-${stamp}.${extension}`;
}

/**
 * GET /api/calls/[id]/recording
 *
 * The call's audio, as MP3. `?download=1` serves it as an attachment, and
 * `?format=wav` serves the original WAV Sarvam sent, which is kept as the
 * archival copy.
 *
 * MP3 is the default because it is roughly a quarter of the size, plays
 * natively everywhere, and is what someone can actually attach to an email.
 * The WAV is never discarded, so the MP3 can always be re-encoded.
 *
 * Addressed by Tringlo's call id rather than Sarvam's interaction id: the
 * interaction id contains slashes and colons, and the browser has no business
 * handling provider identifiers anyway.
 *
 * Authenticated and tenant-scoped: this is a customer's recorded voice, and
 * one business must never be able to play another's calls.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/calls/[id]/recording">) {
  const limit = rateLimit(clientKey(request, "recording"), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const record = getCallRecord(id) || getCallRecordByAttemptId(id);

  // Another tenant's recording reports as missing, not forbidden: a 403 would
  // confirm the call exists.
  if (!record || !ownedByTenant(record, auth.tenantId)) {
    return notFound("No call found with that id.");
  }

  // Only a connected call was recorded. Saying so is more useful than a 404.
  if (record.status !== "connected" || !isValidInteractionId(record.providerInteractionId)) {
    return NextResponse.json(
      { error: "This call did not connect, so there is no recording." },
      { status: 404 }
    );
  }

  // MP3 unless the original is asked for by name.
  const wantsWav = request.nextUrl.searchParams.get("format") === "wav";

  // The agent this call ran on — recorded with the call, so changing the
  // workspace's agent later does not make old recordings unreachable.
  const agent = resolveCallAgent(record);
  if (!agent) {
    return NextResponse.json(
      { error: "This workspace's voice provider is not configured, so the recording cannot be fetched." },
      { status: 422 }
    );
  }

  const result = wantsWav
    ? await fetchRecording(record.providerInteractionId, agent)
    : await getRecordingAsMp3(record.providerInteractionId, agent);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.status });
  }

  const when = record.startedAt || record.requestedAt;
  const leadName = record.lead?.name ?? "call";

  // Titled, so the file reads "Call with Ananya Rao · 26 Sep 2026" in a
  // player or file manager rather than an anonymous blob. Added here rather
  // than cached, so a renamed lead is reflected.
  const audio = wantsWav
    ? result.audio
    : withId3Tag(result.audio, {
        title: `Call with ${leadName}${when ? ` · ${new Date(when).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}`,
        year: when ? String(new Date(when).getFullYear()) : undefined,
      });
  const total = audio.length;
  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = downloadName(leadName, when, wantsWav ? "wav" : "mp3");

  const headers: Record<string, string> = {
    "Content-Type": wantsWav ? "audio/wav" : "audio/mpeg",
    "Accept-Ranges": "bytes",
    // Private: this is a customer's voice. Revalidated every time, so a
    // browser can never replay an older copy — this URL once served WAV.
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
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
