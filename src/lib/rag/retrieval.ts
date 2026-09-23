// ============================================================
// Scoped RAG Retrieval
// ============================================================
//
// Builds a company's approved knowledge from its saved Agent Configuration, and
// returns only the parts relevant to a given call.
//
// Two rules this file exists to hold:
//
//   1. Nothing here is invented. An earlier version seeded every company with
//      "Features: automated creation, high performance, enterprise security,
//      24/7 reliability" — claims no customer had configured, which the agent
//      could then assert to a real prospect about any product.
//
//   2. The knowledge is rebuilt when the configuration changes. It used to be
//      cached per company for the life of the process, so editing a product
//      description on the website never reached a call.
// ============================================================

import { knowledgeRegistry } from "./knowledge";
import { parseFaqs } from "@/lib/providers/sarvam/context";
import type { AgentConfig } from "@/lib/types";

export interface RetrievalResult {
  compactContext: string;
  sourcesUsed: Array<{ document_type: string; title: string; section: string }>;
}

/** Cheap fingerprint of the fields the knowledge is built from. */
function configFingerprint(config?: Partial<AgentConfig>): string {
  const relevant = [
    config?.companyName,
    config?.companyDescription,
    config?.industry,
    config?.productName,
    config?.productDescription,
    config?.pricing,
    config?.faqs,
    config?.salesObjective,
    config?.objectives,
    config?.conversationGuidelines,
    config?.targetAudience,
    config?.qualifyingCriteria,
    config?.disqualifyingCriteria,
  ].join("\u0000");

  let hash = 5381;
  for (let i = 0; i < relevant.length; i++) {
    hash = ((hash << 5) + hash + relevant.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

const builtFingerprints = new Map<string, string>();

interface DocInput {
  document_type:
    | "company_information"
    | "products"
    | "pricing"
    | "faqs"
    | "sales_guidelines"
    | "compliance_rules";
  title: string;
  section: string;
  content: string;
  keywords: string[];
}

function words(...parts: Array<string | undefined>): string[] {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .flatMap((part) => part.toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length > 2);
}

/**
 * Turns the saved configuration into approved knowledge documents.
 * A field the business left blank produces no document — silence rather than a
 * plausible-sounding default.
 */
function buildDocuments(companyId: string, config?: Partial<AgentConfig>): DocInput[] {
  const company = config?.companyName?.trim() || companyId;
  const product = config?.productName?.trim();
  const docs: DocInput[] = [];

  const companyDescription = config?.companyDescription?.trim();
  if (companyDescription || config?.industry?.trim()) {
    docs.push({
      document_type: "company_information",
      title: "Company",
      section: "Overview",
      content: [
        `Company: ${company}.`,
        config?.industry?.trim() ? `Industry: ${config.industry.trim()}.` : "",
        companyDescription ? `About: ${companyDescription}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      keywords: ["company", "who", "about", "organisation", ...words(company, config?.industry)],
    });
  }

  const productDescription = config?.productDescription?.trim();
  if (product || productDescription) {
    docs.push({
      document_type: "products",
      title: "Product",
      section: "Description",
      content: [
        product ? `Product: ${product}.` : "",
        productDescription ? `What it is: ${productDescription}` : "",
        config?.targetAudience?.trim() ? `Who it is for: ${config.targetAudience.trim()}` : "",
        config?.features?.trim() ? `Features: ${config.features.trim()}` : "",
        config?.benefits?.trim() ? `Benefits: ${config.benefits.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      keywords: [
        "product",
        "what is",
        "does",
        "service",
        "feature",
        "work",
        ...words(product, productDescription, config?.targetAudience),
      ],
    });
  }

  if (config?.pricing?.trim()) {
    docs.push({
      document_type: "pricing",
      title: "Pricing",
      section: "Configured pricing",
      content: config.pricing.trim(),
      keywords: ["price", "pricing", "cost", "how much", "plan", "subscription", "fee"],
    });
  }

  // Each FAQ is its own document so a question retrieves the one that answers it,
  // rather than pulling the whole FAQ list into every call.
  for (const [index, faq] of parseFaqs(config?.faqs || "").entries()) {
    docs.push({
      document_type: "faqs",
      title: `FAQ ${index + 1}`,
      section: faq.question,
      content: `Q: ${faq.question}\nA: ${faq.answer}`,
      keywords: words(faq.question),
    });
  }

  if (config?.conversationGuidelines?.trim()) {
    docs.push({
      document_type: "sales_guidelines",
      title: "Conversation guidelines",
      section: "Configured guidance",
      content: config.conversationGuidelines.trim(),
      keywords: ["guideline", "process", "next step", "approach"],
    });
  }

  const qualifying = config?.qualifyingCriteria?.trim();
  const disqualifying = config?.disqualifyingCriteria?.trim();
  if (qualifying || disqualifying) {
    docs.push({
      document_type: "sales_guidelines",
      title: "Qualification",
      section: "Configured criteria",
      // Only what the business configured. Dialo adds no qualification rules of
      // its own — inventing one is how "personal use is not a fit" reached a call
      // for a product built for families.
      content: [
        qualifying ? `A good fit: ${qualifying}` : "",
        disqualifying ? `Not a fit: ${disqualifying}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      keywords: ["fit", "qualify", "suitable", "right for me", "eligible"],
    });
  }

  // Behavioural rules, not business claims, so these are safe to apply generally.
  docs.push({
    document_type: "compliance_rules",
    title: "Truthfulness",
    section: "Rules",
    content: [
      "Answer only from the approved information above.",
      "Never invent pricing, discounts, features, partnerships, certifications or guarantees.",
      "Never narrow or extend who the product is for beyond what is stated above.",
      'If asked something the approved information does not cover, say: "I don\'t want to give you incorrect information — I can have a colleague confirm that for you."',
      `If asked whether you are an AI, say yes, you are an AI assistant representing ${company}.`,
      "If the person asks not to be called again, acknowledge it and end the call politely.",
      "If the person asks for a human, agree and take their details.",
    ].join("\n"),
    keywords: ["ai", "human", "opt out", "stop calling", "unsure", "guarantee"],
  });

  return docs;
}

const MAX_CHUNKS = 6;

/**
 * Retrieves the approved knowledge relevant to this call.
 *
 * Ranks by keyword overlap and returns a bounded set, so a call carries the
 * company, the product and whatever the query touches — not the whole index.
 */
export function buildAgentKnowledgeContext(
  companyId: string,
  agentConfig?: Partial<AgentConfig>,
  queryKeywords?: string[]
): RetrievalResult {
  const fingerprint = configFingerprint(agentConfig);

  // Rebuild when the configuration has changed since this scope was registered.
  if (builtFingerprints.get(companyId) !== fingerprint) {
    knowledgeRegistry.registerKnowledge(companyId, buildDocuments(companyId, agentConfig));
    builtFingerprints.set(companyId, fingerprint);
  }

  const scope = knowledgeRegistry.getScope(companyId);
  const approved = scope?.chunks.filter((chunk) => chunk.metadata.approved) ?? [];

  if (approved.length === 0) {
    return {
      compactContext: "",
      sourcesUsed: [],
    };
  }

  const terms = (queryKeywords ?? [])
    .flatMap((keyword) => keyword.toLowerCase().split(/[^a-z0-9]+/))
    .filter((word) => word.length > 2);

  const ranked = approved
    .map((chunk) => {
      let score = 0;

      // Company, product and compliance always travel: the agent needs to know
      // what it is selling before it can discover anything.
      if (
        chunk.metadata.document_type === "company_information" ||
        chunk.metadata.document_type === "products" ||
        chunk.metadata.document_type === "compliance_rules"
      ) {
        score += 100;
      }

      const haystack = chunk.content.toLowerCase();
      for (const term of terms) {
        if (chunk.keywords.some((keyword) => keyword.toLowerCase().includes(term))) score += 3;
        if (haystack.includes(term)) score += 2;
      }

      return { chunk, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHUNKS);

  const lines: string[] = ["=== APPROVED COMPANY KNOWLEDGE ==="];
  const sourcesUsed: RetrievalResult["sourcesUsed"] = [];

  for (const { chunk } of ranked) {
    lines.push(`[${chunk.metadata.title}]`);
    lines.push(chunk.content);
    lines.push("");

    sourcesUsed.push({
      document_type: chunk.metadata.document_type,
      title: chunk.metadata.title,
      section: chunk.metadata.section,
    });
  }

  return { compactContext: lines.join("\n").trim(), sourcesUsed };
}
