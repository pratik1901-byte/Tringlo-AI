// ============================================================
// Tringlo AI — Authoritative Server-Side Database
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
  Appointment,
  AppointmentEvent,
  Doctor,
  HospitalAuditEvent,
  HospitalFaq,
  HospitalProfile,
  Reminder,
} from "@/lib/hospital/types";
import type {
  CancellationRequest,
  HospitalFollowUp,
  HistoryReport,
  MedicalHistoryRecord,
  QuestionnaireSession,
  UnansweredInquiry,
  VisitNote,
} from "@/lib/hospital/records";
import type { DemoHisPatient } from "@/lib/hospital/his/types";
import type { ProviderDirectory } from "@/lib/hospital/directory";
import type {
  AgentConfig,
  CallingWindow,
  CallRecord,
  FollowUp,
  Lead,
  Session,
  Tenant,
  User,
  WorkspaceMembership,
} from "@/lib/types";
import type { CustomerProfile, MemoryItem } from "@/lib/memory/types";
import type { Campaign as CampaignRun } from "@/lib/campaigns/types";
import type { InboundSettings } from "@/lib/inbound/types";
import type { WorkspaceProviderConfig } from "@/lib/providers/types";

/**
 * A pending password reset. Only a salted HMAC of the code is stored, so the
 * database never holds a code that could be replayed.
 */
export interface PasswordReset {
  id: string;
  userId: string;
  codeHash: string;
  salt: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  /** Set when used or superseded; a closed reset can never succeed. */
  closedAt: string | null;
}

/**
 * A pending change of login email. The code goes to the NEW address, so the
 * change proves the person owns it. Kept apart from password resets so a code
 * issued for one can never be spent on the other.
 */
export interface EmailChange {
  id: string;
  userId: string;
  /** Lower-cased. Checked for uniqueness again when the code is confirmed. */
  newEmail: string;
  codeHash: string;
  salt: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  closedAt: string | null;
}

/** What a workspace wants to be emailed about. Held server-side so the server can act on it. */
export interface NotificationSettings {
  tenantId: string;
  /** Where alerts go. Null falls back to the workspace owner's login email. */
  recipient: string | null;
  emailAlerts: boolean;
  dailySummary: boolean;
  /** The local date (YYYY-MM-DD) the last daily summary covered, so it is sent once. */
  lastSummaryDate: string | null;
  updatedAt: string;
}
import { SCHEDULABLE_FOLLOW_UP_STATUSES } from "@/lib/types";

export interface RawEvent {
  id: string;
  receivedAt: string;
  attemptId?: string;
  status?: string;
  payload: unknown;
  /**
   * The workspace this delivery belongs to, when it could be established from
   * a trusted provider identifier. Null means it could not be — a forged or
   * stale event — and it is never guessed at.
   */
  tenantId?: string | null;
}

/** One row per webhook body Tringlo has already applied — the idempotency ledger. */
export interface WebhookReceipt {
  attemptId: string;
  /** Hash of the meaningful payload fields; a repeat delivery hashes identically. */
  fingerprint: string;
  status: string;
  appliedAt: string;
  /** The workspace the applied call belongs to; null when unestablished. */
  tenantId?: string | null;
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
   * Businesses using Tringlo. Every lead, call and follow-up belongs to one, and
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
   * What Tringlo has learned about each customer, and who each customer is.
   *
   * Kept apart from callRecords on purpose: a transcript is evidence of one
   * conversation, a memory is a durable claim that later calls can confirm or
   * correct. Merging them would make correction impossible.
   */
  customerProfiles: CustomerProfile[];
  memoryItems: MemoryItem[];
  passwordResets: PasswordReset[];
  emailChanges: EmailChange[];
  notificationSettings: NotificationSettings[];
  /** Sarvam campaigns, per workspace. */
  campaignRuns: CampaignRun[];
  /** Inbound calling, per workspace. Absent row = inbound off. */
  inboundSettings: InboundSettings[];

  /** Which Sarvam agent, connection and numbers each workspace uses. */
  providerConfigs: WorkspaceProviderConfig[];
  /**
   * Who may open which workspace. Added when one account became able to own
   * several workspaces; absent databases gain it empty and are filled by
   * migrateMemberships().
   */
  memberships: WorkspaceMembership[];

  /**
   * A workspace's company information and calling hours.
   *
   * `agentConfig` and `callingWindow` above are the single-workspace
   * originals. They are migrated into this collection on first read and are
   * no longer read after that; they stay on disk so a rollback needs no
   * data restore.
   */
  workspaceProfiles: WorkspaceProfile[];

  /**
   * Hospital operations, for workspaces running the hospital panel. Scoped by
   * tenantId like everything else, and absent in a database written before
   * the panel existed — an empty list is the right reading of "no hospital".
   */
  doctors: Doctor[];
  appointments: Appointment[];
  appointmentEvents: AppointmentEvent[];
  reminders: Reminder[];
  hospitalFaqs: HospitalFaq[];
  hospitalProfiles: HospitalProfile[];
  hospitalAudit: HospitalAuditEvent[];
  questionnaireSessions: QuestionnaireSession[];
  medicalHistories: MedicalHistoryRecord[];
  historyReports: HistoryReport[];
  visitNotes: VisitNote[];
  hospitalFollowUps: HospitalFollowUp[];
  unansweredInquiries: UnansweredInquiry[];
  cancellationRequests: CancellationRequest[];
  /** The demonstration hospital server's own patient directory. */
  hisPatients: DemoHisPatient[];
  /** The last provider directory read from the hospital server, per workspace. */
  providerDirectories: ProviderDirectory[];
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
    passwordResets: [],
    emailChanges: [],
    notificationSettings: [],
    campaignRuns: [],
    inboundSettings: [],
    providerConfigs: [],
    memberships: [],
    doctors: [],
    appointments: [],
    appointmentEvents: [],
    reminders: [],
    hospitalFaqs: [],
    hospitalProfiles: [],
    hospitalAudit: [],
    questionnaireSessions: [],
    medicalHistories: [],
    historyReports: [],
    visitNotes: [],
    hospitalFollowUps: [],
    unansweredInquiries: [],
    cancellationRequests: [],
    hisPatients: [],
    providerDirectories: [],
    workspaceProfiles: [],
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

/**
 * The cache outlives this module: a dev server's hot reload re-runs this file
 * but keeps `globalThis`, so the cached database can predate collections
 * added since (as happened with campaigns). The first read in each module
 * instance fills in anything missing, with the same defaults a fresh database
 * gets.
 */
let cacheChecked = false;

function withAllCollections(db: DatabaseSchema): DatabaseSchema {
  const defaults = emptyDb() as unknown as Record<string, unknown>;
  const target = db as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) target[key] = value;
  }
  return db;
}

