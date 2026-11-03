// ============================================================
// Tringlo AI — Call Recordings
// ============================================================
//
// Sarvam does not put a recording in the completion webhook: the payload has a
// `recording_url` key, but it is null on every call. The documented path is the
// Analytics API:
//
//   GET https://apps.sarvam.ai/api/analytics/v1/{org}/{workspace}/{app}/recordings/{interaction_id}
//
// which returns the call audio directly as `audio/wav`.
//
// Recordings are fetched with the server's API key and saved to disk the first
// time they are needed, so a call's audio stays available after Sarvam's own
// retention ends and each one is only downloaded from Sarvam once. The browser
// never sees the API key or the Sarvam URL — it asks Tringlo, by call id.
// ============================================================

import fs from "node:fs";
import path from "node:path";

import { isStandardMp3, wavToMp3 } from "@/lib/recordings/mp3";
import { getObject, isObjectStoreConfigured, putObject } from "@/lib/storage/object-store";
import type { PlatformCredentials } from "@/lib/providers/types";

/** Where a call's recording lives in object storage. */
const recordingObjectKey = (interactionId: string) => `recordings/${encodeURIComponent(interactionId)}.mp3`;

const RECORDINGS_DIR = path.join(process.cwd(), "data", "recordings");
const SARVAM_ANALYTICS = "https://apps.sarvam.ai/api/analytics/v1";

/** Tringlo's credentials plus the agent the call ran on. */
export interface CallAgent {
  credentials: PlatformCredentials;
  appId: string;
}

/**
 * Sarvam interaction ids look like `20260921/777ccdb9-21:17:05-a68fd3b4`.
 * Anything else is refused before it can reach a URL or a file path.
 */
const INTERACTION_ID = /^\d{8}\/[A-Za-z0-9:_-]{1,100}$/;

export function isValidInteractionId(id: string | null | undefined): id is string {
  return typeof id === "string" && INTERACTION_ID.test(id);
}

/**
 * A filename that is safe on every OS and cannot escape the recordings folder:
 * the slash and colons in an interaction id are illegal on Windows, and a slash
 * would otherwise be read as a directory.
 */
function fileFor(interactionId: string, extension: "wav" | "mp3" = "wav"): string {
  const safe = interactionId.replace(/[^A-Za-z0-9-]/g, "_");
  const resolved = path.join(RECORDINGS_DIR, `${safe}.${extension}`);
  // Belt and braces: the validated id cannot produce this, but a future change
  // to the regex must not be able to turn this into a path traversal.
  if (!resolved.startsWith(RECORDINGS_DIR + path.sep)) {
    throw new Error("Refusing a recording path outside the recordings folder.");
  }
  return resolved;
}

export type RecordingResult =
  | { ok: true; audio: Buffer; source: "cache" | "sarvam" }
  | { ok: false; status: number; reason: string };

