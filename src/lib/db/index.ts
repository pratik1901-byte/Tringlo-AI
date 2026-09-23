// ============================================================
// Dialo AI — Authoritative Server-Side Database
// ============================================================
// Persists leads, call records, follow-ups, raw provider events and webhook
// delivery receipts to data/database.json, so call data survives server
// restarts, page refreshes and route reloads.
//
// There are no seeded leads and no sample call records: everything in here got
// here because a user uploaded it or because Sarvam reported it.
// ============================================================

import fs from "fs";
import path from "path";
import type {
  AgentConfig,
  CallingWindow,
  CallRecord,
  FollowUp,
  Lead,
  Session,
  Tenant,
  User,
} from "@/lib/types";
import type { CustomerProfile, MemoryItem } from "@/lib/memory/types";
import { SCHEDULABLE_FOLLOW_UP_STATUSES } from "@/lib/types";

export interface RawEvent {
  id: string;
  receivedAt: string;
  attemptId?: string;
  status?: string;
  payload: unknown;
}

/** One row per webhook body Dialo has already applied — the idempotency ledger. */
export interface WebhookReceipt {
  attemptId: string;
  /** Hash of the meaningful payload fields; a repeat delivery hashes identically. */
  fingerprint: string;
  status: string;
  appliedAt: string;
}

export interface DatabaseSchema {
  leads: Lead[];
  callRecords: CallRecord[];
  followUps: FollowUp[];
  rawEvents: RawEvent[];
  webhookReceipts: WebhookReceipt[];
  /**
   * The agent configuration, stored server-side.
   *
   * It used to live only in browser localStorage and travel with each call
   * request. That made autonomous callbacks impossible: a scheduler running
   * with no browser open had no company, product or objective to call with.
   */
  agentConfig: Partial<AgentConfig> | null;
  callingWindow: CallingWindow | null;
  /**
   * Public URL Sarvam delivers call results to.
   *
   * Held here rather than only in APP_URL because a dev tunnel is handed a new
   * hostname every time it restarts, and an env var cannot change without
   * restarting the server. Stored here, the supervisor can update it live and
   * calls keep working.
   */
  webhookBaseUrl: string | null;
  /** Rolling record of webhook delivery health, for diagnostics. */
  webhookDelivery: WebhookDeliveryState | null;
  /**
   * Businesses using Dialo. Every lead, call and follow-up belongs to one, and
   * the API scopes each request to the caller's tenant.
   */
  tenants: Tenant[];
  /** Sign-in identities. Passwords are scrypt hashes; plaintext is never held. */
  users: User[];
  /** Live sign-ins, keyed by the SHA-256 of the token the client holds. */
  sessions: Session[];
  /**
   * The tenant that owns everything recorded before tenancy existed.
   *
   * Leads, calls and follow-ups written by the pre-authentication app carry no
   * `tenantId`. Rather than rewrite real customer history, those rows are read
   * as belonging to this tenant — the first one created — and are invisible to
   * every other tenant.
   */
  legacyTenantId: string | null;
  /**
   * What Dialo has learned about each customer, and who each customer is.
   *
   * Kept apart from callRecords on purpose: a transcript is evidence of one
   * conversation, a memory is a durable claim that later calls can confirm or
   * correct. Merging them would make correction impossible.
   */
  customerProfiles: CustomerProfile[];
  memoryItems: MemoryItem[];
}

/**
 * What the diagnostics page needs to answer "is Sarvam reaching us?".
 *
 * A webhook that silently stops arriving is the failure mode that loses call
 * results, and it is invisible unless the last success and last failure are
 * both recorded.
 */
