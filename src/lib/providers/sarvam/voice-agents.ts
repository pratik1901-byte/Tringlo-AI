// ============================================================
// Sarvam Voice Agents — Outbound Service
// ============================================================

import { SarvamClientError, SarvamVoiceAgentsClient } from "./client";
import { buildSarvamAgentVariables, validateRequiredSarvamVariables } from "./variables";
import type {
  SarvamAgentVariables,
  SarvamAppOverrides,
  SarvamConfigStatus,
  SarvamOutboundPayload,
} from "./types";
import { getWebhookBaseUrl } from "@/lib/db";
import { withWebhookToken } from "@/lib/security/webhook-auth";
import type { AgentConfig } from "@/lib/types";

export interface OutboundCallParams {
  leadId: string;
  leadName: string;
  leadPhone: string;
  leadCompany?: string;
  leadNotes?: string;

  /** The seller's company. Dynamic per tenant — TenWeb is only the current test value. */
  companyName: string;
  productName?: string;
  agentConfig?: Partial<AgentConfig>;

  campaignId?: string;
  campaignName?: string;
  previousInteraction?: string;

  /** Display name of the Sarvam voice agent, used in the opening line. */
  agentName?: string;

  /** Approved company knowledge from the scoped RAG index. */
  ragContext?: string;

  /** Public base URL Sarvam will call back on. */
  webhookBaseUrl: string;

  /** Dialo's own call id, echoed back through webhook metadata. */
  callId: string;

  customVariables?: Record<string, unknown>;
}

export interface OutboundCallResult {
  attemptId: string;
  provider: "sarvam";
  callId: string;
  /** The exact input variables sent, retained for audit on the call record. */
  inputVariables: SarvamAgentVariables;
}

export class SarvamVoiceAgentsService {
  private client: SarvamVoiceAgentsClient;

  constructor() {
    this.client = new SarvamVoiceAgentsClient();
  }

  /**
   * Reports which pieces of server configuration are present.
   *
   * `APP_URL` is included deliberately: without a public URL Sarvam has nowhere to
   * deliver the completion webhook, and a call whose result never arrives is worse
   * than one that was never placed.
   */
  public getConfigurationStatus(): SarvamConfigStatus {
    const hasApiKey = Boolean(process.env.SARVAM_API_KEY?.trim());
    const hasOrgId = Boolean(process.env.SARVAM_ORG_ID?.trim());
    const hasWorkspaceId = Boolean(process.env.SARVAM_WORKSPACE_ID?.trim());
    const hasAgentId = Boolean(
      process.env.SARVAM_APP_ID?.trim() || process.env.SARVAM_AGENT_ID?.trim()
    );
    const hasConnectionId = Boolean(process.env.SARVAM_CONNECTION_ID?.trim());
    const hasPhoneNumber = Boolean(process.env.SARVAM_AGENT_PHONE_NUMBER?.trim());
    // Reads the same source placeCall uses, so Settings cannot report a URL the
    // caller is not actually going to use.
    const publicUrl = getWebhookBaseUrl() ?? "";
    const hasPublicUrl = Boolean(publicUrl) && !publicUrl.includes("localhost");

    const missing: string[] = [];
    if (!hasApiKey) missing.push("SARVAM_API_KEY");
    if (!hasOrgId) missing.push("SARVAM_ORG_ID");
    if (!hasWorkspaceId) missing.push("SARVAM_WORKSPACE_ID");
    if (!hasAgentId) missing.push("SARVAM_APP_ID");
    if (!hasConnectionId) missing.push("SARVAM_CONNECTION_ID");
    if (!hasPhoneNumber) missing.push("SARVAM_AGENT_PHONE_NUMBER");
    if (!hasPublicUrl) missing.push("APP_URL");

    let status: SarvamConfigStatus["status"] = "ready";
    let details = "Sarvam outbound calling and webhook delivery are fully configured.";

    if (!hasApiKey) {
      status = "missing_api_key";
      details = "SARVAM_API_KEY is not set on the server.";
    } else if (!hasOrgId || !hasWorkspaceId) {
      status = "missing_workspace";
      details = "SARVAM_ORG_ID or SARVAM_WORKSPACE_ID is not set.";
    } else if (!hasAgentId) {
      status = "missing_agent";
      details = "SARVAM_APP_ID (Voice Agent app) is not set.";
    } else if (!hasConnectionId) {
      status = "missing_telephony";
      details = "SARVAM_CONNECTION_ID (Vobiz telephony connection) is not set.";
    } else if (!hasPhoneNumber) {
      status = "missing_phone_number";
      details = "SARVAM_AGENT_PHONE_NUMBER (outbound caller ID) is not set.";
    } else if (!hasPublicUrl) {
      status = "missing_public_url";
      details =
        "APP_URL is not set to a public https URL, so Sarvam cannot deliver call results back to Dialo.";
    }

    return {
      status,
      details,
      hasApiKey,
      hasOrgId,
      hasWorkspaceId,
      hasAgentId,
      hasConnectionId,
      hasPhoneNumber,
      hasPublicUrl,
      missing,
    };
  }

