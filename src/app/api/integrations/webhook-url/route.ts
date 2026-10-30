import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { getWebhookBaseUrl, saveWebhookBaseUrl } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";

/**
 * Whether this request may change where call results are delivered.
 *
 * The `Host` header cannot be trusted for this: it is set by the caller, so a
 * request arriving through the public tunnel can claim `Host: localhost` and
 * would have passed a host-only check. Pointing Tringlo's webhook at an attacker's
 * server would hand them every transcript.
 *
 * So: a shared secret when one is configured, and otherwise only a request that
 * shows no sign of having been proxied. Anything through Cloudflare carries
 * forwarding headers, which is what rules the tunnel path out.
 */
function isAuthorised(request: NextRequest): { ok: boolean; reason: string } {
  const secret = process.env.TRINGLO_INTERNAL_SECRET?.trim();

  if (secret && secret.length >= 16) {
    const provided = request.headers.get("x-tringlo-internal") ?? "";
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "bad_secret" };
    }
    return { ok: true, reason: "secret" };
  }

  // No secret configured: accept only a request that did not arrive through
  // Cloudflare. Only Cloudflare's own headers are used as that signal —
  // `x-forwarded-for` is added by the local dev server too, so treating it as
  // proof of a proxy rejected the launcher's own legitimate registration.
  const throughCloudflare =
    request.headers.get("cf-connecting-ip") || request.headers.get("cf-ray");

  if (throughCloudflare) return { ok: false, reason: "proxied" };

  const host = request.headers.get("host") || "";
  const local =
    host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");

  return local
    ? { ok: true, reason: "local" }
    : { ok: false, reason: "not_local" };
}

export async function GET() {
  return NextResponse.json({ webhookBaseUrl: getWebhookBaseUrl() });
}

/**
 * PUT /api/integrations/webhook-url
 *
 * Registers the public URL Sarvam should deliver results to.
 *
 * A dev tunnel gets a new hostname every restart and an env var cannot change
 * without restarting the server, so the launcher registers it here instead.
 */
export async function PUT(request: NextRequest) {
  const limit = rateLimit(clientKey(request, "webhook-url"), 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const auth = isAuthorised(request);
  if (!auth.ok) {
    console.warn(`WEBHOOK_URL_REGISTRATION_REFUSED reason=${auth.reason}`);
    return NextResponse.json(
      { error: "Not authorised to change the webhook URL." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const raw = typeof body?.webhookBaseUrl === "string" ? body.webhookBaseUrl.trim() : null;

    if (raw) {
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return NextResponse.json({ error: "webhookBaseUrl must be a valid URL." }, { status: 400 });
      }
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
        return NextResponse.json(
          { error: "webhookBaseUrl must be https (or localhost for local testing)." },
          { status: 400 }
        );
      }
    }

    const saved = saveWebhookBaseUrl(raw);
    console.log(`WEBHOOK_URL_REGISTERED via=${auth.reason} url=${saved ?? "(cleared)"}`);
    return NextResponse.json({ webhookBaseUrl: saved });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PUT /api/integrations/webhook-url]", message);
    return NextResponse.json({ error: "Could not register the webhook URL." }, { status: 500 });
  }
}
