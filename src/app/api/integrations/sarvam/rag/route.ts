// ============================================================
// Sarvam Voice Agents — live mid-call knowledge lookup
// ============================================================
//
// POST /api/integrations/sarvam/rag?k=<workspace webhook token>
//
// An agent asks this mid-call when a customer asks something its prompt does
// not cover. It answers with that workspace's approved knowledge and nothing
// else.
//
// The workspace is decided by the token in the URL — a secret Tringlo generated
// and registered with that workspace's agent. It is never taken from the body.
// An earlier version read `company_id` from the request, which meant anyone
// holding the one shared secret could ask for another company's knowledge by
// naming it.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { getAgentConfig } from "@/lib/db";
import { buildAgentKnowledgeContext } from "@/lib/rag";
import { clientKey, rateLimit } from "@/lib/security/rate-limit";
import { authenticateWebhook } from "@/lib/security/webhook-auth";

export async function POST(request: NextRequest) {
  const limit = rateLimit(clientKey(request, "rag"), 600, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  // A workspace token both authenticates the caller and says which workspace
  // it is. Nothing else is accepted: the server-wide token identifies no
  // workspace, so it cannot be used to read anyone's knowledge.
  const auth = authenticateWebhook(request);
  if (!auth.ok || !auth.tenantId) {
    return NextResponse.json(
      { error: "Unauthorized. This endpoint needs the workspace's own token." },
      { status: 401 }
    );
  }
  const tenantId = auth.tenantId;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const searchQuery = ["query", "question", "user_message"]
    .map((key) => (typeof body[key] === "string" ? (body[key] as string) : ""))
    .find((value) => value.trim())
    ?.trim();

  if (!searchQuery) {
    return NextResponse.json(
      { error: "Query or question parameter is required." },
      { status: 400 }
    );
  }

  const queryKeywords = searchQuery
    .toLowerCase()
    .split(/[\s,?.!]+/)
    .filter((word) => word.length > 2);

  // Built from this workspace's own company profile, under its own scope key.
  const result = buildAgentKnowledgeContext(tenantId, getAgentConfig(tenantId), queryKeywords);

  console.log(`RAG_QUERY tenant=${tenantId} sources=${result.sourcesUsed.length}`);

  return NextResponse.json(
    {
      // Deliberately no workspace id in the reply: the agent has no use for
      // it, and it is not something a transcript should carry.
      context: result.compactContext,
      sources: result.sourcesUsed,
      instruction:
        result.sourcesUsed.length > 0
          ? "Answer only from the context above. If it does not cover the question, say a colleague will confirm."
          : "There is no approved information about this. Say a colleague will confirm rather than guessing.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
