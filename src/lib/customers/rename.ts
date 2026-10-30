// ============================================================
// Tringlo AI — Naming a contact
// ============================================================
//
// A contact gets a real name in two ways: someone on the team types it in
// Leads, or an inbound caller who was not on file tells the agent their name.
// Either way the name is checked, written to the lead, carried onto that
// lead's calls and follow-ups (which keep a copy of the lead), recorded in
// customer memory, and sent to the inbound line so the next call greets them
// by name.
// ============================================================

import { ownedByTenant } from "@/lib/auth/guard";
import {
  getAllInboundSettings,
  getCallRecords,
  getCustomerProfiles,
  getFollowUps,
  getLead,
  saveCustomerProfile,
  saveInboundSettings,
  updateCallRecord,
  updateFollowUp,
  updateLead,
} from "@/lib/db";
import { isInstructionText } from "@/lib/providers/sarvam/instruction-text";
import type { CallRecord, FollowUp, Lead } from "@/lib/types";

import { isPlaceholderName, normalisePhone } from "./identity";

/** Words that fill a name slot without being a name. */
const NOT_A_NAME = new Set([
  "na", "n/a", "none", "null", "nil", "unknown", "unknown caller", "not provided", "not given", "not shared",
  "no name", "caller", "customer", "user", "sir", "madam", "maam", "ma'am", "anonymous", "declined", "refused",
]);

const INSTRUCTION_WORDS = new Set([
  "the", "name", "names", "caller", "callers", "customer", "customers", "user", "write", "here", "enter", "if", "of",
  "provided", "given", "stated", "mentioned", "call", "please", "my", "is", "their", "his", "her", "not", "unknown",
]);

/**
 * A cleaned-up person's name, or null when the value is not one. Letters in
 * any script, spaces, and . ' - only; 2–60 characters; no digits.
 */
export function cleanPersonName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > 60) return null;
  if (isInstructionText(value) || /^NO_[A-Z_]+$/.test(value)) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(value)) return null;
  if (NOT_A_NAME.has(value.toLowerCase()) || isPlaceholderName(value)) return null;
  // Sarvam returns its extraction prompt in place of a value on very short
  // calls ("The caller's name as stated…"). Names are short and do not contain
  // instruction words.
  const words = value.toLowerCase().split(/[\s.'-]+/).filter(Boolean);
  if (words.length > 4 || words.some((word) => INSTRUCTION_WORDS.has(word))) return null;
  // "pratik gaonkar" → "Pratik Gaonkar"; names already cased are left alone.
  return value === value.toLowerCase()
    ? value.replace(/(^|[\s'-])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase())
    : value;
}

/**
 * The name the person gave for themselves during an outbound call.
 *
 * Read from `stated_customer_name` and nothing else. `customer_name` is an
 * input Tringlo sets, and an agent echoes it — or its own default — back on the
 * way out, so trusting any other key is how a sample name becomes a customer's
 * name. `agentName` is refused: the agent must never hand back its own name as
 * the customer's.
 */
export function statedCustomerName(
  vars: Record<string, unknown> | null | undefined,
  agentName?: string | null
): string | null {
  const raw = vars?.stated_customer_name;
  const name = cleanPersonName(raw);
  if (!name) return null;
  if (agentName && name.toLowerCase() === agentName.trim().toLowerCase()) return null;
  return name;
}

/** Marks the workspace's inbound line as needing its known-caller list re-sent. */
export function requestKnownCallersResync(tenantId: string): void {
  const settings = getAllInboundSettings().find((entry) => entry.tenantId === tenantId);
  if (settings?.enabled && settings.deploymentId) saveInboundSettings({ ...settings, knownCallersStale: true });
}

/**
 * Renames a lead everywhere it is copied. `source` decides how memory treats
 * it: a name typed by the team is authoritative; a name a caller gave is one
 * more name seen for the number.
 */
export function renameLead(leadId: string, rawName: string, source: "team" | "caller" | "customer"): Lead | null {
  const lead = getLead(leadId);
  const name = cleanPersonName(rawName);
  if (!lead || !name) return null;
  if (lead.name === name) return lead;

  const updated = updateLead(leadId, { name });
  if (!updated) return null;

  for (const record of getCallRecords()) {
    if (record.leadId === leadId && record.lead) updateCallRecord(record.id, { lead: { ...record.lead, name } } as Partial<CallRecord>);
  }
  for (const followUp of getFollowUps()) {
    if (followUp.leadId === leadId && followUp.lead) updateFollowUp(followUp.id, { lead: { ...followUp.lead, name } } as Partial<FollowUp>);
  }

  // Customer memory keeps every name seen for the number, newest first.
  const tenantId = updated.tenantId ?? null;
  const national = normalisePhone(updated.phone).national;
  if (tenantId && national) {
    const profile = getCustomerProfiles(tenantId).find((entry) => entry.phoneNational === national);
    if (profile) {
      const names = [name, ...profile.names.filter((existing) => existing.toLowerCase() !== name.toLowerCase() && !isPlaceholderName(existing))];
      saveCustomerProfile({
        ...profile,
        names,
        // The team knows who this is; a caller's word alone does not settle a dispute.
        identityAmbiguous: source === "team" ? false : profile.identityAmbiguous,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (tenantId) requestKnownCallersResync(tenantId);
  console.log(`LEAD_RENAMED lead=${leadId} source=${source}`);
  return updated;
}

/** Whether this tenant may rename this lead. */
export function canRename(leadId: string, tenantId: string): boolean {
  return ownedByTenant(getLead(leadId), tenantId);
}