export interface WebhookDeliveryState {
  lastReceivedAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessAttemptId: string | null;
  lastSuccessOutcome: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  totalReceived: number;
  totalRejected: number;
  lastDurationMs: number | null;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

const MAX_RAW_EVENTS = 200;
const MAX_RECEIPTS = 500;

function emptyDb(): DatabaseSchema {
  return {
    leads: [],
    callRecords: [],
    followUps: [],
    rawEvents: [],
    webhookReceipts: [],
    agentConfig: null,
    callingWindow: null,
    webhookBaseUrl: null,
    webhookDelivery: null,
    tenants: [],
    users: [],
    sessions: [],
    legacyTenantId: null,
    customerProfiles: [],
    memoryItems: [],
  };
}

declare global {
  var __dialoDatabaseCache: DatabaseSchema | undefined;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDb(): DatabaseSchema {
  if (globalThis.__dialoDatabaseCache) {
    return globalThis.__dialoDatabaseCache;
  }

  ensureDataDir();

  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      globalThis.__dialoDatabaseCache = {
        leads: Array.isArray(parsed.leads) ? parsed.leads : [],
        callRecords: Array.isArray(parsed.callRecords) ? parsed.callRecords : [],
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps : [],
        rawEvents: Array.isArray(parsed.rawEvents) ? parsed.rawEvents : [],
        webhookReceipts: Array.isArray(parsed.webhookReceipts) ? parsed.webhookReceipts : [],
        agentConfig: parsed.agentConfig ?? null,
        callingWindow: parsed.callingWindow ?? null,
        webhookBaseUrl: parsed.webhookBaseUrl ?? null,
        webhookDelivery: parsed.webhookDelivery ?? null,
        // Absent in databases written before authentication existed; an empty
        // list is the correct reading of "no accounts yet".
        tenants: Array.isArray(parsed.tenants) ? parsed.tenants : [],
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        legacyTenantId: parsed.legacyTenantId ?? null,
        customerProfiles: Array.isArray(parsed.customerProfiles) ? parsed.customerProfiles : [],
        memoryItems: Array.isArray(parsed.memoryItems) ? parsed.memoryItems : [],
      };
      return globalThis.__dialoDatabaseCache;
    } catch (err) {
      console.error("[Database] data/database.json is unreadable, starting empty:", err);
    }
  }

  globalThis.__dialoDatabaseCache = emptyDb();
  writeDb(globalThis.__dialoDatabaseCache);
  return globalThis.__dialoDatabaseCache;
}

/**
 * Writes through a temp file so a crash mid-write cannot leave a truncated
 * database behind — the in-flight call state is the only copy Dialo has.
 */
function writeDb(data: DatabaseSchema) {
  globalThis.__dialoDatabaseCache = data;
  try {
    ensureDataDir();
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error("[Database] Error writing database.json:", err);
  }
}

// ------------------------------------------------------------
// LEADS
// ------------------------------------------------------------

export function getLeads(): Lead[] {
  return readDb().leads;
}

export function getLead(id: string): Lead | undefined {
  return readDb().leads.find((lead) => lead.id === id);
}

export function findLeadByPhone(phone: string): Lead | undefined {
  const normalised = phone.replace(/\D/g, "").slice(-10);
  if (!normalised) return undefined;
  return readDb().leads.find((lead) => lead.phone.replace(/\D/g, "").slice(-10) === normalised);
}

export function saveLead(lead: Lead): Lead {
  const db = readDb();
  const index = db.leads.findIndex((existing) => existing.id === lead.id);
  if (index >= 0) {
    db.leads[index] = { ...db.leads[index], ...lead };
  } else {
    db.leads.push(lead);
  }
  writeDb(db);
  return db.leads.find((existing) => existing.id === lead.id) as Lead;
}

export function updateLead(id: string, updates: Partial<Lead>): Lead | undefined {
  const db = readDb();
  const lead = db.leads.find((existing) => existing.id === id);
  if (!lead) return undefined;
  Object.assign(lead, updates);
  writeDb(db);
  return lead;
}

export function deleteLead(id: string): boolean {
  const db = readDb();
  const before = db.leads.length;
  db.leads = db.leads.filter((lead) => lead.id !== id);
  if (db.leads.length === before) return false;
  writeDb(db);
  return true;
}

