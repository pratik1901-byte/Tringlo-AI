// ============================================================
// Sarvam Voice Agents — Live Mid-Call RAG Knowledge Endpoint
// ============================================================
//
// Allows Sarvam Voice Agents API tools to query approved company
// knowledge during a live call for dynamic Q&A without exposing
// internal vector databases or unrelated company scopes.
//
// POST /api/integrations/sarvam/rag
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { buildAgentKnowledgeContext } from "@/lib/rag";

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate the request
    const authHeader =
      request.headers.get("Authorization") ||
      request.headers.get("X-API-Key") ||
      "";

    const serverApiKey = process.env.SARVAM_API_KEY?.trim() || "";
    const internalSecret = process.env.DIALO_INTERNAL_SECRET?.trim() || "";

    // The token must match a configured secret exactly. Accepting any non-empty
    // Authorization header, as an earlier version did, left this endpoint open to
    // anyone who sent one.
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isAuthorized =
      (internalSecret.length > 0 && token === internalSecret) ||
      (serverApiKey.length > 0 && token === serverApiKey);

    if (!isAuthorized) {
      return NextResponse.json(
        { error: "Unauthorized access to company knowledge." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const {
      company_id,
      company_name,
      companyName,
      product_id,
      product_name,
      query,
      question,
      user_message,
    } = body;

    // 2. Identify the company (strict scoping)
    const companyId =
      company_id ||
      company_name ||
      companyName;

    if (!companyId) {
      return NextResponse.json(
        { error: "Company identification (company_id or company_name) is required." },
        { status: 400 }
      );
    }

    // 3. Receive the customer query / question
    const searchQuery = (query || question || user_message || "").trim();
    if (!searchQuery) {
      return NextResponse.json(
        { error: "Query or question parameter is required." },
        { status: 400 }
      );
    }

    // 4. Tokenize query for scoped retrieval
    const queryKeywords = searchQuery
      .toLowerCase()
      .split(/[\s,?.!]+/)
      .filter((w: string) => w.length > 2);

    // 5. Retrieve approved, company-scoped knowledge
    const ragResult = buildAgentKnowledgeContext(companyId, undefined, queryKeywords);

    // 6. Return compact context and anti-hallucination instruction
    return NextResponse.json({
      companyId,
      product: product_name || product_id || null,
      query: searchQuery,
      knowledge_context: ragResult.compactContext,
      sourcesUsed: ragResult.sourcesUsed,
      disclaimer:
        "Only approved business facts are provided. If information is absent, do not invent answers.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[POST /api/integrations/sarvam/rag]", message);
    return NextResponse.json({ error: "Could not retrieve company knowledge." }, { status: 500 });
  }
}
