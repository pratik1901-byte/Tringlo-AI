// ============================================================
// Tringlo AI — Is this caller new, or do we know them?
// ============================================================
//
// One question, and the most consequential one in the hospital workflow,
// because each of the three answers leads somewhere different: a new patient
// is asked nine questions, a returning patient is not asked them again, and an
// unidentified caller is asked to identify themselves and told nothing about
// anybody's appointments.
//
// The rules, in the order they matter:
//
//   1. A phone number is not identity. It is shared between a family, kept by
//      the next owner of the number, and trivially spoofed. It narrows a
//      search and never concludes one.
//   2. "New" is a claim about the hospital's records, so only the hospital's
//      records can support it. It requires a lookup that came back with a
//      definite absence. An unreachable or unconfigured hospital server
//      produces `unverified`, never `new` — guessing wrong here creates a
//      duplicate patient.
//   3. Nothing about an existing patient is disclosed before the match is
//      confident. `disclosureAllowed` is the flag the callers check, and it is
//      true only for a confident match.
// ============================================================

import { getMedicalHistoryByPatient } from "@/lib/db";
import { hospitalServer, type HisPatientLookup } from "./his";
import type { PatientStatus } from "./records";

export interface IdentityResult {
  status: PatientStatus;
  /** The hospital's own patient id. Only ever set for a confident match. */
  canonicalPatientId: string | null;
  /** The name on the hospital's record, when we are entitled to it. */
  name: string | null;
  /** Which identifiers the hospital matched on. */
  matchedOn: string[];
  /** Whether this caller's information may be discussed with them. */
  disclosureAllowed: boolean;
  /** Whether a longitudinal history already exists for them. */
  hasHistory: boolean;
  /** What else is needed to identify them, for the agent to ask for. */
  needs: string[];
  /** Why the status is what it is, for the panel and the audit trail. */
  reason: string;
  /** True when the answer came from the demonstration stand-in. */
  demo: boolean;
}

/** What the agent should ask for when a caller cannot be identified. */
const CORROBORATION_NEEDED = [
  "the patient's date of birth",
  "or the hospital patient number, if they have it",
];

/**
 * Asks the hospital who this is.
 *
 * The identifiers offered are passed through as given; this function does not
 * decide that a phone number is enough, and neither does the adapter — the
 * hospital's matching rules do, and both implementations require a phone
 * number to be corroborated before they will call something a match.
 */
export async function identifyPatient(tenantId: string, lookup: HisPatientLookup): Promise<IdentityResult> {
  const server = hospitalServer(tenantId);

  if (!server.supports("patient_lookup")) {
    return {
      status: "unverified",
      canonicalPatientId: null,
      name: null,
      matchedOn: [],
      disclosureAllowed: false,
      hasHistory: false,
      needs: ["patient lookup against the hospital's system, which is not configured yet"],
      reason:
        "The hospital server cannot be asked who this caller is, so they are treated as unidentified rather than assumed to be new.",
      demo: server.mode === "demo",
    };
  }

  const answer = await server.findPatient(lookup);

  if (!answer.ok) {
    // An outage is not evidence of a new patient. This is the case that would
    // otherwise quietly create a second record for somebody the hospital has
    // known for years.
    return {
      status: "unverified",
      canonicalPatientId: null,
      name: null,
      matchedOn: [],
      disclosureAllowed: false,
      hasHistory: false,
      needs: CORROBORATION_NEEDED,
      reason: `The hospital server could not confirm this caller's identity: ${answer.problem}`,
      demo: server.mode === "demo",
    };
  }

  const match = answer.data;

  if (match.confidence === "match" && match.patientId) {
    const local = getMedicalHistoryByPatient(tenantId, match.patientId);
    return {
      status: "returning",
      canonicalPatientId: match.patientId,
      name: match.name,
      matchedOn: match.matchedOn,
      disclosureAllowed: true,
      hasHistory: match.hasHistory || Boolean(local),
      needs: [],
      reason: `The hospital identified this patient on ${match.matchedOn.join(" and ") || "its own rules"}.`,
      demo: match.demo,
    };
  }

  if (match.confidence === "none") {
    return {
      status: "new",
      canonicalPatientId: null,
      name: null,
      matchedOn: [],
      disclosureAllowed: false,
      hasHistory: false,
      needs: [],
      reason: "The hospital searched its records with the identifiers given and has no matching patient.",
      demo: match.demo,
    };
  }

  return {
    status: "unverified",
    canonicalPatientId: null,
    name: null,
    matchedOn: match.matchedOn,
    disclosureAllowed: false,
    hasHistory: false,
    needs: CORROBORATION_NEEDED,
    reason:
      match.candidates > 1
        ? `${match.candidates} hospital records could be this caller, so none of them is treated as theirs.`
        : "The identifiers given are not enough for the hospital to identify this caller.",
    demo: match.demo,
  };
}

/**
 * Whether a questionnaire should be run for this caller.
 *
 * Only a confirmed new patient. A returning patient already has a history and
 * must not be given a second one; an unidentified caller must be identified
 * first, because a history created now could not be attached to anybody.
 */
export function shouldCollectHistory(identity: IdentityResult): { collect: boolean; because: string } {
  if (identity.status === "new") {
    return { collect: true, because: "The hospital has no record of this patient." };
  }
  if (identity.status === "returning") {
    return {
      collect: false,
      because: identity.hasHistory
        ? "This patient already has a medical history on file. Anything new about today's visit is recorded as visit information instead."
        : "This patient is already known to the hospital, so their history is retrieved rather than collected again.",
    };
  }
  return {
    collect: false,
    because: "This caller has not been identified yet, so no medical history is created for them.",
  };
}