/**
 * Marks a lead do-not-call and cancels its pending callbacks.
 * This is the single suppression path: every caller goes through here so a DND
 * request can never be half-applied.
 */
export function suppressLead(id: string, reason: string): boolean {
  const db = readDb();
  const lead = db.leads.find((existing) => existing.id === id);
  if (!lead) return false;

  lead.suppressed = true;
  lead.status = "suppressed";
  lead.suppressedReason = reason;
  lead.suppressedAt = new Date().toISOString();

  for (const followUp of db.followUps) {
    if (
      followUp.leadId === id &&
      followUp.status !== "completed" &&
      followUp.status !== "cancelled"
    ) {
      followUp.status = "cancelled";
      followUp.cancelledAt = new Date().toISOString();
      followUp.cancelledBy = "dnd";
      followUp.nextAction = "Cancelled — lead is on the do-not-call list";
      followUp.updatedAt = new Date().toISOString();
    }
  }

  writeDb(db);
  return true;
}

export function isLeadSuppressed(id: string): boolean {
  return Boolean(getLead(id)?.suppressed);
}

// ------------------------------------------------------------
// CALL RECORDS
// ------------------------------------------------------------

function sortByRecency(a: CallRecord, b: CallRecord): number {
  const ta = new Date(a.startedAt || a.requestedAt || 0).getTime();
  const tb = new Date(b.startedAt || b.requestedAt || 0).getTime();
  return tb - ta;
}

export function getCallRecords(): CallRecord[] {
  return [...readDb().callRecords].sort(sortByRecency);
}

export function getCallRecord(id: string): CallRecord | undefined {
  return readDb().callRecords.find((record) => record.id === id);
}

/** The attempt_id is the correlation key between a Dialo call and its webhook. */
export function getCallRecordByAttemptId(attemptId: string): CallRecord | undefined {
  return readDb().callRecords.find((record) => record.providerAttemptId === attemptId);
}

export function getCallRecordsForLead(leadId: string): CallRecord[] {
  return readDb()
    .callRecords.filter((record) => record.leadId === leadId)
    .sort(sortByRecency);
}

export interface ReachabilityHistory {
  totalAttempts: number;
  failedAttempts: number;
  /** Failures since the last time this number connected, or since the first call. */
  consecutiveFailures: number;
  everConnected: boolean;
  lastConnectedAt: string | null;
}

/**
 * How a number has behaved across every call to it.
 *
 * Sarvam reports a carrier failure with `failure_reason: NO_FAILURE_REASON`, so
 * a single failure says nothing. The pattern does: a number that has failed
 * repeatedly and never once connected is almost certainly unreachable, and that
 * is worth saying rather than dialling it again.
 */
export function getReachabilityHistory(leadId: string): ReachabilityHistory {
  // Newest first, so counting stops at the most recent success.
  const records = getCallRecordsForLead(leadId).filter(
    (record) => record.status !== "calling" && record.status !== "initiating"
  );

  let consecutiveFailures = 0;
  let counting = true;

  for (const record of records) {
    const failed = record.status === "failed" || record.status === "provider_error";
    if (counting && failed) consecutiveFailures++;
    else if (counting) counting = false;
  }

  const connected = records.filter((record) => record.status === "connected");

  return {
    totalAttempts: records.length,
    failedAttempts: records.filter(
      (record) => record.status === "failed" || record.status === "provider_error"
    ).length,
    consecutiveFailures,
    everConnected: connected.length > 0,
    lastConnectedAt: connected[0]?.startedAt ?? connected[0]?.requestedAt ?? null,
  };
}

export function saveCallRecord(record: CallRecord): CallRecord {
  const db = readDb();
  const index = db.callRecords.findIndex(
    (existing) =>
      existing.id === record.id ||
      (Boolean(record.providerAttemptId) &&
        existing.providerAttemptId === record.providerAttemptId)
  );

  if (index >= 0) {
    db.callRecords[index] = { ...db.callRecords[index], ...record };
    writeDb(db);
    return db.callRecords[index];
  }

  db.callRecords.unshift(record);
  writeDb(db);
  return record;
}

