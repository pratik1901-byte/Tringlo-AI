// ============================================================
// Dialo AI — Webhook Reachability
// ============================================================
// Confirms that a call result can actually get back to Dialo before a call is
// placed.
//
// Sarvam delivers the outcome to APP_URL once. If that URL is a dead tunnel or
// an unreachable deployment, the call still happens — a real person's phone
// rings, a real conversation occurs — and the transcript, outcome and follow-up
// are lost for good. That has already happened thirteen times in this project.
//
// So the URL is probed first, and a call is refused rather than placed blind.
// ============================================================

const PROBE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;

export interface ReachabilityResult {
  reachable: boolean;
  url: string;
  detail: string;
}

let cached: { at: number; result: ReachabilityResult } | null = null;

/**
 * Fetches the webhook endpoint's health probe through the public URL.
 *
 * Deliberately not cached on failure for long: an operator who starts a tunnel
 * should not have to wait out a stale negative before they can call.
 */
export async function checkWebhookReachable(webhookBaseUrl: string): Promise<ReachabilityResult> {
  const url = `${webhookBaseUrl.replace(/\/+$/, "")}/api/webhooks/sarvam/outbound`;

  if (cached && cached.result.url === url && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  let result: ReachabilityResult;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!response.ok) {
      result = {
        reachable: false,
        url,
        detail: `The webhook URL answered with HTTP ${response.status}.`,
      };
    } else {
      const body = (await response.json().catch(() => null)) as { service?: string } | null;
      // Confirms we reached *this* app, not a tunnel landing page or a stale
      // deployment that happens to return 200 for anything.
      result =
        body?.service === "dialo-sarvam-webhook"
          ? { reachable: true, url, detail: "Call results can reach Dialo." }
          : {
              reachable: false,
              url,
              detail: "The webhook URL is serving something other than this Dialo instance.",
            };
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "it did not respond in time"
        : error instanceof Error
          ? error.message
          : "it could not be reached";
    result = { reachable: false, url, detail: `Could not reach the webhook URL — ${message}.` };
  }

  // Only a positive result is worth caching; retry failures promptly.
  cached = result.reachable ? { at: Date.now(), result } : null;
  return result;
}

/** Lets an operator dial anyway, knowingly, when they have a reason to. */
export function reachabilityCheckDisabled(): boolean {
  return process.env.ALLOW_CALLS_WITHOUT_WEBHOOK === "true";
}
