// ============================================================
// Tringlo AI — reading a Sarvam API example
// ============================================================
//
// An administrator setting a workspace up has Sarvam's documentation open.
// Rather than retyping ids out of a cURL example, they paste it here and the
// recognised fields fill the form, where they can check and correct them.
//
// This is a READER, not a runner. It is the whole security boundary of the
// feature, so the rules are stated here and enforced below:
//
//   - Nothing is executed. The text is parsed as text; the body with
//     JSON.parse. No shell, no eval, no dynamic import.
//   - Nothing is fetched. The URL in the snippet is compared against a list of
//     known Sarvam endpoints and then discarded; it never becomes a request.
//   - No credential is kept. An API key in a pasted header is dropped and the
//     administrator is told it was ignored. Tringlo's own key stays on the
//     server.
//   - Only known fields survive. Anything else in the snippet is ignored, so a
//     snippet cannot introduce configuration Tringlo does not understand.
//   - Placeholders are refused. "<your-agent-id>" is not an agent id, and
//     accepting one would produce a workspace that looks configured and
//     cannot call.
//
// What comes out is a plain object of validated strings and numbers. The
// snippet itself is never stored.
// ============================================================

import type { Weekday } from "@/lib/campaigns/types";

export type SnippetKind =
  | "instant_outbound"
  | "create_campaign"
  | "upload_cohort"
  | "pause_resume"
  | "inbound_deployment"
  /**
   * Adding known callers to an inbound deployment — a different operation on a
   * different service to creating one, so it gets its own reader rather than
   * being squeezed through the deployment parser.
   */
  | "known_callers"
  /**
   * Sarvam's *answer* to creating a deployment, rather than the request.
   * Needed because the deployment ID exists only once Sarvam has made the
   * deployment: it is in the response and in no request.
   */
  | "deployment_response";

/** Only Sarvam's own host, and only the endpoints Tringlo actually calls. */
const ALLOWED_HOST = "apps.sarvam.ai";

/**
 * Endpoints for the kinds that are requests. A response carries no URL, so
 * `deployment_response` is absent and nothing about its origin is checked —
 * which is safe precisely because nothing is ever fetched.
 */
const ENDPOINTS: Partial<Record<SnippetKind, { pattern: RegExp; describe: string }>> = {
  instant_outbound: {
    pattern: /\/api\/outbounds\/v1\/orgs\/[^/]+\/workspaces\/[^/]+\/outbounds\/?$/,
    describe: "the Instant Outbound endpoint (…/outbounds/v1/orgs/…/workspaces/…/outbounds)",
  },
  create_campaign: {
    pattern: /\/api\/scheduling\/v1\/orgs\/[^/]+\/workspaces\/[^/]+\/campaigns\/?$/,
    describe: "the Create Campaign endpoint (…/scheduling/v1/orgs/…/workspaces/…/campaigns)",
  },
  upload_cohort: {
    pattern: /\/api\/scheduling\/v1\/orgs\/[^/]+\/workspaces\/[^/]+\/campaigns\/[^/]+\/cohorts\/(upload|stream)\/?$/,
    describe: "a campaign cohort endpoint (…/campaigns/{id}/cohorts/upload or /stream)",
  },
  pause_resume: {
    pattern: /\/api\/scheduling\/v1\/orgs\/[^/]+\/workspaces\/[^/]+\/campaigns\/[^/]+\/status\/?$/,
    describe: "the campaign status endpoint (…/campaigns/{id}/status)",
  },
  inbound_deployment: {
    pattern: /\/api\/app-authoring\/v1\/orgs\/[^/]+\/workspaces\/[^/]+\/deployments\/?$/,
    describe: "the Create Deployment endpoint (…/app-authoring/v1/orgs/…/workspaces/…/deployments)",
  },
  // A deployment's own cohort endpoints, which live under scheduling rather
  // than app-authoring. Deliberately its own entry: the create-deployment
  // pattern stays exactly as strict as it was.
  known_callers: {
    pattern: /\/api\/scheduling\/v1\/orgs\/[^/]+\/workspaces\/[^/]+\/deployments\/[^/]+\/cohorts\/(stream|upload)\/?$/,
    describe: "a deployment cohort endpoint (…/deployments/{deployment_id}/cohorts/stream or /upload)",
  },
};