export function updateCallRecord(
  id: string,
  updates: Partial<CallRecord>
): CallRecord | undefined {
  const db = readDb();
  const record = db.callRecords.find(
    (existing) => existing.id === id || existing.providerAttemptId === id
  );
  if (!record) return undefined;
  Object.assign(record, updates);
  writeDb(db);
  return record;
}

/** In-flight calls older than the cutoff never received a terminal webhook. */
export function getStaleInFlightCalls(olderThanMs: number): CallRecord[] {
  const cutoff = Date.now() - olderThanMs;
  return readDb().callRecords.filter((record) => {
    if (record.status !== "initiating" && record.status !== "calling") return false;
    const requested = new Date(record.requestedAt || record.startedAt || 0).getTime();
    return requested > 0 && requested < cutoff;
  });
}

// ------------------------------------------------------------
// FOLLOW-UPS
// ------------------------------------------------------------

export function getFollowUps(): FollowUp[] {
  return [...readDb().followUps].sort((a, b) => {
    // Callbacks still waiting for a time belong at the top — they need a human.
    if (!a.scheduledTime && b.scheduledTime) return -1;
    if (a.scheduledTime && !b.scheduledTime) return 1;
    if (!a.scheduledTime && !b.scheduledTime) return 0;
    return (
      new Date(a.scheduledTime as string).getTime() -
      new Date(b.scheduledTime as string).getTime()
    );
  });
}

export function getFollowUp(id: string): FollowUp | undefined {
  return readDb().followUps.find((followUp) => followUp.id === id);
}

/**
 * Upserts a follow-up. Keyed on id first, then on the originating attempt, so a
 * redelivered webhook updates the existing callback rather than duplicating it.
 */
