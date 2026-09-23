// ============================================================
// Scoped Company RAG Knowledge Architecture
// ============================================================

export type DocumentType =
  | "company_information"
  | "products"
  | "faqs"
  | "pricing"
  | "policies"
  | "features"
  | "restrictions"
  | "sales_guidelines"
  | "objection_handling"
  | "compliance_rules";

export interface KnowledgeDocumentMetadata {
  company_id: string;
  product_id?: string;
  document_type: DocumentType;
  title: string;
  section: string;
  version: number;
  effective_from: string;
  effective_to?: string;
  language: string;
  approved: boolean;
  source: string;
}

export interface KnowledgeChunk {
  chunk_id: string;
  document_id: string;
  content: string;
  metadata: KnowledgeDocumentMetadata;
  keywords: string[];
}

export interface CompanyKnowledgeScope {
  company_id: string;
  agent_id?: string;
  chunks: KnowledgeChunk[];
}

// In-memory knowledge registry for active business scopes
class KnowledgeRegistry {
  private scopes: Map<string, CompanyKnowledgeScope> = new Map();

  /**
   * Register or update business knowledge documents for a company
   */
  public registerKnowledge(
    companyId: string,
    documents: Array<{
      document_type: DocumentType;
      title: string;
      section: string;
      content: string;
      keywords?: string[];
      approved?: boolean;
    }>
  ) {
    const chunks: KnowledgeChunk[] = documents.map((doc, idx) => ({
      chunk_id: `chunk_${companyId}_${doc.document_type}_${idx}`,
      document_id: `doc_${companyId}_${doc.document_type}`,
      content: doc.content.trim(),
      metadata: {
        company_id: companyId,
        document_type: doc.document_type,
        title: doc.title,
        section: doc.section,
        version: 1,
        effective_from: new Date().toISOString(),
        language: "en-IN",
        approved: doc.approved !== false, // default approved
        source: "dialo_business_portal",
      },
      keywords: doc.keywords || [],
    }));

    this.scopes.set(companyId, { company_id: companyId, chunks });
  }

  public getScope(companyId: string): CompanyKnowledgeScope | undefined {
    return this.scopes.get(companyId);
  }
}

export const knowledgeRegistry = new KnowledgeRegistry();
