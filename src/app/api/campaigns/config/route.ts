// ============================================================
// GET /api/campaigns/config
// ============================================================
//
// What the campaign wizard needs to know about the server's Sarvam setup:
// whether it is ready, which agent and number campaigns will use (masked),
// and which variables the agent accepts. Never the key or raw identifiers.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth/guard";
import { campaignConfig } from "@/lib/campaigns/service";
import { getAgentConfig, getCallingWindow } from "@/lib/db";
import { declaredVariableNames } from "@/lib/providers/sarvam/variables";

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 4 ? `${phone.startsWith("+") ? "+" : ""}${digits.slice(0, 2)}•••••${digits.slice(-4)}` : "••••";
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const config = campaignConfig(auth.tenantId);
  const agent = getAgentConfig(auth.tenantId);

  return NextResponse.json(
    {
      ready: config.ready,
      problems: config.problems,
      agent: {
        name: agent.agentName || null,
        company: agent.companyName || null,
        version: config.appVersion || null,
        configured: Boolean(config.appId),
      },
      phoneNumbers: config.phoneNumbers.map(maskPhone),
      webhookReachable: Boolean(config.webhookBase),
      cohortMode: config.cohortMode,
      variables: [...declaredVariableNames()].sort(),
      defaultTimezone: getCallingWindow(auth.tenantId).timezone || "Asia/Kolkata",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