export function saveFollowUp(followUp: FollowUp): FollowUp {
  const db = readDb();
  const index = db.followUps.findIndex(
    (existing) =>
      existing.id === followUp.id ||
      (Boolean(followUp.attemptId) && existing.attemptId === followUp.attemptId)
  );

  if (index >= 0) {
    db.followUps[index] = {
      ...db.followUps[index],
      ...followUp,
      createdAt: db.followUps[index].createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeDb(db);
    return db.followUps[index];
  }

  db.followUps.push(followUp);
  writeDb(db);
  return followUp;
}

export function updateFollowUp(
  id: string,
  updates: Partial<FollowUp>
): FollowUp | undefined {
  const db = readDb();
  const followUp = db.followUps.find((existing) => existing.id === id);
  if (!followUp) return undefined;
  Object.assign(followUp, updates, { updatedAt: new Date().toISOString() });
  writeDb(db);
  return followUp;
}

// ------------------------------------------------------------
// WEBHOOK IDEMPOTENCY
// ------------------------------------------------------------

/**
 * Fingerprints the fields that decide what a webhook changes. Two deliveries of
 * the same event produce the same fingerprint; a genuine follow-on event (a
 * status transition, or a late transcript) produces a different one and is applied.
 */
export function fingerprintWebhook(payload: Record<string, unknown>): string {
  const significant = {
    status: payload.status ?? null,
    connectivity_status: payload.connectivity_status ?? null,
    completion_status: payload.completion_status ?? null,
    duration: payload.duration ?? null,
    interaction_id: payload.interaction_id ?? null,
    failure_reason: payload.failure_reason ?? null,
    recording_url: payload.recording_url ?? null,
    end_datetime: payload.end_datetime ?? null,
    final_agent_variables: payload.final_agent_variables ?? null,
    output_agent_variables: payload.output_agent_variables ?? null,
    transcript_turns: Array.isArray(payload.interaction_transcript)
      ? payload.interaction_transcript.length
      : null,
  };

  const serialised = JSON.stringify(significant);
  let hash = 5381;
  for (let i = 0; i < serialised.length; i++) {
    hash = ((hash << 5) + hash + serialised.charCodeAt(i)) | 0;
  }
  return `${serialised.length.toString(36)}_${(hash >>> 0).toString(36)}`;
}

export function hasProcessedWebhook(attemptId: string, fingerprint: string): boolean {
  return readDb().webhookReceipts.some(
    (receipt) => receipt.attemptId === attemptId && receipt.fingerprint === fingerprint
  );
}

export function recordWebhookReceipt(
  attemptId: string,
  fingerprint: string,
  status: string
): void {
  const db = readDb();
  db.webhookReceipts.unshift({
    attemptId,
    fingerprint,
    status,
    appliedAt: new Date().toISOString(),
  });
  if (db.webhookReceipts.length > MAX_RECEIPTS) {
    db.webhookReceipts = db.webhookReceipts.slice(0, MAX_RECEIPTS);
  }
  writeDb(db);
}

// ------------------------------------------------------------
// RAW PROVIDER EVENTS (audit trail)
// ------------------------------------------------------------

const SECRET_KEYS = ["apiKey", "api_key", "SARVAM_API_KEY", "authorization", "x-api-key"];

export function saveRawEvent(
  payload: Record<string, unknown>,
  attemptId?: string,
  status?: string
): void {
  const db = readDb();

  const sanitised: Record<string, unknown> = { ...payload };
  for (const key of Object.keys(sanitised)) {
    if (SECRET_KEYS.some((secret) => key.toLowerCase() === secret.toLowerCase())) {
      delete sanitised[key];
    }
  }

  db.rawEvents.unshift({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    receivedAt: new Date().toISOString(),
    attemptId,
    status,
    payload: sanitised,
  });

  if (db.rawEvents.length > MAX_RAW_EVENTS) {
    db.rawEvents = db.rawEvents.slice(0, MAX_RAW_EVENTS);
  }

  writeDb(db);
}

export function getRawEvents(limit = 25): RawEvent[] {
  return readDb().rawEvents.slice(0, limit);
}

// ------------------------------------------------------------
// AGENT CONFIGURATION
// ------------------------------------------------------------

export function getAgentConfig(): Partial<AgentConfig> | null {
  return readDb().agentConfig;
}

export function saveAgentConfig(config: Partial<AgentConfig>): Partial<AgentConfig> {
  const db = readDb();
  db.agentConfig = { ...(db.agentConfig ?? {}), ...config };
  writeDb(db);
  return db.agentConfig;
}

const DEFAULT_CALLING_WINDOW: CallingWindow = {
  from: "09:00",
  to: "20:00",
  timezone: "Asia/Kolkata",
};

export function getCallingWindow(): CallingWindow {
  return readDb().callingWindow ?? DEFAULT_CALLING_WINDOW;
}

export function saveCallingWindow(window: CallingWindow): CallingWindow {
  const db = readDb();
  db.callingWindow = window;
  writeDb(db);
  return window;
}

// ------------------------------------------------------------
// SCHEDULER SUPPORT
// ------------------------------------------------------------

/**
 * Follow-ups a worker may act on now.
 *
 * `triggering` rows are included once their lock has expired. Filtering them out
 * — as an earlier version did — meant a worker that died between claiming a row
 * and placing the call left that callback stranded permanently, because the
 * status check ran before the lock-expiry check could ever be reached.
 */
export function getDueFollowUps(now: number, lockTimeoutMs: number): FollowUp[] {
  return readDb().followUps.filter((followUp) => {
    if (!SCHEDULABLE_FOLLOW_UP_STATUSES.includes(followUp.status)) return false;

    // A live lock means another worker holds it.
    if (followUp.lockedAt) {
      const heldFor = now - new Date(followUp.lockedAt).getTime();
      if (heldFor < lockTimeoutMs) return false;
    } else if (followUp.status === "triggering") {
      // Claimed but unlocked should not happen; treat it as recoverable.
      return true;
    }

    // A queued retry waits for its own time.
    if (followUp.status === "retry_pending") {
      if (!followUp.nextAttemptAt) return false;
      return new Date(followUp.nextAttemptAt).getTime() <= now;
    }

    if (!followUp.scheduledTime) return followUp.status === "triggering";
    return new Date(followUp.scheduledTime).getTime() <= now;
  });
}

/**
 * Claims a follow-up for execution.
 *
 * Returns false when another worker already holds it. The read-check-write runs
 * synchronously against the in-process database, so two overlapping ticks cannot
 * both win the same row and dial the customer twice.
 */
export function claimFollowUp(id: string, now: number, lockTimeoutMs: number): boolean {
  const db = readDb();
  const followUp = db.followUps.find((entry) => entry.id === id);
  if (!followUp) return false;
  if (!SCHEDULABLE_FOLLOW_UP_STATUSES.includes(followUp.status)) return false;

  if (followUp.lockedAt) {
    const heldFor = now - new Date(followUp.lockedAt).getTime();
    if (heldFor < lockTimeoutMs) return false;
  }

  followUp.status = "triggering";
  followUp.lockedAt = new Date(now).toISOString();
  followUp.executionAttempts = (followUp.executionAttempts ?? 0) + 1;
  followUp.lastAttemptAt = new Date(now).toISOString();
  followUp.updatedAt = new Date(now).toISOString();
  writeDb(db);
  return true;
}

/**
 * The follow-up that caused a given outbound attempt.
 *
 * This is the link that closes the loop: without it a follow-up sat at `calling`
 * forever, even after its call had connected and been recorded.
 */
export function getFollowUpByExecutedAttempt(attemptId: string): FollowUp | undefined {
  return readDb().followUps.find((followUp) => followUp.executedAttemptId === attemptId);
}

export function releaseFollowUp(id: string, updates: Partial<FollowUp>): void {
  const db = readDb();
  const followUp = db.followUps.find((entry) => entry.id === id);
  if (!followUp) return;
  Object.assign(followUp, updates, { lockedAt: null, updatedAt: new Date().toISOString() });
  writeDb(db);
}

// ------------------------------------------------------------
// WEBHOOK BASE URL
// ------------------------------------------------------------

/**
 * The public base URL Sarvam posts call results to.
 *
 * A URL registered at runtime wins over APP_URL, so a tunnel that comes back on
 * a new hostname can be picked up without restarting the server.
 */
export function getWebhookBaseUrl(): string | null {
  const stored = readDb().webhookBaseUrl?.trim();
  if (stored) return stored.replace(/\/+$/, "");

  // WEBHOOK_BASE_URL is the documented name; APP_URL is kept working for
  // existing setups. Never NEXT_PUBLIC_*: this is server configuration.
  const fromEnv = (process.env.WEBHOOK_BASE_URL || process.env.APP_URL || "").trim();
  return fromEnv ? fromEnv.replace(/\/+$/, "") : null;
}

export function saveWebhookBaseUrl(url: string | null): string | null {
  const db = readDb();
  db.webhookBaseUrl = url ? url.trim().replace(/\/+$/, "") : null;
  writeDb(db);
  return db.webhookBaseUrl;
}

// ------------------------------------------------------------
// WEBHOOK DELIVERY HEALTH
// ------------------------------------------------------------

function emptyDelivery(): WebhookDeliveryState {
  return {
    lastReceivedAt: null,
    lastSuccessAt: null,
    lastSuccessAttemptId: null,
    lastSuccessOutcome: null,
    lastFailureAt: null,
    lastFailureReason: null,
    totalReceived: 0,
    totalRejected: 0,
    lastDurationMs: null,
  };
}

export function getWebhookDelivery(): WebhookDeliveryState {
  return readDb().webhookDelivery ?? emptyDelivery();
}

/**
 * Records the outcome of one webhook delivery.
 *
 * Both sides are kept: a rejection that never surfaces looks identical to a
 * provider that simply stopped calling.
 */
export function recordWebhookDelivery(event: {
  ok: boolean;
  attemptId?: string;
  outcome?: string;
  reason?: string;
  tookMs?: number;
}): void {
  const db = readDb();
  const state = db.webhookDelivery ?? emptyDelivery();
  const now = new Date().toISOString();

  state.lastReceivedAt = now;
  state.totalReceived++;

  if (event.ok) {
    state.lastSuccessAt = now;
    state.lastSuccessAttemptId = event.attemptId ?? null;
    state.lastSuccessOutcome = event.outcome ?? null;
    state.lastDurationMs = event.tookMs ?? null;
  } else {
    state.totalRejected++;
    state.lastFailureAt = now;
    state.lastFailureReason = event.reason ?? "Unknown";
  }

  db.webhookDelivery = state;
  writeDb(db);
}

// ------------------------------------------------------------
// TENANTS, USERS & SESSIONS
// ------------------------------------------------------------
//
// Reads here return stored records including password hashes, because callers
// are server-side auth code. Nothing in this section may be returned to a
// client unchanged — routes project a PublicUser instead.

export function getTenants(): Tenant[] {
  return readDb().tenants;
}

export function getTenant(id: string): Tenant | undefined {
  return readDb().tenants.find((t) => t.id === id);
}

export function saveTenant(tenant: Tenant): Tenant {
  const db = readDb();
  const index = db.tenants.findIndex((t) => t.id === tenant.id);
  if (index >= 0) db.tenants[index] = tenant;
  else db.tenants.push(tenant);
  writeDb(db);
  return tenant;
}

export function countUsers(): number {
  return readDb().users.length;
}

/** Email is the login identifier, so it is matched case-insensitively. */
export function findUserByEmail(email: string): User | undefined {
  const needle = email.trim().toLowerCase();
  return readDb().users.find((u) => u.email.toLowerCase() === needle);
}

export function getUser(id: string): User | undefined {
  return readDb().users.find((u) => u.id === id);
}

export function saveUser(user: User): User {
  const db = readDb();
  const index = db.users.findIndex((u) => u.id === user.id);
  if (index >= 0) db.users[index] = user;
  else db.users.push(user);
  writeDb(db);
  return user;
}

export function updateUser(id: string, updates: Partial<User>): User | undefined {
  const db = readDb();
  const index = db.users.findIndex((u) => u.id === id);
  if (index < 0) return undefined;
  db.users[index] = { ...db.users[index], ...updates, id };
  writeDb(db);
  return db.users[index];
}

export function saveSession(session: Session): Session {
  const db = readDb();
  db.sessions.push(session);
  // Expired rows are swept on write rather than by a timer, so the list cannot
  // grow without bound on a server that is never restarted.
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  writeDb(db);
  return session;
}

export function findSessionByTokenHash(tokenHash: string): Session | undefined {
  return readDb().sessions.find((s) => s.tokenHash === tokenHash);
}

export function touchSession(id: string, lastSeenAt: string, expiresAt: string): void {
  const db = readDb();
  const index = db.sessions.findIndex((s) => s.id === id);
  if (index < 0) return;
  db.sessions[index] = { ...db.sessions[index], lastSeenAt, expiresAt };
  writeDb(db);
}

export function deleteSession(tokenHash: string): boolean {
  const db = readDb();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.tokenHash !== tokenHash);
  if (db.sessions.length === before) return false;
  writeDb(db);
  return true;
}

