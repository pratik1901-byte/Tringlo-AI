// ============================================================
// Hospital — the hospital server integration
// ============================================================
//
// Where an administrator says how Tringlo reaches the hospital's own system,
// and where the panel finds out whether it can.
//
// The credential is write-only through this endpoint. It goes in, it is stored
// server-side on the workspace's profile, and no response from here ever
// contains it — `hasCredential` is a boolean, which is all a browser needs to
// know. Clearing it takes an explicit null, so a form that omits the field
// cannot wipe it by accident.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { refreshProviderDirectory } from "@/lib/hospital/directory";
import { HIS_CAPABILITIES, hospitalServer, integrationConfig, integrationStatus, type HisCapability } from "@/lib/hospital/his";
import { defaultIntegrationConfig } from "@/lib/hospital/records";
import { audit, hospitalProfile, updateHospitalProfile } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const config = integrationConfig(auth.tenantId);
  return NextResponse.json(
    {
      status: integrationStatus(auth.tenantId),
      // Everything except the token.
      config: {
        mode: config.mode,
        baseUrl: config.baseUrl,
        capabilities: config.capabilities,
        endpoints: config.endpoints,
        timeoutMs: config.timeoutMs,
        reportDestination: config.reportDestination,
        updatedAt: config.updatedAt,
      },
      allCapabilities: HIS_CAPABILITIES,
      /**
       * What a hospital has to hand over for the live integration to work.
       * Stated here so the panel can show it rather than implying a connection
       * that does not exist.
       */
      required: [
        "The base URL of the hospital's API.",
        "A credential Tringlo may authenticate with, which stays on the server.",
        "Which of the operations below the API supports.",
        "The request path for each supported operation, from the hospital's own documentation.",
      ],
    },
    { headers: noStore }
  );
}

export async function PUT(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const current = integrationConfig(auth.tenantId);
  const changed: string[] = [];

  const mode = body?.mode === "live" || body?.mode === "demo" ? body.mode : current.mode;
  if (mode !== current.mode) changed.push(`mode → ${mode}`);

  let baseUrl = current.baseUrl;
  if (body?.baseUrl !== undefined) {
    const entered = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    if (entered) {
      try {
        const url = new URL(entered);
        if (!/^https?:$/i.test(url.protocol)) throw new Error("not http");
        if (url.protocol === "http:" && url.hostname !== "localhost") {
          return NextResponse.json(
            { error: { message: "The hospital server address must use HTTPS. Patient data is not sent unencrypted." } },
            { status: 400, headers: noStore }
          );
        }
      } catch {
        return NextResponse.json({ error: { message: "That is not a valid URL." } }, { status: 400, headers: noStore });
      }
    }
    baseUrl = entered || null;
    if (baseUrl !== current.baseUrl) changed.push("base URL");
  }

  // Write-only. An absent field leaves the stored credential alone; an
  // explicit null clears it. The value itself is never read back out.
  let token = current.token;
  if (body?.token !== undefined) {
    token = typeof body.token === "string" && body.token.trim() ? body.token.trim() : null;
    changed.push(token ? "credential set" : "credential cleared");
  }

  const capabilities = Array.isArray(body?.capabilities)
    ? (body.capabilities as unknown[]).filter((entry): entry is HisCapability =>
        HIS_CAPABILITIES.includes(entry as HisCapability)
      )
    : current.capabilities;
  if (Array.isArray(body?.capabilities)) changed.push("supported operations");

  const endpoints: Record<string, string> = { ...current.endpoints };
  if (body?.endpoints && typeof body.endpoints === "object") {
    for (const [key, value] of Object.entries(body.endpoints as Record<string, unknown>)) {
      if (!HIS_CAPABILITIES.includes(key as HisCapability)) continue;
      const path = typeof value === "string" ? value.trim() : "";
      if (path) endpoints[key] = path;
      else delete endpoints[key];
    }
    changed.push("request paths");
  }

  const timeoutMs =
    typeof body?.timeoutMs === "number" && body.timeoutMs >= 1000 && body.timeoutMs <= 60_000
      ? Math.round(body.timeoutMs)
      : current.timeoutMs;

  const reportDestination =
    body?.reportDestination === "hospital_server" || body?.reportDestination === "panel_review"
      ? body.reportDestination
      : current.reportDestination;
  if (reportDestination !== current.reportDestination) changed.push(`reports → ${reportDestination}`);

  updateHospitalProfile(
    auth.tenantId,
    {
      integration: {
        ...defaultIntegrationConfig(),
        ...current,
        mode,
        baseUrl,
        token,
        capabilities,
        endpoints,
        timeoutMs,
        reportDestination,
        updatedAt: new Date().toISOString(),
      },
    },
    auth.user.id
  );
  // The credential is deliberately not in the detail.
  audit(auth.tenantId, auth.user.id, "integration.updated", "hospital_server", changed.join(", ") || "no change");

  return NextResponse.json({ status: integrationStatus(auth.tenantId) }, { headers: noStore });
}

/** Checks the connection for real, and refreshes the provider directory. */
export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const server = hospitalServer(auth.tenantId);
  const health = await server.health();
  const profile = hospitalProfile(auth.tenantId);
  const config = integrationConfig(auth.tenantId);

  const lastCheck = {
    at: new Date().toISOString(),
    ok: health.ok,
    detail: health.ok ? health.data.detail : health.problem,
  };
  updateHospitalProfile(auth.tenantId, { integration: { ...config, lastCheck } }, auth.user.id);

  const directory = await refreshProviderDirectory(auth.tenantId);

  return NextResponse.json(
    {
      ok: health.ok,
      detail: lastCheck.detail,
      mode: server.mode,
      hospital: profile.name,
      directory: directory.ok
        ? { ok: true, count: directory.count }
        : { ok: false, problem: directory.problem },
      status: integrationStatus(auth.tenantId),
    },
    { headers: noStore }
  );
}