/** Values that are documentation, not configuration. */
const PLACEHOLDER = /^(<.*>|\{.*\}|your[-_ ].*|.*_here|string|xxx+|app_id|org_id|workspace_id|campaign_id|connection_id|deployment_id|agent_phone_number|example.*|changeme|todo)$/i;

/**
 * A deployment ID on its own: one token of the shape Sarvam mints, with no
 * JSON and no command around it. Recognised so that pasting it into an import
 * box is answered with where it belongs, rather than with a parser error.
 */
function bareDeploymentId(snippet: string): string | null {
  const trimmed = snippet.trim();
  if (!/^[A-Za-z0-9._-]{4,120}$/.test(trimmed) || isPlaceholder(trimmed)) return null;
  return trimmed;
}

export interface SnippetResult {
  ok: boolean;
  /** Recognised, validated values, ready to drop into the form. */
  fields: Record<string, unknown>;
  /** Why it was refused. Shown to the administrator as-is. */
  problems: string[];
  /** Accepted, but worth saying — an ignored key, a field Tringlo manages itself. */
  warnings: string[];
}

/**
 * Documentation masks a number as +91XXXXXXXXXX, 1234567890 or 0000000000.
 * None of those is a number, and one quietly accepted would produce a
 * workspace that looks configured and cannot call.
 */
// Only genuine masks: a run of X or *, or the textbook 1234567890. Real
// numbers do contain long runs of zeros, so those are left alone.
const MASKED_NUMBER = /^\+?[\d\s()-]*(?:x{4,}|\*{4,})[\d\s()-]*$|^\+?(?:91)?1234567890$/i;

function isPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed === "" || PLACEHOLDER.test(trimmed) || MASKED_NUMBER.test(trimmed);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || isPlaceholder(trimmed)) return null;
  return trimmed;
}

