import { NextRequest, NextResponse } from "next/server";

import { getAgentConfig, getCallingWindow, saveAgentConfig, saveCallingWindow } from "@/lib/db";
import { requireAuth } from "@/lib/auth/guard";

/**
 * The agent configuration, stored server-side.
 *
 * The scheduler places callbacks with no browser involved, so the company and
 * product context has to live on the server. Holding it only in localStorage is
 * what made autonomous callbacks impossible.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    agentConfig: getAgentConfig(),
    callingWindow: getCallingWindow(),
  });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    const agentConfig = body?.agentConfig ? saveAgentConfig(body.agentConfig) : getAgentConfig();

    const callingWindow = body?.callingWindow
      ? saveCallingWindow({
          from: String(body.callingWindow.from || "09:00"),
          to: String(body.callingWindow.to || "20:00"),
          timezone: String(body.callingWindow.timezone || "Asia/Kolkata"),
        })
      : getCallingWindow();

    return NextResponse.json({ agentConfig, callingWindow });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PUT /api/agent-config]", message);
    return NextResponse.json({ error: "Could not save the configuration." }, { status: 500 });
  }
}
