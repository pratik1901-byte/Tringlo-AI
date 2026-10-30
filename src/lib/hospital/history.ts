// ============================================================
// Tringlo AI — One medical history per patient
// ============================================================
//
// The rule this module exists for: a patient has exactly one longitudinal
// medical history, for as long as they are a patient. Not one per call, not
// one per visit, not one per time somebody rang up with a new complaint.
//
// Three mechanisms hold it, deliberately overlapping:
//
//   1. The key. A history is keyed on the patient's canonical id, and the
//      database write refuses a second record under the same key — see
//      `saveMedicalHistory`. A bug in this file becomes a refused write rather
//      than a duplicate record.
//   2. Revisions. An update appends a revision carrying what each answer said
//      before, so nothing is overwritten and nobody needs a second record to
//      keep the old information.
//   3. Reconciliation. A patient the hospital had never seen is keyed on a
//      provisional id until the hospital issues a real one, and adopting that
//      id rewrites the existing record rather than starting another.
//
// Visit notes live here too, and are the pressure valve: "my knee is worse
// this week" is about one encounter, it goes in a visit note, and it is why
// nobody needs to create a second history to record it.
// ============================================================

import {
  getLeads,
  getMedicalHistories,
  getMedicalHistory,
  getMedicalHistoryByPatient,
  getQuestionnaireSession,
  getVisitNotes,
  saveMedicalHistory,
  saveVisitNote,
} from "@/lib/db";
import { hospitalServer } from "./his";
import {
  QUESTIONNAIRE,
  type MedicalHistoryRecord,
  type MedicalHistoryRevision,
  type QuestionnaireAnswer,
  type VisitNote,
} from "./records";
import { audit } from "./service";

/** The patient's name as Tringlo has it, so the panel is not showing an id. */
function patientName(tenantId: string, patientLeadId: string): string {
  const lead = getLeads().find((row) => row.tenantId === tenantId && row.id === patientLeadId);
  return lead?.name ?? "Unknown patient";
}

const ID = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** The provisional key for a patient the hospital does not yet know. */
export function provisionalPatientId(patientLeadId: string): string {
  return `provisional:${patientLeadId}`;
}

export function isProvisional(canonicalPatientId: string): boolean {
  return canonicalPatientId.startsWith("provisional:");
}

export function getHistory(tenantId: string, canonicalPatientId: string): MedicalHistoryRecord | undefined {
  return getMedicalHistoryByPatient(tenantId, canonicalPatientId);
}

/** A patient's history by either key, so a provisional one is still found. */
export function historyForPatient(
  tenantId: string,
  options: { canonicalPatientId?: string | null; patientLeadId?: string | null }
): MedicalHistoryRecord | undefined {
  if (options.canonicalPatientId) {
    const direct = getMedicalHistoryByPatient(tenantId, options.canonicalPatientId);
    if (direct) return direct;
  }
  if (options.patientLeadId) {
    const provisional = getMedicalHistoryByPatient(tenantId, provisionalPatientId(options.patientLeadId));
    if (provisional) return provisional;
    // A record created under a canonical id before this lead was linked.
    return getMedicalHistories(tenantId).find((row) => row.patientLeadId === options.patientLeadId);
  }
  return undefined;
}

export type HistoryWrite =
  | { ok: true; history: MedicalHistoryRecord; created: boolean; revision: MedicalHistoryRevision | null }
  | { ok: false; problem: string };

/**
 * Turns a finished questionnaire into the patient's history.
 *
 * Creates the record the first time and UPDATES it every time after. The
 * second call for the same patient is the case that matters: it produces a
 * revision, not a record, whatever the caller intended.
 */
export async function writeHistoryFromSession(tenantId: string, sessionId: string, actor: string): Promise<HistoryWrite> {
  const session = getQuestionnaireSession(tenantId, sessionId);
  if (!session) return { ok: false, problem: "No such questionnaire." };
  if (!session.consent?.granted) {
    return { ok: false, problem: "No consent was recorded, so nothing is written to a medical history." };
  }
  if (session.answers.length === 0) {
    return { ok: false, problem: "The questionnaire has no answers to record." };
  }

  const key = session.canonicalPatientId ?? provisionalPatientId(session.patientLeadId);
  const existing = historyForPatient(tenantId, {
    canonicalPatientId: session.canonicalPatientId,
    patientLeadId: session.patientLeadId,
  });

  const answers: Record<string, QuestionnaireAnswer> = {};
  for (const answer of session.answers) answers[answer.questionId] = answer;

  if (existing) {
    // Already has one. This is an update, and the previous answers survive it.
    return applyUpdate(tenantId, existing, answers, {
      actor,
      sessionId,
      note: "Answers from a further questionnaire.",
    });
  }

  const now = new Date().toISOString();
  let history: MedicalHistoryRecord;
  try {
    history = saveMedicalHistory({
      id: ID("mh"),
      tenantId,
      canonicalPatientId: key,
      provisional: isProvisional(key),
      patientLeadId: session.patientLeadId,
      patientName: patientName(tenantId, session.patientLeadId),
      consent: session.consent,
      answers,
      revisions: [],
      provenance: "patient_reported",
      storage: "tringlo_local",
      sync: { state: "not_attempted", at: null, reference: null, problem: null },
      originSessionId: session.id,
      createdAt: now,
      updatedAt: now,
      demo: session.demo,
    });
  } catch (failure) {
    // The write barrier refused it, which means a history appeared between the
    // lookup above and here. Update that one instead of failing the call.
    const raced = getMedicalHistoryByPatient(tenantId, key);
    if (!raced) return { ok: false, problem: failure instanceof Error ? failure.message : "The history could not be written." };
    return applyUpdate(tenantId, raced, answers, { actor, sessionId, note: "Answers from a further questionnaire." });
  }

  audit(tenantId, actor, "history.created", history.id, `patient ${key}`);
  const synced = await pushToHospital(tenantId, history, actor);
  return { ok: true, history: synced, created: true, revision: null };
}