function whole(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The request URL, if the snippet carries one.
 *
 * Read for checking only. A URL that is not Sarvam's is refused rather than
 * stored, and no URL from a snippet is ever requested.
 */
function findUrl(snippet: string): string | null {
  const quoted = snippet.match(/https?:\/\/[^\s'"\\]+/);
  return quoted ? quoted[0] : null;
}

/** Strips a Markdown code fence, which documentation and chat tools add. */
function stripFence(snippet: string): string {
  const fence = /^```[a-z]*\s*\n([\s\S]*?)\n?```\s*$/i.exec(snippet.trim());
  return fence ? fence[1].trim() : snippet.trim();
}

/** Undoes shell escaping, so -d "{\"a\":1}" reads as JSON. */
function unescapeShell(value: string): string {
  return value.replace(/\\(["'\\])/g, "$1");
}

/** JSON.parse, tried on the text as pasted and then with shell escapes undone. */
function readJson(candidate: string): unknown | null {
  for (const attempt of [candidate, unescapeShell(candidate)]) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Try the next reading; a snippet that parses neither way is reported by
      // the caller, which knows what kind of example was expected.
    }
  }
  return null;
}

/**
 * The first complete JSON object inside a longer piece of text.
 *
 * Braces are counted with strings and their escapes respected, so a brace
 * inside a value cannot end the object early. This is what lets a response
 * pasted under a line of prose, or a body sitting in a Python example, be
 * read without asking the administrator to trim the paste by hand.
 */
function firstJsonObject(text: string): unknown | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const character = text[i];
      if (escaped) {
        escaped = false;
      } else if (inString && character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = !inString;
      } else if (!inString && character === "{") {
        depth += 1;
      } else if (!inString && character === "}") {
        depth -= 1;
        if (depth === 0) {
          const parsed = readJson(text.slice(start, i + 1));
          if (parsed) return parsed;
          break; // Not JSON after all; look for the next opening brace.
        }
      }
    }
  }
  return null;
}

/**
 * The JSON body of an example, however it was copied.
 *
 * Examples arrive in more shapes than one: a cURL command with --data or
 * --json, Windows cURL with its quotes escaped, a body on its own, a response
 * under a line of prose, or anything of those inside a Markdown code fence.
 * All of them are read as text — nothing here runs or fetches anything.
 */
function findBody(snippet: string): { body: unknown; problem?: string } {
  const trimmed = stripFence(snippet);

  // The whole paste is JSON.
  if (trimmed.startsWith("{")) {
    const parsed = readJson(trimmed);
    if (parsed) return { body: parsed };
    return { body: null, problem: "That looks like JSON but could not be read. Check for a missing comma or quote." };
  }

  // A body flag: --data '…', --data-raw "…", -d '…', --json '…'.
  const flag = /(?:--data-raw|--data-binary|--data-ascii|--data|--json|-d)[\s=]+(['"])([\s\S]*?)\1/.exec(trimmed);
  if (flag) {
    const parsed = readJson(flag[2]);
    if (parsed) return { body: parsed };
    // A quote inside the body ends that capture early, so fall through to the
    // scan rather than refusing an example that is perfectly good.
  }

  // An unquoted flag, a body inside a larger example, or JSON under prose.
  const scanned = firstJsonObject(trimmed) ?? firstJsonObject(unescapeShell(trimmed));
  if (scanned) return { body: scanned };

  if (flag) return { body: null, problem: "The request body in that example could not be read as JSON." };
  return { body: null };
}

/** True when the snippet carries a credential, which is dropped either way. */
function mentionsCredential(snippet: string): boolean {
  return /x-api-key|authorization\s*:|bearer\s+\S|api[-_ ]?key/i.test(snippet);
}

function checkEndpoint(kind: SnippetKind, snippet: string, result: SnippetResult): void {
  const expected = ENDPOINTS[kind];
  if (!expected) return; // A response; there is no request URL to check.

  const url = findUrl(snippet);
  if (!url) return; // A body-only paste is fine; there is nothing to check.

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    result.problems.push("The URL in that example could not be read.");
    return;
  }

  if (parsed.hostname !== ALLOWED_HOST) {
    result.problems.push(`That example points at ${parsed.hostname}. Only ${ALLOWED_HOST} examples are accepted.`);
    return;
  }
  if (!expected.pattern.test(parsed.pathname)) {
    result.problems.push(`That is not ${expected.describe}. Check you copied the right example.`);
  }
}

// ------------------------------------------------------------
// Per-operation readers
// ------------------------------------------------------------

function readInstantOutbound(body: Record<string, unknown>, result: SnippetResult): void {
  const app = (body.app_config ?? {}) as Record<string, unknown>;
  const connection = (app.connection_config ?? {}) as Record<string, unknown>;

  const appId = text(app.app_id);
  const appVersion = whole(app.app_version);
  const connectionId = text(connection.connection_id);
  const phoneNumber = text(connection.agent_phone_number);
  const appType = text(app.app_type);

  if (appId) result.fields.appId = appId;
  if (appVersion) result.fields.appVersion = appVersion;
  if (connectionId) result.fields.connectionId = connectionId;
  if (phoneNumber) result.fields.phoneNumber = phoneNumber;
  if (appType) result.fields.appType = appType;

  const missing = [
    !appId && "the agent ID (app_config.app_id)",
    !appVersion && "the agent version (app_config.app_version)",
    !connectionId && "the connection ID (connection_config.connection_id)",
    !phoneNumber && "the caller number (connection_config.agent_phone_number)",
  ].filter(Boolean) as string[];
  if (missing.length) {
    result.problems.push(`That example does not give ${missing.join(", ")}. Fill those in by hand, or paste a complete example.`);
  }

  if (body.webhook_config) {
    result.warnings.push("The webhook in that example was ignored — Tringlo registers its own, with this workspace's token.");
  }
  if (app.agent_variables) {
    result.warnings.push("Agent variables were ignored — Tringlo fills those per call from the company profile and customer memory.");
  }
  if ((body.user_config as Record<string, unknown>)?.user_phone_number) {
    result.warnings.push("The customer's number in the example was ignored — that comes from the lead being called.");
  }
}

function readCreateCampaign(body: Record<string, unknown>, result: SnippetResult): void {
  const app = (body.app_config ?? {}) as Record<string, unknown>;

  const appId = text(app.app_id);
  const appVersion = whole(app.app_version);
  const appType = text(app.app_type);
  const attempts = whole(app.attempts_per_second);

  if (appId) result.fields.appId = appId;
  if (appVersion) result.fields.appVersion = appVersion;
  if (appType) result.fields.appType = appType;
  if (attempts) result.fields.attemptsPerSecond = attempts;

  const connections = Array.isArray(app.connection_configs) ? (app.connection_configs as Array<Record<string, unknown>>) : [];
  const first = connections[0] ?? {};
  const connectionId = text(first.connection_id);
  if (connectionId) result.fields.connectionId = connectionId;
  const numbers = Array.isArray(first.phone_numbers)
    ? (first.phone_numbers as unknown[]).map(text).filter((value): value is string => Boolean(value))
    : [];
  if (numbers.length) result.fields.phoneNumbers = numbers;

  const retry = (app.retry_config ?? {}) as Record<string, unknown>;
  const on = (retry.retry_on ?? {}) as Record<string, Record<string, unknown>>;
  const maxRetries = typeof retry.max_retries === "number" ? retry.max_retries : null;
  if (maxRetries !== null && maxRetries >= 0) {
    result.fields.retry = {
      maxRetries,
      intervalMinutes: whole(retry.retry_interval_minutes) ?? 30,
      onBusy: Boolean(on.busy?.enabled),
      onNoAnswer: Boolean(on.no_answer?.enabled),
      onFailed: Boolean(on.failed?.enabled),
      onShortDuration: Boolean(on.short_duration?.enabled),
      shortDurationSeconds: whole(on.short_duration?.threshold_seconds) ?? 25,
    };
  }

  const schedule = (body.allowed_schedule ?? {}) as Record<string, unknown>;
  const days = Array.isArray(schedule.allowed_days) ? (schedule.allowed_days as Weekday[]) : [];
  const timezone = text(schedule.timezone);
  const startTime = text(schedule.allowed_start_time);
  const endTime = text(schedule.allowed_end_time);
  if (timezone || startTime || endTime || days.length) {
    result.fields.schedule = {
      timezone: timezone ?? "Asia/Kolkata",
      startTime: startTime ?? "09:00",
      endTime: endTime ?? "19:00",
      days,
    };
  }

  const missing = [
    !appId && "the agent ID",
    !appVersion && "the agent version",
    !connectionId && "the connection ID",
    numbers.length === 0 && "at least one caller number",
  ].filter(Boolean) as string[];
  if (missing.length) {
    result.problems.push(`That example does not give ${missing.join(", ")}. Fill those in by hand, or paste a complete example.`);
  }

  if (body.name) result.warnings.push("The campaign name was ignored — each campaign is named when you launch it.");
  if (body.start_timestamp || body.end_timestamp) {
    result.warnings.push("The campaign's start and end were ignored — those are chosen per campaign, not per workspace.");
  }
  if (app.webhook_config) {
    result.warnings.push("The webhook in that example was ignored — Tringlo registers its own, with this workspace's token.");
  }
}

function readUploadCohort(snippet: string, body: Record<string, unknown> | null, result: SnippetResult): void {
  const url = findUrl(snippet) ?? "";
  const streaming = /\/cohorts\/stream/.test(url) || Array.isArray((body ?? {}).users);
  const uploading = /\/cohorts\/upload/.test(url) || /cohort_file/.test(snippet);

  if (!streaming && !uploading) {
    result.problems.push("That does not look like a cohort example. Paste either the Upload Cohort or the Stream Cohort example.");
    return;
  }

  // Which way Tringlo hands the leads over is the one thing this example settles.
  result.fields.cohortMode = uploading ? "upload" : "stream";

  if (/\/campaigns\/([^/]+)\/cohorts/.test(url)) {
    result.warnings.push("The campaign ID in that example was ignored — Tringlo uses the ID of the campaign it creates.");
  }
  if (body && Array.isArray(body.users)) {
    result.warnings.push("The example's users were ignored — the leads come from the sheet you upload for each campaign.");
  }
  if (/cohort_transformation_file/.test(snippet)) {
    result.warnings.push(
      "Import recognised — direct Sarvam CSV upload is not enabled, because the cohort_transformation_file format is not published. Tringlo submits leads through the supported Stream cohort API instead."
    );
  }
}

function readPauseResume(body: Record<string, unknown> | null, snippet: string, result: SnippetResult): void {
  const action = text((body ?? {}).action);
  const inUrl = /\/campaigns\/([^/]+)\/status/.test(findUrl(snippet) ?? "");

  if (!action && !inUrl) {
    result.problems.push("That does not look like the campaign status example. It should post an action of pause, resume or cancel.");
    return;
  }
  if (action && !["pause", "resume", "cancel"].includes(action.toLowerCase())) {
    result.problems.push(`"${action}" is not a campaign action. Sarvam accepts pause, resume or cancel.`);
    return;
  }

  // Nothing here belongs to a workspace: the action and the campaign are both
  // decided when someone pauses a particular campaign.
  result.fields.pauseResumeVerified = true;
  result.warnings.push("Nothing from this example is stored — it confirms Tringlo is calling the right endpoint. Pausing and resuming act on the campaign you choose.");
}

function readInboundDeployment(body: Record<string, unknown>, result: SnippetResult): void {
  const appId = text(body.app_id);
  const appVersion = whole(body.app_version);
  if (appId) result.fields.appId = appId;
  if (appVersion) result.fields.appVersion = appVersion;

  const connections = Array.isArray(body.connection_configs) ? (body.connection_configs as Array<Record<string, unknown>>) : [];
  const first = connections[0] ?? {};
  const connectionId = text(first.connection_id);
  if (connectionId) result.fields.connectionId = connectionId;

  const numbers = Array.isArray(first.phone_numbers)
    ? (first.phone_numbers as unknown[]).map(text).filter((value): value is string => Boolean(value))
    : [];
  const single = text(first.agent_phone_number);
  const phone = numbers[0] ?? single;
  if (phone) result.fields.phoneNumber = phone;

  const inbound = (body.inbound_config ?? {}) as Record<string, unknown>;
  const startTime = text(inbound.start_time);
  const endTime = text(inbound.end_time);
  if (startTime) result.fields.startTime = startTime.slice(0, 5);
  if (endTime) result.fields.endTime = endTime.slice(0, 5);
  const timezone = text(inbound.timezone);
  if (timezone) result.fields.timezone = timezone;
  if (Array.isArray(inbound.allowed_days) && inbound.allowed_days.length) {
    result.fields.days = inbound.allowed_days as Weekday[];
  }

  const deploymentId = text(body.deployment_id);
  if (deploymentId) result.fields.deploymentId = deploymentId;

  if (!appId) {
    result.problems.push("That example does not give the inbound agent ID (app_id). Fill it in by hand, or paste a complete example.");
  }
  if (body.webhook_config) {
    result.warnings.push("The webhook in that example was ignored — Tringlo registers its own, with this workspace's token.");
  }
}

/**
 * Sarvam's answer to creating (or fetching) a deployment.
 *
 * This exists for one reason: `deployment_id` is minted by Sarvam, so it is in
 * the response and in no request. Everything else here is a bonus — if the
 * response also states the agent, connection, number or hours, those are read
 * too, so one paste can carry the whole picture.
 *
 * An ID is only ever taken from the text. None is derived, generated or
 * guessed: a response without one yields no ID and says so.
 */
/**
 * Adding known callers to an inbound deployment.
 *
 * This confirms Tringlo is talking to the right endpoint and, when the example
 * carries a real deployment ID rather than a documentation placeholder, offers
 * it for the inbound settings. Nothing else survives:
 *
 *   - The example's callers are documentation. Saving them would put invented
 *     people into a real workspace's contacts, so they are counted and
 *     discarded.
 *   - The cohort name, and any cohort id, belong to one upload made at the
 *     time it happens — not to the workspace.
 *
 * Pasting this uploads nothing by itself: known callers are sent from the
 * workspace's own contacts, by an explicit action on the inbound card.
 */
function readKnownCallers(body: Record<string, unknown> | null, snippet: string, result: SnippetResult): void {
  const url = findUrl(snippet);
  const inUrl = /\/deployments\/([^/]+)\/cohorts\/(stream|upload)/.exec(url ?? "");

  if (!inUrl && !body) {
    result.problems.push(
      "That does not look like the known-caller example. It should post to …/deployments/{deployment_id}/cohorts/stream."
    );
    return;
  }

  // The deployment id is in the path here, not the body.
  const fromUrl = inUrl ? decodeURIComponent(inUrl[1]) : null;
  const deploymentId = text(fromUrl);
  if (deploymentId) {
    result.fields.deploymentId = deploymentId;
  } else if (fromUrl) {
    result.warnings.push(
      `The deployment in that example is a placeholder ("${fromUrl}"), so it was not kept. Tringlo uses this workspace's own deployment ID when it sends known callers.`
    );
  }

  const users = Array.isArray(body?.users) ? (body!.users as Array<Record<string, unknown>>) : [];
  if (users.length) {
    result.warnings.push(
      `${users.length} example caller${users.length === 1 ? "" : "s"} read and discarded — known callers come from this workspace's own contacts, never from a documentation example.`
    );
  }
  if (text(body?.name)) {
    result.warnings.push("The cohort name belongs to one upload, so it is not saved. Tringlo names each upload as it makes it.");
  }
  if (users.some((user) => "user_identifier" in user)) {
    result.warnings.push(
      "Sarvam refuses user_identifier on a deployment cohort, so Tringlo does not send it. Callers are matched on their number."
    );
  }

  // What was understood, so the shape can be checked even though none of the
  // sample data is kept.
  const recognised = [
    inUrl ? "deployment_id (from the URL)" : null,
    body && "name" in body ? "name" : null,
    users.length ? "users[].user_phone_number" : null,
    users.some((user) => "user_identifier" in user) ? "users[].user_identifier" : null,
    users.some((user) => "app_variables" in user) ? "users[].app_variables" : null,
    users.some((user) => "app_overrides" in user) ? "users[].app_overrides" : null,
  ].filter(Boolean) as string[];
  if (recognised.length) result.fields.recognisedFields = recognised;
  result.fields.knownCallersVerified = true;
}

/**
 * Consoles and SDKs wrap the deployment in one envelope key. At most one level
 * is unwrapped, and only onto an object that actually looks like a deployment,
 * so nothing unrelated is mistaken for one.
 */
function unwrapEnvelope(record: Record<string, unknown>): Record<string, unknown> {
  if ("deployment_id" in record || "items" in record) return record;

  for (const key of ["data", "deployment", "result", "response", "body"]) {
    const inner = record[key];
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) continue;
    const candidate = inner as Record<string, unknown>;
    if ("deployment_id" in candidate || "items" in candidate || "app_id" in candidate) return candidate;
  }
  return record;
}

function readDeploymentResponse(body: Record<string, unknown>, result: SnippetResult): void {
  const envelope = unwrapEnvelope(body);
  // A list response (…/deployments) wraps the deployment in items[].
  const items = Array.isArray(envelope.items) ? (envelope.items as Array<Record<string, unknown>>) : null;
  if (items && items.length > 1) {
    result.problems.push(
      `That response lists ${items.length} deployments. Paste the one deployment you mean, or copy its deployment_id into the field below.`
    );
    return;
  }
  const record = items?.length ? items[0] : envelope;

  const deploymentId = text(record.deployment_id) ?? text(record.id);
  if (deploymentId) result.fields.deploymentId = deploymentId;

  const appId = text(record.app_id);
  const appVersion = whole(record.app_version);
  if (appId) result.fields.appId = appId;
  if (appVersion) result.fields.appVersion = appVersion;

  const connections = Array.isArray(record.connection_configs) ? (record.connection_configs as Array<Record<string, unknown>>) : [];
  const first = connections[0] ?? {};
  const connectionId = text(first.connection_id);
  if (connectionId) result.fields.connectionId = connectionId;
  const numbers = Array.isArray(first.phone_numbers)
    ? (first.phone_numbers as unknown[]).map(text).filter((value): value is string => Boolean(value))
    : [];
  const phone = numbers[0] ?? text(first.agent_phone_number);
  if (phone) result.fields.phoneNumber = phone;

  const inbound = (record.inbound_config ?? {}) as Record<string, unknown>;
  const startTime = text(inbound.start_time);
  const endTime = text(inbound.end_time);
  if (startTime) result.fields.startTime = startTime.slice(0, 5);
  if (endTime) result.fields.endTime = endTime.slice(0, 5);
  const timezone = text(inbound.timezone);
  if (timezone) result.fields.timezone = timezone;
  if (Array.isArray(inbound.allowed_days) && inbound.allowed_days.length) {
    result.fields.days = inbound.allowed_days as Weekday[];
  }

  if (!deploymentId) {
    result.problems.push(
      "No deployment_id was found in this response. Paste the full JSON response returned by Sarvam, or enter the deployment ID manually in the field above."
    );
    return;
  }

  // What Sarvam says about the deployment's own state is read but not acted
  // on: saving settings here never starts or stops a line.
  const status = text(record.status);
  if (status) {
    result.warnings.push(
      `Sarvam reports this deployment as "${status}". Saving does not change that — use Update on the inbound card when you want the line to follow these settings.`
    );
  }
}

// ------------------------------------------------------------

/**
 * Reads one pasted example and returns the fields Tringlo recognises.
 *
 * Never throws: a snippet is something a person pasted, and the answer to a
 * bad one is an explanation, not an exception.
 */
export function parseSarvamSnippet(kind: SnippetKind, snippet: string): SnippetResult {
  const result: SnippetResult = { ok: false, fields: {}, problems: [], warnings: [] };

  const trimmed = (snippet ?? "").trim();
  if (!trimmed) {
    result.problems.push("Paste the example from Sarvam's documentation first.");
    return result;
  }
  if (trimmed.length > 100_000) {
    result.problems.push("That is too long to be an API example.");
    return result;
  }

  if (mentionsCredential(trimmed)) {
    result.warnings.push("The API key in that example was ignored and not saved. Tringlo uses its own, kept on the server.");
  }

  // A deployment ID pasted into an import box. It is offered for the field it
  // belongs in rather than parsed as a command it plainly is not.
  if (kind === "inbound_deployment" || kind === "deployment_response") {
    const id = bareDeploymentId(trimmed);
    if (id) {
      result.fields.deploymentIdCandidate = id;
      result.problems.push(
        kind === "inbound_deployment"
          ? "This box expects the full Sarvam create-deployment cURL command, including its JSON request body. To enter only a deployment ID, use the Inbound Deployment ID field above."
          : "That is a deployment ID on its own, not Sarvam's JSON response. Put it in the Inbound Deployment ID field above, or paste the whole response."
      );
      return result;
    }
  }

  checkEndpoint(kind, trimmed, result);
  if (result.problems.length) return result;

  const { body, problem } = findBody(trimmed);
  if (problem) {
    result.problems.push(problem);
    return result;
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

  if (kind === "known_callers") {
    readKnownCallers(record, trimmed, result);
  } else if (kind === "upload_cohort") {
    readUploadCohort(trimmed, record, result);
  } else if (kind === "pause_resume") {
    readPauseResume(record, trimmed, result);
  } else if (kind === "deployment_response" && !record) {
    // A deployment that was fetched rather than created: the ID is in the path
    // of …/deployments/{deployment_id}, which is a position, not a guess.
    const fetched = /\/deployments\/([^/?#]+)/.exec(findUrl(trimmed) ?? "");
    const id = fetched ? text(decodeURIComponent(fetched[1])) : null;
    if (id) {
      result.fields.deploymentId = id;
      result.warnings.push("Read from the URL of that request. Only the deployment ID was taken; nothing else in the example was kept.");
    } else {
      result.problems.push(
        "No JSON response was found in that paste. Paste the full JSON response returned by Sarvam, or enter the deployment ID manually in the field above."
      );
    }
  } else if (!record) {
    result.problems.push("No JSON request body was found. Include the complete cURL command with its --data section.");
  } else if (kind === "instant_outbound") {
    readInstantOutbound(record, result);
  } else if (kind === "create_campaign") {
    readCreateCampaign(record, result);
  } else if (kind === "deployment_response") {
    readDeploymentResponse(record, result);
  } else {
    readInboundDeployment(record, result);
  }

  result.ok = result.problems.length === 0;
  return result;
}