/** Used by "sign out everywhere" and when an account is locked or disabled. */
export function deleteSessionsForUser(userId: string): number {
  const db = readDb();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.userId !== userId);
  const removed = before - db.sessions.length;
  if (removed > 0) writeDb(db);
  return removed;
}

/** The tenant that owns pre-tenancy rows; null until the first account exists. */
export function getLegacyTenantId(): string | null {
  return readDb().legacyTenantId;
}

/**
 * Records which tenant adopts the pre-authentication data.
 *
 * Set once, by the bootstrap route. Refusing to overwrite it matters: pointing
 * it at a second tenant would hand that tenant the first tenant's customers.
 */
export function setLegacyTenantId(tenantId: string): boolean {
  const db = readDb();
  if (db.legacyTenantId) return false;
  db.legacyTenantId = tenantId;
  writeDb(db);
  return true;
}

// ------------------------------------------------------------
// CUSTOMER MEMORY
// ------------------------------------------------------------
//
// Every function here takes a tenantId and filters on it. That is deliberate
// repetition: memory holds personal information customers gave one business in
// confidence, and an accessor that could be called without a tenant is an
// accessor that will eventually be called without one.

export function getCustomerProfile(
  tenantId: string,
  customerId: string
): CustomerProfile | undefined {
  return readDb().customerProfiles.find(
    (profile) => profile.id === customerId && profile.tenantId === tenantId
  );
}