  /** Normalises to E.164, defaulting to the Indian country code. */
  public normalizePhoneNumber(phone: string, defaultCountryCode = "+91"): string {
    const cleaned = phone.replace(/[\s\-().]/g, "");
    if (cleaned.startsWith("+")) return cleaned;
    if (cleaned.length === 10) return `${defaultCountryCode}${cleaned}`;
    if (cleaned.length === 12 && cleaned.startsWith("91")) return `+${cleaned}`;
    return `+${cleaned}`;
  }

  public isValidPhoneNumber(phone: string): boolean {
    const digits = phone.replace(/[\s\-().+]/g, "");
    return digits.length >= 10 && /^\d+$/.test(digits);
  }

  /**
   * Places a real outbound call through Sarvam Instant Outbound / Vobiz.
   *
   * Returns as soon as Sarvam accepts the trigger. The returned `attempt_id` is the
   * only correlation key to the eventual webhook, so the caller must persist it
   * before the call can produce results.
   */
  public async startOutboundCall(params: OutboundCallParams): Promise<OutboundCallResult> {
    if (!this.isValidPhoneNumber(params.leadPhone)) {
      throw new SarvamClientError(
        `Invalid customer phone number: "${params.leadPhone}". At least 10 digits are required.`,
        400,
        "invalid_phone_number"
      );
    }

    const config = this.getConfigurationStatus();
    const appId = process.env.SARVAM_APP_ID || process.env.SARVAM_AGENT_ID;
    const connectionId = process.env.SARVAM_CONNECTION_ID;
    const agentPhoneNumber = process.env.SARVAM_AGENT_PHONE_NUMBER;

    if (!config.hasApiKey) {
      throw new SarvamClientError(config.details, 401, "missing_api_key");
    }
    if (!config.hasOrgId || !config.hasWorkspaceId) {
      throw new SarvamClientError(config.details, 422, "missing_workspace");
    }
    if (!appId) {
      throw new SarvamClientError(config.details, 422, "missing_agent");
    }
    if (!connectionId) {
      throw new SarvamClientError(config.details, 422, "missing_telephony");
    }
    if (!agentPhoneNumber) {
      throw new SarvamClientError(config.details, 422, "missing_phone_number");
    }

    const normalizedPhone = this.normalizePhoneNumber(params.leadPhone);
    const companyName = params.companyName.trim();
    const productName = params.productName?.trim() || "";

    const validation = validateRequiredSarvamVariables({
      customerName: params.leadName,
      companyName,
      productName,
      phoneNumber: normalizedPhone,
    });
    if (!validation.valid) {
      throw new SarvamClientError(
        validation.error || "Required Sarvam agent variables are missing.",
        400,
        "missing_required_variables"
      );
    }

    // The token, when configured, travels in the URL: Sarvam's outbound webhook
    // config offers no signing secret or custom headers for this callback.
    const webhookUrl = withWebhookToken(
      `${params.webhookBaseUrl.replace(/\/+$/, "")}/api/webhooks/sarvam/outbound`
    );

    const built = buildSarvamAgentVariables({
      lead: {
        id: params.leadId,
        name: params.leadName,
        phone: params.leadPhone,
        company: params.leadCompany,
        notes: params.leadNotes,
      },
      agentConfig: params.agentConfig,
      companyName,
      productName,
      normalizedPhone,
      campaignName: params.campaignName,
      campaignId: params.campaignId,
      ragContext: params.ragContext,
      previousInteraction: params.previousInteraction,
      customVariables: params.customVariables,
    });

    const inputVariables = built.variables;

    // Safe diagnostics: booleans and variable names only, never their values.
    // An agent that improvised on a call can be traced back to the field that
    // was empty when it was placed.
    console.log("[Sarvam] Business context for this call:", {
      hasCompanyName: !built.missingContext.includes("companyName"),
      hasCompanyDescription: !built.missingContext.includes("companyDescription"),
      hasProductName: !built.missingContext.includes("productName"),
      hasProductDescription: !built.missingContext.includes("productDescription"),
      hasSalesObjective: !built.missingContext.includes("salesObjective"),
      faqCount: built.context.faqs.length,
      variablesSent: Object.keys(inputVariables).length,
    });

    if (built.missingContext.length > 0) {
      console.warn(
        `[Sarvam] Calling without ${built.missingContext.join(", ")}. The agent has not been told this, and may improvise if the customer asks.`
      );
    }

    if (built.usingFallbackFor.length > 0) {
      console.warn(
        `[Sarvam] The app does not declare ${built.usingFallbackFor.join(", ")}; context was routed through fallback variables. Declare these in the Sarvam app and add them to SARVAM_AGENT_VARIABLES.`
      );
    }

    const appOverrides = this.buildAppOverrides(params, companyName);

    const payload: SarvamOutboundPayload = {
      app_config: {
        app_id: appId,
        app_version: Number(process.env.SARVAM_APP_VERSION || "4"),
        app_type: process.env.SARVAM_APP_TYPE || "agent",
        connection_config: {
          connection_id: connectionId,
          agent_phone_number: agentPhoneNumber,
        },
        agent_variables: inputVariables,
        ...(Object.keys(appOverrides).length > 0 ? { app_overrides: appOverrides } : {}),
      },
      user_config: {
        user_phone_number: normalizedPhone,
      },
      webhook_config: {
        url: webhookUrl,
        // Echoed back verbatim — this is how a webhook finds its call.
        metadata: {
          lead_id: params.leadId,
          callId: params.callId,
          company_id: companyName,
          agent_id: appId,
        },
      },
    };

    const response = await this.client.createInstantOutbound(payload);

    if (!response.attempt_id) {
      throw new SarvamClientError(
        "Sarvam accepted the request but returned no attempt_id, so the call result could not be correlated.",
        502,
        "missing_attempt_id"
      );
    }

    return {
      attemptId: response.attempt_id,
      provider: "sarvam",
      callId: params.callId,
      inputVariables,
    };
  }

  /**
   * Builds the opening line. Skipped entirely when the agent's own entry node
   * already greets, which would otherwise produce a double greeting on the call.
   */
  private buildAppOverrides(
    params: OutboundCallParams,
    companyName: string
  ): SarvamAppOverrides {
    if (process.env.SARVAM_OMIT_INITIAL_BOT_MESSAGE === "true") return {};

    // Configured agent name first; the env value is only a deployment default.
    const agent =
      params.agentName?.trim() || process.env.SARVAM_AGENT_NAME?.trim() || "your assistant";
    const firstName = (params.leadName || "").trim().split(/\s+/)[0] || "";
    const isPlaceholderName =
      !firstName ||
      ["customer", "user", "lead", "contact", "unknown", "there"].includes(
        firstName.toLowerCase()
      );

    return {
      initial_bot_message: isPlaceholderName
        ? `Hi, this is ${agent} calling from the ${companyName} team. How are you doing today?`
        : `Hi, this is ${agent} calling from the ${companyName} team. Am I speaking with ${firstName}?`,
    };
  }
}

export const sarvamVoiceService = new SarvamVoiceAgentsService();
