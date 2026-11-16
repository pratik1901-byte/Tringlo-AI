// ============================================================
// Tringlo AI — Patient verification sessions
// ============================================================
//
// The backend's own record of who has proved their identity, and when. Issued
// only by `verify_patient`, after the hospital's records matched BOTH a phone
// number and a date of birth. Two readers:
//
//   - Maya's tools, which accept a verification id only while it is unexpired
//     and act only on appointments booked under the verified number;
//   - post-call processing, which acts on a reminder call's outcome only when
//     a verification for that appointment's patient was issued during that
//     call. What the agent *says* about identity is never proof of it.
//
// Held in this process's memory. A restart forgets every session, which fails
// closed: tools ask the caller to verify again, and a post-call result with no
// surviving evidence goes to staff review rather than being applied.
// ============================================================

import { randomBytes } from "node:crypto";

import { normalisePhone } from "@/lib/customers/identity";

/** How long a tool may use a verification after it was issued. */
export const VERIFICATION_TTL_MS = 30 * 60_000;
/** How long the record of an issued verification is kept as post-call evidence. */
const EVIDENCE_RETENTION_MS = 24 * 3600_000;
/** Clock slack either side of a call when matching evidence to it. */
const CALL_WINDOW_SLACK_MS = 5 * 60_000;

export interface PatientVerification {
  id: string;
  tenantId: string;
  phoneNational: string;
  patientId: string | null;
  name: string | null;
  issuedAt: number;
  expiresAt: number;
}

declare global {
  var __tringloPatientVerifications: Map<string, PatientVerification> | undefined;
}
const sessions = (globalThis.__tringloPatientVerifications ??= new Map<string, PatientVerification>());

function prune(now: number): void {
  for (const [id, entry] of sessions) if (now - entry.issuedAt > EVIDENCE_RETENTION_MS) sessions.delete(id);
}

/** Records a verification the hospital's records have just confirmed. */
export function issueVerification(input: {
  tenantId: string;
  phoneNational: string;
  patientId: string | null;
  name: string | null;
}): PatientVerification {
  const now = Date.now();
  prune(now);
  const verification: PatientVerification = {
    ...input,
    id: `pv_${randomBytes(16).toString("hex")}`,
    issuedAt: now,
    expiresAt: now + VERIFICATION_TTL_MS,
  };
  sessions.set(verification.id, verification);
  return verification;
}

export type VerificationCheck =
  | { ok: true; verification: PatientVerification }
  | { ok: false; code: "verification_required" | "verification_invalid" | "verification_expired" };

/** A verification usable by a tool right now: issued, this workspace, unexpired. */
export function activeVerification(tenantId: string, id: unknown): VerificationCheck {
  if (typeof id !== "string" || !id) return { ok: false, code: "verification_required" };
  const entry = sessions.get(id);
  if (!entry || entry.tenantId !== tenantId) return { ok: false, code: "verification_invalid" };
  if (entry.expiresAt <= Date.now()) return { ok: false, code: "verification_expired" };
  return { ok: true, verification: entry };
}

/**
 * Whether the backend verified this patient during this call.
 *
 * `claimedId` is a verification id the agent reported, if any. When given it
 * must resolve to an issued verification for this workspace and this phone
 * number, inside the call's window — a forged or mismatched id is a refusal,
 * not a reason to look elsewhere. When absent, any verification for this
 * patient's number issued inside the window counts, since that record is the
 * backend's own and owes nothing to what the agent reported.
 */
export function verifiedDuringCall(input: {
  tenantId: string;
  patientPhone: string;
  /** Epoch ms: the earliest the call can have started. */
  from: number | null;
  /** Epoch ms: when the call ended, or now. */
  to: number;
  claimedId?: string | null;
}): boolean {
  const phoneNational = normalisePhone(input.patientPhone).national;
  if (!phoneNational || input.from === null || !Number.isFinite(input.from)) return false;
  const from = input.from - CALL_WINDOW_SLACK_MS;
  const to = input.to + CALL_WINDOW_SLACK_MS;
  const fits = (entry: PatientVerification) =>
    entry.tenantId === input.tenantId && entry.phoneNational === phoneNational && entry.issuedAt >= from && entry.issuedAt <= to;

  if (input.claimedId) {
    const entry = sessions.get(input.claimedId);
    return Boolean(entry && fits(entry));
  }
  for (const entry of sessions.values()) if (fits(entry)) return true;
  return false;
}