/** Finds a customer by their normalised ten-digit number within one business. */
export function findCustomerProfileByPhone(
  tenantId: string,
  phoneNational: string
): CustomerProfile | undefined {
  return readDb().customerProfiles.find(
    (profile) => profile.tenantId === tenantId && profile.phoneNational === phoneNational
  );
}

export function saveCustomerProfile(profile: CustomerProfile): CustomerProfile {
  const db = readDb();
  const index = db.customerProfiles.findIndex(
    (existing) => existing.id === profile.id && existing.tenantId === profile.tenantId
  );
  if (index >= 0) db.customerProfiles[index] = profile;
  else db.customerProfiles.push(profile);
  writeDb(db);
  return profile;
}

/** Every memory for one customer, including corrected and forgotten items. */
export function getMemoryItems(tenantId: string, customerId: string): MemoryItem[] {
  return readDb().memoryItems.filter(
    (item) => item.tenantId === tenantId && item.customerId === customerId
  );
}

export function saveMemoryItems(items: MemoryItem[]): void {
  if (items.length === 0) return;
  const db = readDb();

  for (const item of items) {
    const index = db.memoryItems.findIndex(
      (existing) => existing.id === item.id && existing.tenantId === item.tenantId
    );
    if (index >= 0) db.memoryItems[index] = item;
    else db.memoryItems.push(item);
  }

  writeDb(db);
}

