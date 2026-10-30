// ============================================================
// Sarvam Voice Agents — Outbound Service
// ============================================================

import { SarvamClientError, SarvamVoiceAgentsClient } from "./client";
import {
  buildSarvamAgentVariables,
  businessContextReach,
  hasDeclaredVariables,
  undeclaredVariablesFrom,
  validateOutgoingVariables,
} from "./variables";
import { resolveMappings } from "@/lib/providers/variable-mapping";
import type {
  SarvamAgentVariables,
  SarvamAppOverrides,
  SarvamConfigStatus,
  SarvamOutboundPayload,
} from "./types";
import { getWebhookBaseUrl } from "@/lib/db";
import { platformCredentials, providerConfigFor } from "@/lib/providers/config";
import type { ResolvedOutbound } from "@/lib/providers/types";
import { withWebhookToken } from "@/lib/security/webhook-auth";
import type { AgentConfig } from "@/lib/types";

export interface OutboundCallParams {
  /** The workspace this call belongs to, and the agent it has configured. */
  provider: ResolvedOutbound;
  tenantId: string;

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

  /** Tringlo's own call id, echoed back through webhook metadata. */
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
  public getConfigurationStatus(tenantId: string): SarvamConfigStatus {
    const credentials = platformCredentials();
    const outbound = providerConfigFor(tenantId)?.outbound ?? null;
    const hasApiKey = Boolean(credentials?.apiKey);
    const hasOrgId = Boolean(credentials?.orgId);
    const hasWorkspaceId = Boolean(credentials?.workspaceId);
    const hasAgentId = Boolean(outbound?.appId);
    const hasConnectionId = Boolean(outbound?.connectionId);
    const hasPhoneNumber = Boolean(outbound?.phoneNumber);
    // Reads the same source placeCall uses, so Settings cannot report a URL the
    // caller is not actually going to use.
    const publicUrl = getWebhookBaseUrl() ?? "";
    const hasPublicUrl = Boolean(publicUrl) && !publicUrl.includes("localhost");

    const missing: string[] = [];
    if (!hasApiKey) missing.push("SARVAM_API_KEY");
    if (!hasOrgId) missing.push("SARVAM_ORG_ID");
    if (!hasWorkspaceId) missing.push("SARVAM_WORKSPACE_ID");
    if (!hasAgentId) missing.push("Outbound agent");
    if (!hasConnectionId) missing.push("Telephony connection");
    if (!hasPhoneNumber) missing.push("Caller number");
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
      details = "This workspace has no outbound agent configured. Set it in Settings → Voice Provider.";
    } else if (!hasConnectionId) {
      status = "missing_telephony";
      details = "This workspace has no telephony connection configured. Set it in Settings → Voice Provider.";
    } else if (!hasPhoneNumber) {
      status = "missing_phone_number";
      details = "This workspace has no caller number configured. Set it in Settings → Voice Provider.";
    } else if (!hasPublicUrl) {
      status = "missing_public_url";
      details =
        "APP_URL is not set to a public https URL, so Sarvam cannot deliver call results back to Tringlo.";
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

    // Resolved from the caller's workspace before we got here: which agent
    // answers for this customer, on which connection, from which number.
    const { credentials, outbound, webhookToken } = params.provider;
    const { appId, connectionId, phoneNumber: agentPhoneNumber } = outbound;

    const normalizedPhone = this.normalizePhoneNumber(params.leadPhone);
    const companyName = params.companyName.trim();
    const productName = params.productName?.trim() || "";

    // The token, when configured, travels in the URL: Sarvam's outbound webhook
    // config offers no signing secret or custom headers for this callback.
    const webhookUrl = withWebhookToken(
      `${params.webhookBaseUrl.replace(/\/+$/, "")}/api/webhooks/sarvam/outbound`,
      webhookToken
    );

    // What this agent is told, decided by this agent's own configuration.
    //
    //   mappings   authoritative: exactly these names, from these sources
    //   names only a workspace configured before mappings existed
    //   neither    the agent takes no custom variables, and none are sent
    //
    // Nothing is inferred from the industry, and no name is built in: an agent
    // that declares `patient_name` and one that declares `candidate_name` are
    // configuration, not code.
    const mapped = resolveMappings(outbound.variableMappings, {
      lead: {
        name: params.leadName,
        phone: normalizedPhone,
        company: params.leadCompany,
        notes: params.leadNotes,
      },
      workspace: {
        company: companyName,
        product: productName || params.agentConfig?.productName,
        industry: params.agentConfig?.industry,
      },
      call: {
        campaignName: params.campaignName,
        previousInteraction: params.previousInteraction,
      },
    });

    if (mapped.missingRequired.length > 0) {
      throw new SarvamClientError(
        `No call was placed: ${mapped.missingRequired.join(", ")} ${mapped.missingRequired.length === 1 ? "is" : "are"} required by this workspace's agent variable mapping, and there was no value for ${mapped.missingRequired.length === 1 ? "it" : "them"}. ` +
          "Set a default for it in Settings → Voice provider, or make it optional.",
        400,
        "missing_required_mapping"
      );
    }

    const built = buildSarvamAgentVariables({
      lead: {
        id: params.leadId,
        name: params.leadName,
        phone: params.leadPhone,
        company: params.leadCompany,
        notes: params.leadNotes,
      },
      agentConfig: params.agentConfig,
      declaredVariables: outbound.agentVariables,
      companyName,
      productName,
      normalizedPhone,
      campaignName: params.campaignName,
      campaignId: params.campaignId,
      ragContext: params.ragContext,
      previousInteraction: params.previousInteraction,
      customVariables: params.customVariables,
    });

    // A mapping says everything; without one, the declared names do.
    const inputVariables = (outbound.variableMappings ?? []).length > 0 ? mapped.variables : built.variables;

    const unsafe = validateOutgoingVariables(inputVariables);
    if (!unsafe.valid) {
      throw new SarvamClientError(unsafe.error || "A variable would be spoken as a placeholder.", 400, "placeholder_variable");
    }

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

    // One line that answers "why did the agent talk about the wrong business".
    // Workspace, the exact Sarvam agent and version the call runs on, and
    // whether this workspace's business context can reach that agent at all.
    // When it cannot, the agent speaks only from its own Sarvam-side prompt,
    // and no change in Tringlo will alter what it says. Names and booleans
    // only — never a value, never a credential.
    const reach = businessContextReach(outbound.agentVariables, outbound.variableMappings);
    console.log(
      `CALL_CONTEXT workspace=${params.tenantId} agent=${appId} v${outbound.appVersion} ` +
        `businessContext=${reach.reaches ? `sent(via ${reach.via})` : "NOT SENT — agent uses its Sarvam-side prompt"} ` +
        `variablesSent=${Object.keys(inputVariables).length}`
    );

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
        app_version: outbound.appVersion,
        app_type: process.env.SARVAM_APP_TYPE || "agent",
        connection_config: {
          connection_id: connectionId,
          agent_phone_number: agentPhoneNumber,
        },
        // Omitted entirely when nothing is configured. Sending an empty bag
        // would be a claim that this agent takes variables; it may not.
        ...(Object.keys(inputVariables).length > 0 ? { agent_variables: inputVariables } : {}),
        ...(Object.keys(appOverrides).length > 0 ? { app_overrides: appOverrides } : {}),
      },
      user_config: {
        user_phone_number: normalizedPhone,
      },
      webhook_config: {
        url: webhookUrl,
        // Echoed back verbatim — this is how a webhook finds its call.
        // Echoed back verbatim. The workspace is here as a convenience for
        // tracing; routing never trusts it — a webhook is matched to its call
        // by attempt id, and inbound by deployment.
        metadata: {
          lead_id: params.leadId,
          callId: params.callId,
          workspace_id: params.tenantId,
          agent_id: appId,
        },
      },
    };

    // Which variables were about to travel, by name only — never a value, and
    // never a credential. An agent that refused a call can be traced to the
    // exact names it does not declare.
    if (!hasDeclaredVariables(outbound.agentVariables) && (outbound.variableMappings ?? []).length === 0) {
      console.log(
        `[Sarvam] Workspace ${params.tenantId} sends no custom agent variables: none are configured for agent ${appId}. The call carries the provider's own fields only.`
      );
    }

    let response;
    try {
      response = await this.client.createInstantOutbound(payload, credentials);
    } catch (error) {
      throw this.explainUndeclaredVariables(error, appId, Object.keys(inputVariables));
    }

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
   * Rewrites Sarvam's rejection of undeclared variables into an instruction.
   *
   * Sarvam refuses the whole request when a variable is not declared on the
   * agent, naming them. Left as-is the message is a wall of identifiers; read,
   * it is a list of names to take off this workspace's list or declare on the
   * agent. The call was not placed either way, and this never says it was.
   */
  private explainUndeclaredVariables(error: unknown, appId: string, sent: string[]): unknown {
    if (!(error instanceof SarvamClientError)) return error;
    const undeclared = undeclaredVariablesFrom(error.message);
    if (undeclared.length === 0) return error;

    console.error(
      `SARVAM_UNDECLARED_VARIABLES agent=${appId} rejected=${undeclared.join(",")} sent=${sent.length}`
    );

    return new SarvamClientError(
      `The Sarvam agent ${appId} does not declare ${undeclared.join(", ")}. No call was placed. ` +
        "Either declare those variables on the agent in Sarvam, or remove them from this workspace's agent variables in Settings → Voice provider.",
      error.status,
      "undeclared_agent_variables",
      { undeclared, agentId: appId }
    );
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
    // The workspace asked for its agent's own opening. Overriding it would be
    // Tringlo rewriting what the agent says, which is the agent's to decide.
    if (params.provider.outbound.useOwnGreeting) return {};

    // Configured agent name first; the env value is only a deployment default.
    const agent = params.agentName?.trim() || params.provider.outbound.agentName?.trim() || "your assistant";
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