/** Changes a patient's answers, keeping what they said before. */
export async function updateHistory(
  tenantId: string,
  historyId: string,
  changes: Record<string, { state: QuestionnaireAnswer["state"]; value?: string | null; note?: string | null }>,
  actor: string,
  note?: string | null
): Promise<HistoryWrite> {
  const history = getMedicalHistory(tenantId, historyId);
  if (!history) return { ok: false, problem: "No such medical history." };

  const now = new Date().toISOString();
  const answers: Record<string, QuestionnaireAnswer> = {};
  for (const [questionId, change] of Object.entries(changes)) {
    if (!QUESTIONNAIRE.some((question) => question.id === questionId)) {
      return { ok: false, problem: `"${questionId}" is not one of the ${QUESTIONNAIRE.length} questions.` };
    }
    answers[questionId] = {
      questionId,
      askedAt: now,
      answeredAt: now,
      state: change.state,
      value: change.state === "answered" ? (change.value ?? "").trim() || null : null,
      note: change.note ?? null,
    };
  }
  return applyUpdate(tenantId, history, answers, { actor, sessionId: null, note: note ?? null });
}

/**
 * The one write path for a change to an existing history.
 *
 * Builds the revision first, from what the record says now, so the previous
 * answer is captured before it is replaced. An update that touches nothing is
 * refused rather than recorded, so the revision list stays meaningful.
 */
async function applyUpdate(
  tenantId: string,
  history: MedicalHistoryRecord,
  answers: Record<string, QuestionnaireAnswer>,
  context: { actor: string; sessionId: string | null; note: string | null }
): Promise<HistoryWrite> {
  const changed: string[] = [];
  const previous: Record<string, string | null> = {};

  for (const [questionId, answer] of Object.entries(answers)) {
    const before = history.answers[questionId];
    const same = before && before.state === answer.state && (before.value ?? null) === (answer.value ?? null);
    if (same) continue;
    changed.push(questionId);
    previous[questionId] = before ? before.value : null;
  }

  if (changed.length === 0) {
    return { ok: true, history, created: false, revision: null };
  }

  const revision: MedicalHistoryRevision = {
    id: ID("rev"),
    at: new Date().toISOString(),
    actor: context.actor,
    sessionId: context.sessionId,
    changed,
    previous,
    note: context.note,
  };

  const merged: Record<string, QuestionnaireAnswer> = { ...history.answers };
  for (const questionId of changed) merged[questionId] = answers[questionId];

  const next = saveMedicalHistory({
    ...history,
    answers: merged,
    revisions: [...history.revisions, revision],
  });
  audit(tenantId, context.actor, "history.updated", next.id, `changed: ${changed.join(", ")}`);

  const synced = await pushToHospital(tenantId, next, context.actor);
  return { ok: true, history: synced, created: false, revision };
}

/**
 * Offers the record to the hospital's system, when it accepts them.
 *
 * A refusal or an outage changes only `sync`. It does not create another
 * record, and it does not pretend the hospital has the history: the panel
 * reads `sync.state` and says where the record actually is.
 */
async function pushToHospital(tenantId: string, history: MedicalHistoryRecord, actor: string): Promise<MedicalHistoryRecord> {
  const server = hospitalServer(tenantId);

  if (!server.supports("history_write")) {
    return saveMedicalHistory({
      ...history,
      storage: "tringlo_local",
      sync: {
        state: "unsupported",
        at: new Date().toISOString(),
        reference: null,
        problem: "The hospital's API does not accept medical history writes, so this record is held in Tringlo.",
      },
    });
  }
  if (history.provisional) {
    // There is no hospital patient to attach it to yet.
    return saveMedicalHistory({
      ...history,
      sync: {
        state: "not_attempted",
        at: new Date().toISOString(),
        reference: null,
        problem: "This patient has no hospital patient id yet, so the history cannot be attached to a hospital record.",
      },
    });
  }

  const values: Record<string, string | null> = {};
  for (const [questionId, answer] of Object.entries(history.answers)) values[questionId] = answer.value;

  const result = await server.updateMedicalHistory(history.canonicalPatientId, values);
  if (!result.ok) {
    audit(tenantId, actor, "history.sync_failed", history.id, result.problem);
    return saveMedicalHistory({
      ...history,
      sync: { state: "failed", at: new Date().toISOString(), reference: null, problem: result.problem },
    });
  }

  return saveMedicalHistory({
    ...history,
    storage: "hospital_server",
    sync: { state: "synced", at: new Date().toISOString(), reference: result.data.reference, problem: null },
  });
}