/**
 * Marks a customer's memory forgotten, or erases it outright.
 *
 * `hard` is what a deletion request means: the rows go, rather than being
 * hidden. Soft deletion keeps provenance, which is right for "that's wrong"
 * and wrong for "delete what you hold about me".
 */
export function forgetCustomerMemory(
  tenantId: string,
  customerId: string,
  options: { hard: boolean; reason?: string } = { hard: false }
): number {
  const db = readDb();
  const now = new Date().toISOString();

  const mine = (item: MemoryItem) =>
    item.tenantId === tenantId && item.customerId === customerId;

  let affected = 0;

  if (options.hard) {
    const before = db.memoryItems.length;
    db.memoryItems = db.memoryItems.filter((item) => !mine(item));
    affected = before - db.memoryItems.length;

    // The rolling summaries are conversation content too, so a hard delete
    // takes them with it; the profile stays so the number is still known.
    const profile = db.customerProfiles.find(
      (candidate) => candidate.id === customerId && candidate.tenantId === tenantId
    );
    if (profile) {
      profile.recentSummaries = [];
      profile.updatedAt = now;
    }
  } else {
    for (const item of db.memoryItems) {
      if (!mine(item) || item.status === "forgotten") continue;
      item.status = "forgotten";
      item.updatedAt = now;
      affected++;
    }
  }

  if (affected > 0 || options.hard) writeDb(db);
  return affected;
}
