// ============================================================
// Dialo AI — Customer Identity
// ============================================================
//
// Memory is only useful if the same person resolves to the same profile on
// every call, and only safe if two different people never collapse into one.
//
// Identity here is (tenant, normalised phone). A lead row is not the identity:
// the same person is re-uploaded in a new CSV all the time, gets a new lead id,
// and must still be recognised. The phone number is what persists.
//
// The merge hazard §1 warns about is real — a shared office line, a recycled
// number, a family phone. This does not try to guess its way out of that.
// Instead it records every name seen against a number, and when a clearly
// different name appears the profile is marked ambiguous. The context builder
// then withholds personal facts from that profile and keeps only business
// context, so a wrong guess cannot put one person's private details in front
// of another.
// ============================================================

import { createHash } from "crypto";

/** India's national numbers are ten digits and never start with 0–5. */
const INDIA_NATIONAL_LENGTH = 10;

export interface NormalisedPhone {
  /** E.164 where it could be determined, e.g. +919876543210. */
  e164: string | null;
  /** The ten-digit national number, the key most lookups use. */
  national: string | null;
  /** What was passed in, kept for diagnostics. */
  raw: string;
  valid: boolean;
}

/**
 * Normalises an Indian phone number written any of the ways people write them.
 *
 * Handles +91, 0091, 91, a leading 0, spaces, hyphens, brackets and the
 * non-breaking spaces that arrive from spreadsheets.
 */
export function normalisePhone(raw: string | null | undefined): NormalisedPhone {
  const input = (raw ?? "").toString();
  const result: NormalisedPhone = { e164: null, national: null, raw: input, valid: false };
  if (!input.trim()) return result;

  // Everything that is not a digit goes, including the "+" — the country code
  // is recovered from the digits themselves below.
  const digits = input.replace(/\D/g, "");
  if (!digits) return result;

  let national = digits;

  // Strip the country code in the forms it actually arrives in.
  if (national.length > INDIA_NATIONAL_LENGTH) {
    if (national.startsWith("0091")) national = national.slice(4);
    else if (national.startsWith("091")) national = national.slice(3);
    else if (national.startsWith("91")) national = national.slice(2);
  }

  // A single leading zero is the domestic trunk prefix.
  while (national.length > INDIA_NATIONAL_LENGTH && national.startsWith("0")) {
    national = national.slice(1);
  }

  if (national.length !== INDIA_NATIONAL_LENGTH) {
    // Not an Indian mobile shape. Rather than guess, keep the digits so the
    // number is still usable as a key, but do not claim it is valid.
    result.national = digits.slice(-INDIA_NATIONAL_LENGTH) || null;
    return result;
  }

  // Indian mobile numbers begin 6–9. A ten-digit number starting lower is a
  // landline written without its STD code, which cannot be dialled as-is.
  if (!/^[6-9]/.test(national)) {
    result.national = national;
    return result;
  }

  result.national = national;
  result.e164 = `+91${national}`;
  result.valid = true;
  return result;
}

/**
 * The stable key a memory profile is stored under.
 *
 * Includes the tenant, so the same phone number in two businesses is two
 * separate profiles that can never see each other. Hashed so the key does not
 * carry a customer's phone number around in log lines and URLs.
 */
export function customerKey(tenantId: string, phone: string): string | null {
  const { national } = normalisePhone(phone);
  if (!national) return null;

  const digest = createHash("sha256")
    .update(`${tenantId}:${national}`, "utf-8")
    .digest("hex")
    .slice(0, 24);

  return `cust_${digest}`;
}

/**
 * Compares two names loosely enough to tolerate how they are actually typed.
 *
 * "Prajwal", "prajwal ", "Prajwal Kumar" and "Kumar Prajwal" are treated as the
 * same person; "Prajwal" and "Sahana" are not. The comparison is deliberately
 * generous: marking a profile ambiguous costs the customer some personalisation,
 * so it should happen on real disagreement rather than on a middle name.
 */
export function namesLikelyMatch(a: string, b: string): boolean {
  const tokens = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1);

  const first = tokens(a);
  const second = tokens(b);
  if (first.length === 0 || second.length === 0) return true; // nothing to disagree with

  // Any shared name part is enough. People are recorded with and without
  // surnames constantly, and in either order.
  return first.some((token) => second.includes(token));
}

/** A generic placeholder rather than a name someone actually gave. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const value = (name ?? "").trim().toLowerCase();
  if (!value) return true;
  return ["customer", "unknown", "lead", "test", "n/a", "na", "-"].includes(value);
}