function readDb(): DatabaseSchema {
  if (globalThis.__dialoDatabaseCache) {
    if (!cacheChecked) {
      withAllCollections(globalThis.__dialoDatabaseCache);
      cacheChecked = true;
    }
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
        passwordResets: Array.isArray(parsed.passwordResets) ? parsed.passwordResets : [],
        emailChanges: Array.isArray(parsed.emailChanges) ? parsed.emailChanges : [],
        campaignRuns: Array.isArray(parsed.campaignRuns) ? parsed.campaignRuns : [],
        inboundSettings: Array.isArray(parsed.inboundSettings) ? parsed.inboundSettings : [],
        notificationSettings: Array.isArray(parsed.notificationSettings)
          ? parsed.notificationSettings
          : [],
        providerConfigs: Array.isArray(parsed.providerConfigs) ? parsed.providerConfigs : [],
        workspaceProfiles: Array.isArray(parsed.workspaceProfiles) ? parsed.workspaceProfiles : [],
        memberships: Array.isArray(parsed.memberships) ? parsed.memberships : [],
        doctors: Array.isArray(parsed.doctors) ? parsed.doctors : [],
        appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
        appointmentEvents: Array.isArray(parsed.appointmentEvents) ? parsed.appointmentEvents : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        hospitalFaqs: Array.isArray(parsed.hospitalFaqs) ? parsed.hospitalFaqs : [],
        hospitalProfiles: Array.isArray(parsed.hospitalProfiles) ? parsed.hospitalProfiles : [],
        hospitalAudit: Array.isArray(parsed.hospitalAudit) ? parsed.hospitalAudit : [],
        questionnaireSessions: Array.isArray(parsed.questionnaireSessions) ? parsed.questionnaireSessions : [],
        medicalHistories: Array.isArray(parsed.medicalHistories) ? parsed.medicalHistories : [],
        historyReports: Array.isArray(parsed.historyReports) ? parsed.historyReports : [],
        visitNotes: Array.isArray(parsed.visitNotes) ? parsed.visitNotes : [],
        hospitalFollowUps: Array.isArray(parsed.hospitalFollowUps) ? parsed.hospitalFollowUps : [],
        unansweredInquiries: Array.isArray(parsed.unansweredInquiries) ? parsed.unansweredInquiries : [],
        cancellationRequests: Array.isArray(parsed.cancellationRequests) ? parsed.cancellationRequests : [],
        hisPatients: Array.isArray(parsed.hisPatients) ? parsed.hisPatients : [],
        providerDirectories: Array.isArray(parsed.providerDirectories) ? parsed.providerDirectories : [],
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
 * database behind — the in-flight call state is the only copy Tringlo has.
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

/**
 * Deletes a lead and everything that exists because of it: its calls (with
 * transcripts and saved recordings), follow-ups, raw webhook events and
 * receipts, its place in campaign lead lists, and its customer memory — unless
 * another lead in the same workspace shares that customer.
 *
 * A delete that left the calls behind was not a delete: the person's
 * transcripts and outcomes stayed on screen in Results and Campaigns.
 */
export function deleteLead(id: string): boolean {
  const db = readDb();
  const lead = db.leads.find((candidate) => candidate.id === id);
  if (!lead) return false;
  db.leads = db.leads.filter((candidate) => candidate.id !== id);
  purgeLeadData(db, new Set([id]));
  writeDb(db);
  console.log(`LEAD_DELETED lead=${id}`);
  return true;
}

/** Removes everything tied to the given lead ids. Mutates `db`; the caller writes. */
function purgeLeadData(db: DatabaseSchema, leadIds: Set<string>) {
  const calls = db.callRecords.filter((record) => leadIds.has(record.leadId));
  const attempts = new Set(calls.map((record) => record.providerAttemptId).filter(Boolean) as string[]);

  db.callRecords = db.callRecords.filter((record) => !leadIds.has(record.leadId));
  db.followUps = db.followUps.filter((followUp) => !leadIds.has(followUp.leadId));
  db.rawEvents = db.rawEvents.filter((event) => !(event.attemptId && attempts.has(event.attemptId)));
  db.webhookReceipts = db.webhookReceipts.filter((receipt) => !attempts.has(receipt.attemptId));
  for (const campaign of db.campaignRuns) {
    if (campaign.members.some((member) => leadIds.has(member.leadId))) {
      campaign.members = campaign.members.filter((member) => !leadIds.has(member.leadId));
    }
  }

  // Customer memory: unlinked from these leads, and erased once no lead is left.
  const remaining = new Set(db.leads.map((candidate) => candidate.id));
  const goneProfiles = new Set<string>();
  for (const profile of db.customerProfiles) {
    if (!profile.leadIds.some((leadId) => leadIds.has(leadId))) continue;
    profile.leadIds = profile.leadIds.filter((leadId) => !leadIds.has(leadId));
    if (!profile.leadIds.some((leadId) => remaining.has(leadId))) goneProfiles.add(`${profile.tenantId}|${profile.id}`);
  }
  db.customerProfiles = db.customerProfiles.filter((profile) => !goneProfiles.has(`${profile.tenantId}|${profile.id}`));
  db.memoryItems = db.memoryItems.filter((item) => !goneProfiles.has(`${item.tenantId}|${item.customerId}`));

  // Saved audio for those calls.
  for (const record of calls) {
    const interaction = record.providerInteractionId;
    if (!interaction) continue;
    const safe = interaction.replace(/[^A-Za-z0-9-]/g, "_");
    for (const extension of ["wav", "mp3"]) {
      const file = path.join(DATA_DIR, "recordings", `${safe}.${extension}`);
      try {
        if (file.startsWith(path.join(DATA_DIR, "recordings") + path.sep) && fs.existsSync(file)) fs.unlinkSync(file);
      } catch (error) {
        console.error("LEAD_RECORDING_DELETE_FAILED", error instanceof Error ? error.message : error);
      }
    }
  }
}

/**
 * Removes data still attached to leads that no longer exist — left behind by
 * deletes made before deleteLead cleaned up after itself. Idempotent.
 */
export function purgeOrphanedLeadData(): { calls: number; followUps: number; campaignEntries: number } {
  const db = readDb();
  const existing = new Set(db.leads.map((lead) => lead.id));
  const orphanIds = new Set<string>([
    ...db.callRecords.map((record) => record.leadId),
    ...db.followUps.map((followUp) => followUp.leadId),
    ...db.campaignRuns.flatMap((campaign) => campaign.members.map((member) => member.leadId)),
  ].filter((leadId) => !existing.has(leadId)));
  if (orphanIds.size === 0) return { calls: 0, followUps: 0, campaignEntries: 0 };

  const counts = {
    calls: db.callRecords.filter((record) => orphanIds.has(record.leadId)).length,
    followUps: db.followUps.filter((followUp) => orphanIds.has(followUp.leadId)).length,
    campaignEntries: db.campaignRuns.reduce((n, campaign) => n + campaign.members.filter((member) => orphanIds.has(member.leadId)).length, 0),
  };
  purgeLeadData(db, orphanIds);
  writeDb(db);
  return counts;
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

/** The attempt_id is the correlation key between a Tringlo call and its webhook. */
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
  status: string,
  tenantId?: string | null
): void {
  const db = readDb();
  db.webhookReceipts.unshift({
    tenantId: tenantId ?? null,
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
  status?: string,
  tenantId?: string | null
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
    tenantId: tenantId ?? null,
  });

  if (db.rawEvents.length > MAX_RAW_EVENTS) {
    db.rawEvents = db.rawEvents.slice(0, MAX_RAW_EVENTS);
  }

  writeDb(db);
}

/**
 * Webhook deliveries, for one workspace.
 *
 * A row whose workspace could not be established belongs to nobody and is
 * returned to nobody; it stays on disk for the operator to inspect on the
 * server.
 */
export function getRawEvents(tenantId: string, limit = 25): RawEvent[] {
  return readDb()
    .rawEvents.filter((event) => event.tenantId === tenantId)
    .slice(0, limit);
}

/** Every delivery, workspace or not. Server-side diagnostics only. */
export function getAllRawEvents(limit = 25): RawEvent[] {
  return readDb().rawEvents.slice(0, limit);
}

// ------------------------------------------------------------
// AGENT CONFIGURATION
// ------------------------------------------------------------

/** The pre-tenancy company profile. Read by the migration, by nothing else. */
export function getAgentConfigSingleton(): Partial<AgentConfig> | null {
  return readDb().agentConfig;
}

/** The pre-tenancy calling window. Read by the migration, by nothing else. */
export function getCallingWindowSingleton(): CallingWindow | null {
  return readDb().callingWindow;
}

/**
 * One workspace's company information — the name the agent introduces itself
 * with, the product it describes, the FAQs it answers from.
 *
 * Returns an empty object for a workspace that has not set one up, never
 * another workspace's.
 */
export function getAgentConfig(tenantId: string): Partial<AgentConfig> {
  return getWorkspaceProfile(tenantId)?.agentConfig ?? {};
}

export function saveAgentConfig(tenantId: string, config: Partial<AgentConfig>): Partial<AgentConfig> {
  const existing = getWorkspaceProfile(tenantId);
  const merged = { ...(existing?.agentConfig ?? {}), ...config };
  saveWorkspaceProfile({
    tenantId,
    agentConfig: merged,
    callingWindow: existing?.callingWindow ?? null,
    updatedAt: new Date().toISOString(),
  });
  return merged;
}

const DEFAULT_CALLING_WINDOW: CallingWindow = {
  from: "09:00",
  to: "20:00",
  timezone: "Asia/Kolkata",
};

/** One workspace's calling hours. The default is used until it sets its own. */
export function getCallingWindow(tenantId: string): CallingWindow {
  return getWorkspaceProfile(tenantId)?.callingWindow ?? DEFAULT_CALLING_WINDOW;
}

export function saveCallingWindow(tenantId: string, window: CallingWindow): CallingWindow {
  const existing = getWorkspaceProfile(tenantId);
  saveWorkspaceProfile({
    tenantId,
    agentConfig: existing?.agentConfig ?? {},
    callingWindow: window,
    updatedAt: new Date().toISOString(),
  });
  return window;
}

/**
 * The timezone to format a message in when no workspace is in hand — a public
 * contact form, for instance. Never used for calling decisions.
 */
export function platformTimezone(): string {
  return DEFAULT_CALLING_WINDOW.timezone;
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

/**
 * Signs a user out everywhere except the session making the request — what a
 * password change should do: anyone else holding the old password is cut off,
 * while the person who just changed it stays signed in.
 */
export function deleteOtherSessions(userId: string, keepSessionId: string): number {
  const db = readDb();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.userId !== userId || s.id === keepSessionId);
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

/** Every customer profile in one business. */
export function getCustomerProfiles(tenantId: string): CustomerProfile[] {
  return readDb().customerProfiles.filter((profile) => profile.tenantId === tenantId);
}

/**
 * Suppresses one memory: "that's wrong" or "don't bring that up".
 *
 * The row stays, marked forgotten, so the same call cannot quietly teach it
 * back; `hard` erases it instead. Returns false when the item is not this
 * customer's in this business.
 */
export function forgetMemoryItem(
  tenantId: string,
  customerId: string,
  itemId: string,
  options: { hard: boolean } = { hard: false }
): boolean {
  const db = readDb();
  const index = db.memoryItems.findIndex(
    (item) => item.id === itemId && item.tenantId === tenantId && item.customerId === customerId
  );
  if (index < 0) return false;

  if (options.hard) {
    db.memoryItems.splice(index, 1);
  } else {
    db.memoryItems[index] = {
      ...db.memoryItems[index],
      status: "forgotten",
      updatedAt: new Date().toISOString(),
    };
  }
  writeDb(db);
  return true;
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


// ------------------------------------------------------------
// PASSWORD RESETS
// ------------------------------------------------------------

/** Opens a reset, closing any earlier ones for the same user: only the newest code works. */
export function openPasswordReset(reset: PasswordReset): void {
  const db = readDb();
  const now = new Date().toISOString();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const existing of db.passwordResets) {
    if (existing.userId === reset.userId && !existing.closedAt) existing.closedAt = now;
  }
  // Old rows are swept on write so the list cannot grow without bound.
  db.passwordResets = db.passwordResets.filter(
    (existing) => new Date(existing.createdAt).getTime() > cutoff
  );
  db.passwordResets.push(reset);
  writeDb(db);
}

export function getOpenPasswordReset(userId: string): PasswordReset | undefined {
  return readDb()
    .passwordResets.filter((reset) => reset.userId === userId && !reset.closedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function updatePasswordReset(id: string, updates: Partial<PasswordReset>): void {
  const db = readDb();
  const reset = db.passwordResets.find((candidate) => candidate.id === id);
  if (!reset) return;
  Object.assign(reset, updates);
  writeDb(db);
}

// ------------------------------------------------------------
// CAMPAIGNS (Sarvam)
// ------------------------------------------------------------
//
// Tenant-scoped like memory: every accessor takes the tenant and filters on it.

export function getCampaignRuns(tenantId: string): CampaignRun[] {
  return readDb()
    .campaignRuns.filter((campaign) => campaign.tenantId === tenantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getCampaignRun(tenantId: string, id: string): CampaignRun | undefined {
  return readDb().campaignRuns.find((campaign) => campaign.id === id && campaign.tenantId === tenantId);
}

/**
 * Removes values that are a predicate says are junk from everything derived
 * from calls: call-record text fields, rolling call summaries, and memory
 * items (deleted outright — they were never something a customer said).
 * One write. Returns what changed, for the log.
 */
export function scrubDerivedText(isJunk: (value: unknown) => boolean): { calls: number; summaries: number; memories: number } {
  const db = readDb();
  const fields = [
    "aiSummary", "objection", "customerRequirement", "painPoints", "budgetIndication",
    "timelineToDecide", "authorityLevel", "competitorMentioned", "chosenNextStep", "nextAction",
  ] as const;
  let calls = 0;
  let summaries = 0;
  for (const record of db.callRecords) {
    let touched = false;
    for (const field of fields) {
      if (isJunk(record[field])) {
        (record as unknown as Record<string, unknown>)[field] = null;
        touched = true;
      }
    }
    if (touched) calls++;
  }
  for (const profile of db.customerProfiles) {
    for (const entry of profile.recentSummaries) {
      for (const field of ["summary", "objection", "nextStep", "interest"] as const) {
        if (isJunk(entry[field])) {
          entry[field] = null;
          summaries++;
        }
      }
    }
  }
  const before = db.memoryItems.length;
  db.memoryItems = db.memoryItems.filter((item) => !isJunk(item.value) && !isJunk(item.phrase));
  const memories = before - db.memoryItems.length;
  if (calls || summaries || memories) writeDb(db);
  return { calls, summaries, memories };
}

// ------------------------------------------------------------
// INBOUND SETTINGS
// ------------------------------------------------------------

export function getInboundSettings(tenantId: string): InboundSettings | undefined {
  return readDb().inboundSettings.find((settings) => settings.tenantId === tenantId);
}

/** For the background tasks and the webhook, which work across workspaces. */
export function getAllInboundSettings(): InboundSettings[] {
  return readDb().inboundSettings;
}

/** The workspace an inbound call belongs to, from the deployment that answered it. */
// ------------------------------------------------------------
// Voice provider configuration, per workspace
// ------------------------------------------------------------

export interface WorkspaceProfile {
  tenantId: string;
  agentConfig: Partial<AgentConfig>;
  callingWindow: CallingWindow | null;
  updatedAt: string;
}

export function getProviderConfig(tenantId: string): WorkspaceProviderConfig | undefined {
  return readDb().providerConfigs.find((config) => config.tenantId === tenantId);
}

export function getAllProviderConfigs(): WorkspaceProviderConfig[] {
  return readDb().providerConfigs;
}

export function saveProviderConfig(config: WorkspaceProviderConfig): WorkspaceProviderConfig {
  const db = readDb();
  const index = db.providerConfigs.findIndex((existing) => existing.tenantId === config.tenantId);
  if (index >= 0) db.providerConfigs[index] = config;
  else db.providerConfigs.push(config);
  writeDb(db);
  return config;
}

/** The workspace a webhook token belongs to, or undefined when it matches none. */

/** Opens a workspace on a session. The caller must already have checked the membership. */
export function setSessionTenant(sessionId: string, tenantId: string): void {
  const db = readDb();
  const session = db.sessions.find((entry) => entry.id === sessionId);
  if (!session) return;
  session.tenantId = tenantId;
  writeDb(db);
}

// ------------------------------------------------------------
// Workspace membership — who may open which workspace
// ------------------------------------------------------------

/** Every membership row, including revoked ones. */
export function getMemberships(): WorkspaceMembership[] {
  return readDb().memberships;
}

/** The workspaces this account may open, newest grant last. */
export function membershipsForUser(userId: string): WorkspaceMembership[] {
  return readDb().memberships.filter((m) => m.userId === userId && m.status === "active");
}

/** The people who may open this workspace. */
export function membershipsForTenant(tenantId: string): WorkspaceMembership[] {
  return readDb().memberships.filter((m) => m.tenantId === tenantId && m.status === "active");
}

/**
 * This account's active membership in one workspace, or undefined.
 *
 * This is the authorisation check: a workspace id from a client means nothing
 * until it comes back from here.
 */
export function findMembership(userId: string, tenantId: string): WorkspaceMembership | undefined {
  return readDb().memberships.find(
    (m) => m.userId === userId && m.tenantId === tenantId && m.status === "active"
  );
}

/**
 * Grants access, or returns the grant that already exists.
 *
 * One account has at most one membership per workspace: granting twice is the
 * same grant, so repeating it is harmless and changes nothing.
 */
export function grantMembership(input: {
  userId: string;
  tenantId: string;
  role?: WorkspaceMembership["role"];
  createdBy?: string | null;
}): WorkspaceMembership {
  const db = readDb();
  const existing = db.memberships.find((m) => m.userId === input.userId && m.tenantId === input.tenantId);
  if (existing) {
    if (existing.status !== "active") {
      existing.status = "active";
      writeDb(db);
    }
    return existing;
  }

  const membership: WorkspaceMembership = {
    id: `wm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    tenantId: input.tenantId,
    role: input.role ?? "owner",
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy ?? null,
    lastAccessedAt: null,
  };
  db.memberships.push(membership);
  writeDb(db);
  return membership;
}

/** Records that this workspace was opened, for the selector's ordering. */
export function touchMembership(userId: string, tenantId: string): void {
  const db = readDb();
  const membership = db.memberships.find((m) => m.userId === userId && m.tenantId === tenantId);
  if (!membership) return;
  membership.lastAccessedAt = new Date().toISOString();
  writeDb(db);
}

/**
 * Gives every existing account a membership in the workspace it was created
 * in, which is exactly the access it already had.
 *
 * Idempotent: running it twice grants nothing new. It never invents access —
 * an account is only ever given the workspace on its own record, so nobody
 * gains sight of a workspace they could not already see.
 */
export function migrateMemberships(): { granted: number; alreadyPresent: number; skipped: string[] } {
  const db = readDb();
  let granted = 0;
  let alreadyPresent = 0;
  const skipped: string[] = [];

  for (const user of db.users) {
    if (!user.tenantId) {
      skipped.push(`${user.id} has no workspace on its record`);
      continue;
    }
    if (!db.tenants.some((tenant) => tenant.id === user.tenantId)) {
      skipped.push(`${user.id} points at missing workspace ${user.tenantId}`);
      continue;
    }
    const existing = db.memberships.find((m) => m.userId === user.id && m.tenantId === user.tenantId);
    if (existing) {
      alreadyPresent++;
      continue;
    }
    db.memberships.push({
      id: `wm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role === "owner" ? "owner" : "member",
      status: "active",
      createdAt: user.createdAt ?? new Date().toISOString(),
      createdBy: null,
      lastAccessedAt: null,
    });
    granted++;
  }

  if (granted > 0) writeDb(db);
  return { granted, alreadyPresent, skipped };
}

export function findTenantByWebhookToken(token: string): string | undefined {
  if (!token) return undefined;
  return readDb().providerConfigs.find((config) => config.webhookToken === token)?.tenantId;
}

// ------------------------------------------------------------
// Company profile and calling hours, per workspace
// ------------------------------------------------------------

export function getWorkspaceProfile(tenantId: string): WorkspaceProfile | undefined {
  return readDb().workspaceProfiles.find((profile) => profile.tenantId === tenantId);
}

export function saveWorkspaceProfile(profile: WorkspaceProfile): WorkspaceProfile {
  const db = readDb();
  const next = { ...profile, updatedAt: new Date().toISOString() };
  const index = db.workspaceProfiles.findIndex((existing) => existing.tenantId === profile.tenantId);
  if (index >= 0) db.workspaceProfiles[index] = next;
  else db.workspaceProfiles.push(next);
  writeDb(db);
  return next;
}

export function findInboundSettingsByDeployment(deploymentId: string): InboundSettings | undefined {
  return readDb().inboundSettings.find((settings) => settings.deploymentId === deploymentId);
}

export function saveInboundSettings(settings: InboundSettings): InboundSettings {
  const db = readDb();
  const next = { ...settings, updatedAt: new Date().toISOString() };
  const index = db.inboundSettings.findIndex((existing) => existing.tenantId === settings.tenantId);
  if (index >= 0) db.inboundSettings[index] = next;
  else db.inboundSettings.push(next);
  writeDb(db);
  return next;
}

/** Every workspace's campaigns — for the background results sync only. */
export function getAllCampaignRuns(): CampaignRun[] {
  return readDb().campaignRuns;
}

/** For the webhook, which knows only Sarvam's id. */
export function findCampaignRunByProviderId(providerCampaignId: string): CampaignRun | undefined {
  return readDb().campaignRuns.find((campaign) => campaign.providerCampaignId === providerCampaignId);
}

export function saveCampaignRun(campaign: CampaignRun): CampaignRun {
  const db = readDb();
  const index = db.campaignRuns.findIndex(
    (existing) => existing.id === campaign.id && existing.tenantId === campaign.tenantId
  );
  const next = { ...campaign, updatedAt: new Date().toISOString() };
  if (index >= 0) db.campaignRuns[index] = next;
  else db.campaignRuns.push(next);
  writeDb(db);
  return next;
}

// ------------------------------------------------------------
// EMAIL CHANGES
// ------------------------------------------------------------

/** Opens an email change, closing earlier ones for the user: only the newest code works. */
export function openEmailChange(change: EmailChange): void {
  const db = readDb();
  const now = new Date().toISOString();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const existing of db.emailChanges) {
    if (existing.userId === change.userId && !existing.closedAt) existing.closedAt = now;
  }
  db.emailChanges = db.emailChanges.filter(
    (existing) => new Date(existing.createdAt).getTime() > cutoff
  );
  db.emailChanges.push(change);
  writeDb(db);
}

export function getOpenEmailChange(userId: string): EmailChange | undefined {
  return readDb()
    .emailChanges.filter((change) => change.userId === userId && !change.closedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function updateEmailChange(id: string, updates: Partial<EmailChange>): void {
  const db = readDb();
  const change = db.emailChanges.find((candidate) => candidate.id === id);
  if (!change) return;
  Object.assign(change, updates);
  writeDb(db);
}

// ------------------------------------------------------------
// NOTIFICATION SETTINGS
// ------------------------------------------------------------

export function getNotificationSettings(tenantId: string): NotificationSettings {
  return (
    readDb().notificationSettings.find((settings) => settings.tenantId === tenantId) ?? {
      tenantId,
      recipient: null,
      // Off until someone turns them on: an email nobody asked for is spam.
      emailAlerts: false,
      dailySummary: false,
      lastSummaryDate: null,
      updatedAt: new Date(0).toISOString(),
    }
  );
}

export function getAllNotificationSettings(): NotificationSettings[] {
  return readDb().notificationSettings;
}

export function saveNotificationSettings(
  tenantId: string,
  updates: Partial<Omit<NotificationSettings, "tenantId">>
): NotificationSettings {
  const db = readDb();
  const current = getNotificationSettings(tenantId);
  const next: NotificationSettings = {
    ...current,
    ...updates,
    tenantId,
    updatedAt: new Date().toISOString(),
  };
  const index = db.notificationSettings.findIndex((settings) => settings.tenantId === tenantId);
  if (index >= 0) db.notificationSettings[index] = next;
  else db.notificationSettings.push(next);
  writeDb(db);
  return next;
}

/** Every account in one workspace. */
export function getUsersForTenant(tenantId: string): User[] {
  return readDb().users.filter((user) => user.tenantId === tenantId);
}

/**
 * One-time backfill: stamps webhook deliveries with the workspace of the call
 * they belong to. Rows that match no call are left unscoped on purpose.
 */
export function stampWebhookLogTenants(
  tenantByAttemptId: Map<string, string>
): { events: number; receipts: number; unmapped: number } {
  const db = readDb();
  let events = 0;
  let receipts = 0;
  let unmapped = 0;

  for (const event of db.rawEvents) {
    if (event.tenantId !== undefined && event.tenantId !== null) continue;
    const tenantId = event.attemptId ? tenantByAttemptId.get(event.attemptId) : undefined;
    if (tenantId) {
      event.tenantId = tenantId;
      events++;
    } else {
      event.tenantId = null;
      unmapped++;
    }
  }

  for (const receipt of db.webhookReceipts) {
    if (receipt.tenantId !== undefined && receipt.tenantId !== null) continue;
    const tenantId = tenantByAttemptId.get(receipt.attemptId);
    if (tenantId) {
      receipt.tenantId = tenantId;
      receipts++;
    } else {
      receipt.tenantId = null;
    }
  }

  if (events || receipts || unmapped) writeDb(db);
  return { events, receipts, unmapped };
}

// ------------------------------------------------------------
// Deleting a workspace
// ------------------------------------------------------------

export interface WorkspaceDeletionCounts {
  leads: number;
  callRecords: number;
  followUps: number;
  customers: number;
  memoryItems: number;
  campaigns: number;
  webhookEvents: number;
  users: number;
  recordings: number;
}

/**
 * Removes a workspace and everything that exists because of it.
 *
 * A workspace is a company's whole history, so a half-delete would be worse
 * than none: its calls, customers and memory are removed with it, in one
 * write, along with the accounts that could sign into it. Its inbound
 * deployment at Sarvam is NOT touched — that lives in the provider and is the
 * operator's to remove, and this function must never reach outside the
 * database.
 *
 * Returns what was removed, or null when no such workspace exists.
 */
export function deleteTenant(tenantId: string): WorkspaceDeletionCounts | null {
  const db = readDb();
  if (!db.tenants.some((tenant) => tenant.id === tenantId)) return null;

  const owned = <T extends { tenantId?: string | null }>(rows: T[]) =>
    rows.filter((row) => row.tenantId === tenantId);

  const leadIds = new Set(owned(db.leads).map((lead) => lead.id));
  const counts: WorkspaceDeletionCounts = {
    leads: leadIds.size,
    callRecords: owned(db.callRecords).length,
    followUps: owned(db.followUps).length,
    customers: owned(db.customerProfiles).length,
    memoryItems: owned(db.memoryItems).length,
    campaigns: owned(db.campaignRuns).length,
    webhookEvents: owned(db.rawEvents).length + owned(db.webhookReceipts).length,
    users: owned(db.users).length,
    recordings: 0,
  };

  // The recordings of this workspace's calls, before the records go.
  for (const record of owned(db.callRecords)) {
    if (!record.providerInteractionId) continue;
    const safe = record.providerInteractionId.replace(/[^A-Za-z0-9-]/g, "_");
    for (const extension of ["wav", "mp3"]) {
      const dir = path.join(DATA_DIR, "recordings");
      const file = path.join(dir, `${safe}.${extension}`);
      try {
        // Belt and braces: a crafted id must not reach outside the folder.
        if (file.startsWith(dir + path.sep) && fs.existsSync(file)) {
          fs.unlinkSync(file);
          counts.recordings++;
        }
      } catch {
        // A file that cannot be removed must not abandon the rest of the delete.
      }
    }
  }

  const keep = <T extends { tenantId?: string | null }>(rows: T[]) =>
    rows.filter((row) => row.tenantId !== tenantId);

  db.leads = keep(db.leads);
  db.callRecords = keep(db.callRecords);
  db.followUps = keep(db.followUps);
  db.customerProfiles = keep(db.customerProfiles);
  db.memoryItems = keep(db.memoryItems);
  db.campaignRuns = keep(db.campaignRuns);
  db.inboundSettings = keep(db.inboundSettings);
  db.providerConfigs = keep(db.providerConfigs);
  db.workspaceProfiles = keep(db.workspaceProfiles);
  db.notificationSettings = keep(db.notificationSettings);
  db.rawEvents = keep(db.rawEvents);
  db.webhookReceipts = keep(db.webhookReceipts);

  // Access to this workspace ends for everyone.
  db.memberships = db.memberships.filter((membership) => membership.tenantId !== tenantId);

  // An account is only removed when this was its last workspace. One person
  // may own several, and deleting one of them must not delete the person.
  const stillHasAWorkspace = (userId: string) =>
    db.memberships.some((membership) => membership.userId === userId && membership.status === "active");
  const removedUsers = db.users.filter((user) => user.tenantId === tenantId && !stillHasAWorkspace(user.id));
  const userIds = new Set(removedUsers.map((user) => user.id));
  db.users = db.users.filter((user) => !userIds.has(user.id));
  counts.users = removedUsers.length;

  // A session looking at this workspace is over; one belonging to a surviving
  // account is sent back to whichever workspace it still has.
  db.sessions = db.sessions.filter((session) => !userIds.has(session.userId));
  for (const session of db.sessions) {
    if (session.tenantId !== tenantId) continue;
    const remaining = db.memberships.find((m) => m.userId === session.userId && m.status === "active");
    session.tenantId = remaining?.tenantId ?? "";
  }
  db.passwordResets = db.passwordResets.filter((reset) => !userIds.has(reset.userId));
  db.emailChanges = db.emailChanges.filter((change) => !userIds.has(change.userId));

  db.tenants = db.tenants.filter((tenant) => tenant.id !== tenantId);
  if (db.legacyTenantId === tenantId) db.legacyTenantId = null;

  writeDb(db);
  console.log(
    `WORKSPACE_DELETED tenant=${tenantId} leads=${counts.leads} calls=${counts.callRecords} customers=${counts.customers} users=${counts.users}`
  );
  return counts;
}

// ------------------------------------------------------------
// HOSPITAL OPERATIONS
//
// Every reader takes a tenantId and filters by it here, so a caller cannot
// forget to scope and read another hospital's patients. Writers refuse a
// record whose tenantId does not match the one asked for.
// ------------------------------------------------------------

function scoped<T extends { tenantId: string }>(rows: T[], tenantId: string): T[] {
  return rows.filter((row) => row.tenantId === tenantId);
}

/** Upserts into a collection, keyed on id within one workspace. */
function upsert<T extends { id: string; tenantId: string }>(rows: T[], record: T): T {
  const index = rows.findIndex((row) => row.id === record.id && row.tenantId === record.tenantId);
  if (index >= 0) rows[index] = record;
  else rows.push(record);
  return record;
}

export function getDoctors(tenantId: string): Doctor[] {
  return scoped(readDb().doctors, tenantId);
}

export function getDoctor(tenantId: string, id: string): Doctor | undefined {
  return readDb().doctors.find((doctor) => doctor.id === id && doctor.tenantId === tenantId);
}

export function saveDoctor(doctor: Doctor): Doctor {
  const db = readDb();
  const next = { ...doctor, updatedAt: new Date().toISOString() };
  upsert(db.doctors, next);
  writeDb(db);
  return next;
}

export function deleteDoctor(tenantId: string, id: string): boolean {
  const db = readDb();
  const before = db.doctors.length;
  db.doctors = db.doctors.filter((doctor) => !(doctor.id === id && doctor.tenantId === tenantId));
  if (db.doctors.length === before) return false;
  writeDb(db);
  return true;
}

export function getAppointments(tenantId: string): Appointment[] {
  return scoped(readDb().appointments, tenantId);
}

export function getAppointment(tenantId: string, id: string): Appointment | undefined {
  return readDb().appointments.find((row) => row.id === id && row.tenantId === tenantId);
}

export function saveAppointment(appointment: Appointment): Appointment {
  const db = readDb();
  const next = { ...appointment, updatedAt: new Date().toISOString() };
  upsert(db.appointments, next);
  writeDb(db);
  return next;
}

export function deleteAppointment(tenantId: string, id: string): boolean {
  const db = readDb();
  const before = db.appointments.length;
  db.appointments = db.appointments.filter((row) => !(row.id === id && row.tenantId === tenantId));
  if (db.appointments.length === before) return false;
  // The appointment goes; what happened to it does not. Its events and the
  // calls it produced stay, so a removal can still be accounted for.
  writeDb(db);
  return true;
}

export function getAppointmentEvents(tenantId: string, appointmentId?: string): AppointmentEvent[] {
  const rows = scoped(readDb().appointmentEvents, tenantId);
  return appointmentId ? rows.filter((row) => row.appointmentId === appointmentId) : rows;
}

export function recordAppointmentEvent(event: AppointmentEvent): AppointmentEvent {
  const db = readDb();
  db.appointmentEvents.push(event);
  writeDb(db);
  return event;
}

export function getReminders(tenantId: string): Reminder[] {
  return scoped(readDb().reminders, tenantId);
}

export function getReminder(tenantId: string, id: string): Reminder | undefined {
  return readDb().reminders.find((row) => row.id === id && row.tenantId === tenantId);
}

export function getReminderForAppointment(tenantId: string, appointmentId: string): Reminder | undefined {
  return readDb().reminders.find(
    (row) => row.tenantId === tenantId && row.appointmentId === appointmentId && row.status !== "cancelled"
  );
}

/** The reminder a given call was placed for, if any. Scoped to the workspace. */
export function getReminderByCallId(tenantId: string, callId: string): Reminder | undefined {
  return readDb().reminders.find((row) => row.tenantId === tenantId && row.callId === callId);
}

/**
 * The reminder for one appointment in a batch campaign, matched by the Sarvam
 * campaign id and the appointment id (the cohort's user_identifier). Not
 * tenant-scoped: a campaign webhook is how Tringlo first learns of the attempt,
 * and the campaign id is Tringlo's own, so it identifies the workspace.
 */
export function findReminderByProviderCampaign(providerCampaignId: string, appointmentId: string): Reminder | undefined {
  return readDb().reminders.find(
    (row) => row.providerCampaignId === providerCampaignId && row.appointmentId === appointmentId
  );
}

export function saveReminder(reminder: Reminder): Reminder {
  const db = readDb();
  const next = { ...reminder, updatedAt: new Date().toISOString() };
  upsert(db.reminders, next);
  writeDb(db);
  return next;
}

/**
 * Reminders ready to be placed, across every hospital.
 *
 * Used by the one server-side worker, which is why this is the only hospital
 * reader that is not scoped to a tenant. A live lock means another pass holds
 * it; a stale one is recoverable.
 */
export function getDueReminders(now: number, lockTimeoutMs: number): Reminder[] {
  return readDb().reminders.filter((reminder) => {
    if (reminder.status !== "scheduled" && reminder.status !== "due") return false;
    if (reminder.lockedAt && now - new Date(reminder.lockedAt).getTime() < lockTimeoutMs) return false;
    return new Date(reminder.dueAt).getTime() <= now;
  });
}

export function getHospitalFaqs(tenantId: string): HospitalFaq[] {
  return scoped(readDb().hospitalFaqs, tenantId);
}

export function saveHospitalFaq(faq: HospitalFaq): HospitalFaq {
  const db = readDb();
  const next = { ...faq, updatedAt: new Date().toISOString() };
  upsert(db.hospitalFaqs, next);
  writeDb(db);
  return next;
}

/**
 * Counts one use of a FAQ, without touching `updatedAt`.
 *
 * The answer's last-updated timestamp is what tells staff whether the wording
 * is still current, so reading a FAQ out to a caller must not move it.
 */
export function recordFaqUse(tenantId: string, id: string): void {
  const db = readDb();
  const faq = db.hospitalFaqs.find((row) => row.id === id && row.tenantId === tenantId);
  if (!faq) return;
  faq.usedCount = (faq.usedCount ?? 0) + 1;
  faq.lastUsedAt = new Date().toISOString();
  writeDb(db);
}

export function deleteHospitalFaq(tenantId: string, id: string): boolean {
  const db = readDb();
  const before = db.hospitalFaqs.length;
  db.hospitalFaqs = db.hospitalFaqs.filter((row) => !(row.id === id && row.tenantId === tenantId));
  if (db.hospitalFaqs.length === before) return false;
  writeDb(db);
  return true;
}

export function getHospitalProfile(tenantId: string): HospitalProfile | undefined {
  return readDb().hospitalProfiles.find((row) => row.tenantId === tenantId);
}

/** Every workspace running the hospital panel, for the server's own workers. */
export function getHospitalProfiles(): HospitalProfile[] {
  return readDb().hospitalProfiles;
}

export function saveHospitalProfile(profile: HospitalProfile): HospitalProfile {
  const db = readDb();
  const next = { ...profile, updatedAt: new Date().toISOString() };
  const index = db.hospitalProfiles.findIndex((row) => row.tenantId === profile.tenantId);
  if (index >= 0) db.hospitalProfiles[index] = next;
  else db.hospitalProfiles.push(next);
  writeDb(db);
  return next;
}

export function getHospitalAudit(tenantId: string, limit = 200): HospitalAuditEvent[] {
  return scoped(readDb().hospitalAudit, tenantId)
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export function recordHospitalAudit(event: HospitalAuditEvent): HospitalAuditEvent {
  const db = readDb();
  db.hospitalAudit.push(event);
  // Kept bounded like the other logs: the newest 2000 are what a hospital
  // would ever look back through.
  if (db.hospitalAudit.length > 2000) db.hospitalAudit = db.hospitalAudit.slice(-2000);
  writeDb(db);
  return event;
}

// ------------------------------------------------------------
// Hospital intake records
// ------------------------------------------------------------

export function getQuestionnaireSessions(tenantId: string): QuestionnaireSession[] {
  return scoped(readDb().questionnaireSessions, tenantId);
}

export function getQuestionnaireSession(tenantId: string, id: string): QuestionnaireSession | undefined {
  return readDb().questionnaireSessions.find((row) => row.id === id && row.tenantId === tenantId);
}

/** The session a caller is part way through, if any. */
export function getOpenQuestionnaireSession(tenantId: string, patientLeadId: string): QuestionnaireSession | undefined {
  return readDb().questionnaireSessions.find(
    (row) =>
      row.tenantId === tenantId &&
      row.patientLeadId === patientLeadId &&
      (row.status === "consent_pending" || row.status === "in_progress")
  );
}

export function saveQuestionnaireSession(session: QuestionnaireSession): QuestionnaireSession {
  const db = readDb();
  const next = { ...session, updatedAt: new Date().toISOString() };
  upsert(db.questionnaireSessions, next);
  writeDb(db);
  return next;
}

export function getMedicalHistories(tenantId: string): MedicalHistoryRecord[] {
  return scoped(readDb().medicalHistories, tenantId);
}

export function getMedicalHistory(tenantId: string, id: string): MedicalHistoryRecord | undefined {
  return readDb().medicalHistories.find((row) => row.id === id && row.tenantId === tenantId);
}

/** The one history for a canonical patient id, by the key that makes it one. */
export function getMedicalHistoryByPatient(tenantId: string, canonicalPatientId: string): MedicalHistoryRecord | undefined {
  return readDb().medicalHistories.find(
    (row) => row.tenantId === tenantId && row.canonicalPatientId === canonicalPatientId
  );
}

/**
 * Writes a history, refusing to make a second one for the same patient.
 *
 * This is the one-history-per-patient rule as a write barrier rather than a
 * convention. Code above may have the check too, but a bug up there becomes a
 * refused write down here instead of a duplicate record.
 */
export function saveMedicalHistory(record: MedicalHistoryRecord): MedicalHistoryRecord {
  const db = readDb();
  const clash = db.medicalHistories.find(
    (row) =>
      row.tenantId === record.tenantId &&
      row.canonicalPatientId === record.canonicalPatientId &&
      row.id !== record.id
  );
  if (clash) {
    throw new Error(
      `A medical history already exists for patient ${record.canonicalPatientId} in this workspace (${clash.id}). Update it rather than creating another.`
    );
  }
  const next = { ...record, updatedAt: new Date().toISOString() };
  upsert(db.medicalHistories, next);
  writeDb(db);
  return next;
}

export function getHistoryReports(tenantId: string): HistoryReport[] {
  return scoped(readDb().historyReports, tenantId);
}

export function getHistoryReport(tenantId: string, id: string): HistoryReport | undefined {
  return readDb().historyReports.find((row) => row.id === id && row.tenantId === tenantId);
}

export function saveHistoryReport(report: HistoryReport): HistoryReport {
  const db = readDb();
  const next = { ...report, updatedAt: new Date().toISOString() };
  upsert(db.historyReports, next);
  writeDb(db);
  return next;
}

export function getVisitNotes(tenantId: string): VisitNote[] {
  return scoped(readDb().visitNotes, tenantId);
}

export function saveVisitNote(note: VisitNote): VisitNote {
  const db = readDb();
  upsert(db.visitNotes, note);
  writeDb(db);
  return note;
}

export function getHospitalFollowUps(tenantId: string): HospitalFollowUp[] {
  return scoped(readDb().hospitalFollowUps, tenantId);
}

export function getHospitalFollowUp(tenantId: string, id: string): HospitalFollowUp | undefined {
  return readDb().hospitalFollowUps.find((row) => row.id === id && row.tenantId === tenantId);
}

export function saveHospitalFollowUp(followUp: HospitalFollowUp): HospitalFollowUp {
  const db = readDb();
  const next = { ...followUp, updatedAt: new Date().toISOString() };
  upsert(db.hospitalFollowUps, next);
  writeDb(db);
  return next;
}

export function getUnansweredInquiries(tenantId: string): UnansweredInquiry[] {
  return scoped(readDb().unansweredInquiries, tenantId);
}

export function getUnansweredInquiry(tenantId: string, id: string): UnansweredInquiry | undefined {
  return readDb().unansweredInquiries.find((row) => row.id === id && row.tenantId === tenantId);
}

export function saveUnansweredInquiry(inquiry: UnansweredInquiry): UnansweredInquiry {
  const db = readDb();
  upsert(db.unansweredInquiries, inquiry);
  writeDb(db);
  return inquiry;
}

export function getCancellationRequests(tenantId: string): CancellationRequest[] {
  return scoped(readDb().cancellationRequests, tenantId);
}

export function getCancellationRequest(tenantId: string, id: string): CancellationRequest | undefined {
  return readDb().cancellationRequests.find((row) => row.id === id && row.tenantId === tenantId);
}

/** An outstanding request for an appointment, so one is not raised twice. */
export function getOpenCancellationRequest(tenantId: string, appointmentId: string): CancellationRequest | undefined {
  return readDb().cancellationRequests.find(
    (row) =>
      row.tenantId === tenantId &&
      row.appointmentId === appointmentId &&
      (row.status === "pending" || row.status === "submitted" || row.status === "failed")
  );
}

export function saveCancellationRequest(request: CancellationRequest): CancellationRequest {
  const db = readDb();
  const next = { ...request, updatedAt: new Date().toISOString() };
  upsert(db.cancellationRequests, next);
  writeDb(db);
  return next;
}

/**
 * The demonstration hospital server's patient directory.
 *
 * Only the demo adapter reads this. A live hospital's patients are never
 * copied in here — they stay in the hospital's own system.
 */
export function getHisPatients(tenantId: string): DemoHisPatient[] {
  return scoped(readDb().hisPatients, tenantId);
}

export function readProviderDirectory(tenantId: string): ProviderDirectory | undefined {
  return readDb().providerDirectories.find((row) => row.tenantId === tenantId);
}

export function writeProviderDirectory(directory: ProviderDirectory): ProviderDirectory {
  const db = readDb();
  const index = db.providerDirectories.findIndex((row) => row.tenantId === directory.tenantId);
  if (index >= 0) db.providerDirectories[index] = directory;
  else db.providerDirectories.push(directory);
  writeDb(db);
  return directory;
}

export function saveHisPatient(patient: DemoHisPatient): DemoHisPatient {
  const db = readDb();
  upsert(db.hisPatients, patient);
  writeDb(db);
  return patient;
}