export type AdoptResult =
  | { ok: true; history: MedicalHistoryRecord; merged: boolean }
  | { ok: false; problem: string };

/**
 * Replaces a provisional key with the hospital's real patient id.
 *
 * If the hospital's id already has a history — the patient was registered
 * separately, or rang twice from different numbers — the two are merged into
 * that one and the provisional record is folded in as a revision. A merge is
 * the only correct answer here: keeping both is precisely the duplicate this
 * module exists to prevent.
 */
export async function adoptCanonicalId(
  tenantId: string,
  historyId: string,
  canonicalPatientId: string,
  actor: string
): Promise<AdoptResult> {
  const history = getMedicalHistory(tenantId, historyId);
  if (!history) return { ok: false, problem: "No such medical history." };
  if (!canonicalPatientId.trim() || isProvisional(canonicalPatientId)) {
    return { ok: false, problem: "A hospital patient id is needed." };
  }
  if (history.canonicalPatientId === canonicalPatientId) return { ok: true, history, merged: false };

  const incumbent = getMedicalHistoryByPatient(tenantId, canonicalPatientId);
  if (incumbent && incumbent.id !== history.id) {
    const update = await applyUpdate(tenantId, incumbent, history.answers, {
      actor,
      sessionId: history.originSessionId,
      note: `Merged from provisional record ${history.id}.`,
    });
    if (!update.ok) return update;
    // The provisional record is retired by pointing it at the record that now
    // holds its answers, so nothing references a history that vanished.
    saveMedicalHistory({
      ...history,
      canonicalPatientId: `merged:${history.id}`,
      provisional: false,
      sync: {
        state: history.sync.state,
        at: new Date().toISOString(),
        reference: incumbent.id,
        problem: `Merged into ${incumbent.id}, which is this patient's history.`,
      },
    });
    audit(tenantId, actor, "history.merged", history.id, `into ${incumbent.id}`);
    return { ok: true, history: update.history, merged: true };
  }

  const next = saveMedicalHistory({ ...history, canonicalPatientId, provisional: false });
  audit(tenantId, actor, "history.patient_id_adopted", next.id, canonicalPatientId);
  const synced = await pushToHospital(tenantId, next, actor);
  return { ok: true, history: synced, merged: false };
}

// ------------------------------------------------------------
// Visit information — as many as there are visits
// ------------------------------------------------------------

/**
 * Records something about one encounter.
 *
 * Kept apart from the longitudinal history on purpose. This is where a
 * returning patient's new complaint goes, and having somewhere for it to go is
 * what stops a second history being created to hold it.
 */
export function recordVisitNote(options: {
  tenantId: string;
  patientLeadId: string;
  canonicalPatientId?: string | null;
  appointmentId?: string | null;
  callId?: string | null;
  note: string;
  recordedBy: string;
  demo?: boolean;
}): VisitNote | null {
  const note = options.note.trim();
  if (!note) return null;
  const saved = saveVisitNote({
    id: ID("vn"),
    tenantId: options.tenantId,
    canonicalPatientId: options.canonicalPatientId ?? null,
    patientLeadId: options.patientLeadId,
    appointmentId: options.appointmentId ?? null,
    callId: options.callId ?? null,
    at: new Date().toISOString(),
    note,
    recordedBy: options.recordedBy,
    demo: Boolean(options.demo),
  });
  audit(options.tenantId, options.recordedBy, "visit.note_recorded", saved.id, null);
  return saved;
}

export function visitNotesFor(tenantId: string, patientLeadId: string): VisitNote[] {
  return getVisitNotes(tenantId)
    .filter((note) => note.patientLeadId === patientLeadId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ------------------------------------------------------------
// For the panel
// ------------------------------------------------------------

/** One history with its answers in question order, for display. */
export function historyView(history: MedicalHistoryRecord) {
  return {
    id: history.id,
    canonicalPatientId: history.canonicalPatientId,
    provisional: history.provisional,
    patientLeadId: history.patientLeadId,
    patientName: history.patientName,
    consent: history.consent,
    provenance: history.provenance,
    storage: history.storage,
    sync: history.sync,
    createdAt: history.createdAt,
    updatedAt: history.updatedAt,
    revisions: history.revisions.length,
    lastRevision: history.revisions.at(-1) ?? null,
    demo: history.demo,
    answers: QUESTIONNAIRE.map((question) => {
      const answer = history.answers[question.id];
      return {
        questionId: question.id,
        label: question.label,
        prompt: question.prompt,
        state: answer?.state ?? "unknown",
        value: answer?.value ?? null,
        note: answer?.note ?? null,
        answeredAt: answer?.answeredAt ?? null,
      };
    }),
  };
}

export function listHistories(tenantId: string): MedicalHistoryRecord[] {
  return getMedicalHistories(tenantId)
    .filter((history) => !history.canonicalPatientId.startsWith("merged:"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