/** The saved copy, if one exists. */
export function readSavedRecording(interactionId: string): Buffer | null {
  const file = fileFor(interactionId);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

export function hasSavedRecording(interactionId: string): boolean {
  return isValidInteractionId(interactionId) && fs.existsSync(fileFor(interactionId));
}

/**
 * Fetches a recording from Sarvam and saves it.
 *
 * Only a genuine WAV body is saved — an error page or a JSON message stored
 * under a `.wav` name would play as silence and never be re-fetched.
 */
export async function fetchRecording(interactionId: string, agent: CallAgent): Promise<RecordingResult> {
  if (!isValidInteractionId(interactionId)) {
    return { ok: false, status: 400, reason: "This call has no valid interaction id." };
  }

  const cached = readSavedRecording(interactionId);
  if (cached) return { ok: true, audio: cached, source: "cache" };

  const { apiKey, orgId: org, workspaceId: workspace } = agent.credentials;
  const app = agent.appId;

  if (!apiKey || !org || !workspace || !app) {
    return { ok: false, status: 503, reason: "Sarvam is not configured on this server." };
  }

  const url = `${SARVAM_ANALYTICS}/${encodeURIComponent(org)}/${encodeURIComponent(
    workspace
  )}/${encodeURIComponent(app)}/recordings/${interactionId}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "network error";
    return { ok: false, status: 502, reason: `Could not reach Sarvam: ${message}` };
  }

  if (!response.ok) {
    // Sarvam's message is logged, not returned: it may echo request details.
    const body = (await response.text().catch(() => "")).slice(0, 200);
    console.warn(`RECORDING_FETCH_FAILED interaction=${interactionId} http=${response.status} ${body}`);
    return {
      ok: false,
      status: response.status === 404 ? 404 : 502,
      reason:
        response.status === 404
          ? "Sarvam has no recording for this call yet."
          : `Sarvam returned HTTP ${response.status} for this recording.`,
    };
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length < 44 || audio.subarray(0, 4).toString("ascii") !== "RIFF") {
    console.warn(`RECORDING_NOT_AUDIO interaction=${interactionId} bytes=${audio.length}`);
    return { ok: false, status: 502, reason: "Sarvam did not return audio for this call." };
  }

  try {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    const file = fileFor(interactionId);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, audio);
    fs.renameSync(tmp, file);
    console.log(`RECORDING_SAVED interaction=${interactionId} bytes=${audio.length}`);
  } catch (error: unknown) {
    // Still serve it; saving is a convenience, not a condition for playback.
    console.error("RECORDING_SAVE_FAILED", error instanceof Error ? error.message : error);
  }

  return { ok: true, audio, source: "sarvam" };
}

/**
 * Saves a recording in the background after a call connects.
 *
 * The audio is not always ready the instant the webhook arrives, so this waits
 * a little and retries a few times. Failure is harmless: the recording is also
 * fetched on demand the first time someone plays or downloads it.
 */
export function prefetchRecordingLater(interactionId: string, agent: CallAgent): void {
  if (!isValidInteractionId(interactionId) || hasSavedRecording(interactionId)) return;

  const delays = [15_000, 60_000, 300_000];
  const attempt = async (index: number) => {
    const result = await fetchRecording(interactionId, agent).catch(() => null);
    if (result?.ok || index >= delays.length - 1) return;
    setTimeout(() => attempt(index + 1), delays[index + 1]);
  };

  setTimeout(() => attempt(0), delays[0]);
}


// ------------------------------------------------------------
// MP3
// ------------------------------------------------------------
//
// The WAV stays the archival copy — it is what Sarvam sent, and re-encoding
// from it is always possible. The MP3 is a derived artefact, cached beside it
// so each call is encoded once rather than on every play.

export type Mp3Result =
  | { ok: true; audio: Buffer; source: "cache" | "encoded" }
  | { ok: false; status: number; reason: string };

/** The saved MP3, if this call has already been encoded. */
export function readSavedMp3(interactionId: string): Buffer | null {
  if (!isValidInteractionId(interactionId)) return null;
  const file = fileFor(interactionId, "mp3");
  if (!fs.existsSync(file)) return null;
  const saved = fs.readFileSync(file);
  // Encoded before resampling existed, as MPEG-2.5; re-encode rather than
  // keep serving a file some players reject.
  return isStandardMp3(saved) ? saved : null;
}

/**
 * Returns the call as MP3, fetching and encoding it if needed.
 *
 * Failure to cache is not failure to serve: if the disk write fails the audio
 * is still returned, and the next request simply encodes it again.
 */
export async function getRecordingAsMp3(interactionId: string, agent: CallAgent): Promise<Mp3Result> {
  if (!isValidInteractionId(interactionId)) {
    return { ok: false, status: 400, reason: "This call has no valid interaction id." };
  }

  const cached = readSavedMp3(interactionId);
  if (cached) return { ok: true, audio: cached, source: "cache" };

  // The durable copy. On a disk-less host the local cache above is wiped on
  // restart, so object storage is where a once-encoded recording survives —
  // served straight back without re-fetching from the provider.
  if (isObjectStoreConfigured()) {
    try {
      const fromStore = await getObject(recordingObjectKey(interactionId));
      if (fromStore && fromStore.length > 0 && isStandardMp3(fromStore)) {
        return { ok: true, audio: fromStore, source: "cache" };
      }
    } catch (error: unknown) {
      console.error("RECORDING_S3_READ_FAILED", error instanceof Error ? error.message : error);
    }
  }

  const source = await fetchRecording(interactionId, agent);
  if (!source.ok) return source;

  const encoded = await wavToMp3(source.audio);
  if (!encoded.ok) {
    console.warn(`RECORDING_MP3_FAILED interaction=${interactionId} reason=${encoded.reason}`);
    return {
      ok: false,
      status: 415,
      // Says what the audio actually is, so an unexpected codec from Sarvam is
      // diagnosable rather than just "conversion failed".
      reason: `This recording could not be converted to MP3. ${encoded.reason}`,
    };
  }

  try {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
    const file = fileFor(interactionId, "mp3");
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, encoded.mp3);
    fs.renameSync(tmp, file);
    console.log(
      `RECORDING_MP3_SAVED interaction=${interactionId} wav=${source.audio.length} mp3=${encoded.mp3.length}`
    );
  } catch (error: unknown) {
    console.error("RECORDING_MP3_SAVE_FAILED", error instanceof Error ? error.message : error);
  }

  // Persist to object storage so it survives a disk-less host's restart. Not
  // awaited — the audio is already being returned, and a store hiccup must not
  // fail playback.
  if (isObjectStoreConfigured()) {
    void putObject(recordingObjectKey(interactionId), encoded.mp3, "audio/mpeg").catch((error: unknown) =>
      console.error("RECORDING_S3_SAVE_FAILED", error instanceof Error ? error.message : error)
    );
  }

  return { ok: true, audio: encoded.mp3, source: "encoded" };
}
