// ============================================================
// Hospital — who is this caller?
// ============================================================
//
// Asks the hospital's own system to identify somebody from the identifiers
// they have given, and says whether a preliminary history should be collected.
//
// Called mid-conversation, once the agent has asked for a date of birth or a
// patient number — never at the start of a call, because at the start the only
// identifier is the number that rang, and a number is not identity.
//
// Nothing about an existing patient's record is returned unless the hospital
// matched them confidently. An unverified caller gets back what to ask for and
// nothing else.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import { identifyPatient, shouldCollectHistory } from "@/lib/hospital/identity";
import { historyForPatient } from "@/lib/hospital/history";
import { audit } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const lookup = {
    phone: typeof body?.phone === "string" ? body.phone.trim() : null,
    name: typeof body?.name === "string" ? body.name.trim() : null,
    dateOfBirth: typeof body?.dateOfBirth === "string" ? body.dateOfBirth.trim() : null,
    patientId: typeof body?.patientId === "string" ? body.patientId.trim() : null,
  };

  if (!lookup.phone && !lookup.dateOfBirth && !lookup.patientId) {
    return NextResponse.json(
      { error: { message: "Give at least one identifier to look the patient up by." } },
      { status: 400, headers: noStore }
    );
  }

  const identity = await identifyPatient(auth.tenantId, lookup);
  const collect = shouldCollectHistory(identity);

  // Recorded whichever way it went: a lookup against a patient record is
  // itself something a hospital needs to be able to account for.
  audit(
    auth.tenantId,
    auth.user.id,
    `patient.identified_${identity.status}`,
    identity.canonicalPatientId ?? "unmatched",
    identity.reason
  );

  const history =
    identity.disclosureAllowed
      ? historyForPatient(auth.tenantId, { canonicalPatientId: identity.canonicalPatientId })
      : undefined;

  return NextResponse.json(
    {
      status: identity.status,
      // Only for a confident match. Unverified callers get nothing back.
      patientId: identity.canonicalPatientId,
      name: identity.disclosureAllowed ? identity.name : null,
      matchedOn: identity.matchedOn,
      needs: identity.needs,
      reason: identity.reason,
      demo: identity.demo,
      collectHistory: collect.collect,
      because: collect.because,
      history: history ? { id: history.id, updatedAt: history.updatedAt, storage: history.storage } : null,
    },
    { headers: noStore }
  );
}
