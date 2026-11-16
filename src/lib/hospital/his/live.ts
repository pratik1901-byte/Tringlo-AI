// ============================================================
// Tringlo AI — The live hospital server adapter
// ============================================================
//
// Real HTTP against the hospital's own API. It is deliberately inert until
// somebody has entered three things for an operation:
//
//   1. a base URL,
//   2. a credential,
//   3. the path for that operation, from the hospital's documentation.
//
// Missing any of those, the operation reports `not_configured` or
// `unsupported` and nothing is sent. No path is inferred, no conventional
// REST shape is assumed, no "/api/v1/patients" is guessed at: a request
// invented here would be a request made to a hospital's production system on
// the strength of a guess, and the honest answer — "this is not connected
// yet" — is the one the panel shows.
//
// ------------------------------------------------------------
// The contract this adapter speaks
// ------------------------------------------------------------
//
// Each configured path is called with JSON and must answer with JSON. Where
// the hospital's API differs — and it almost certainly will — the translation
// belongs in a small per-hospital adapter written against the same interface,
// not in guesswork here. What this adapter sends and expects:
//
//   patient_lookup          POST  { phone?, name?, dateOfBirth?, patientId? }
//                           → { confidence: "match"|"ambiguous"|"none",
//                               patientId?, name?, matchedOn?: string[],
//                               candidates?: number, hasHistory?: boolean }
//   providers_read          GET   → { providers: [ { id, name, specialty, ... } ] }
//   appointments_read       GET   ?patientId&from&to
//                           → { appointments: [ { id, providerId, scheduledAt, status } ] }
//   appointment_confirm     POST  { appointmentId, confirmedBy } → { status }
//   appointment_cancel      POST  { appointmentId, reason } → { status }
//   appointment_reschedule  POST  { appointmentId, scheduledAt } → { status }
//   history_read            GET   ?patientId
//                           → { exists, reference?, summary?, updatedAt? }
//   history_write           POST  { patientId, answers } → { reference }
//   report_submit           POST  <the report> → { reference }
//   faqs_read               GET   → { faqs: [ { question, answer, category? } ] }
//
// Credentials are read on the server and sent as a bearer token. They are
// never returned by an API route, never written to a log, and never included
// in an error message — a failure says what went wrong, not what was sent.
// ============================================================

import type { HospitalIntegrationConfig } from "../records";
import {
  hisFail,
  hisOk,
  isTransient,
  type HisAppointment,
  type HisCapability,
  type HisFaq,
  type HisHistorySummary,
  type HisPatientLookup,
  type HisPatientMatch,
  type HisProvider,
  type HisResult,
  type HisSubmissionReceipt,
  type HospitalServer,
} from "./types";

/** Attempts for an operation that failed in a way worth retrying. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 400;

/** Spaced so a burst of calls cannot hammer a hospital's system. */
const MIN_GAP_MS = 50;
let lastCallAt = 0;

export class LiveHospitalServer implements HospitalServer {
  readonly mode = "live" as const;
  readonly label = "Hospital server";

  constructor(private readonly config: HospitalIntegrationConfig) {}

  supports(capability: HisCapability): boolean {
    return (
      Boolean(this.config.baseUrl) &&
      Boolean(this.config.token) &&
      this.config.capabilities.includes(capability) &&
      Boolean(this.config.endpoints[capability])
    );
  }

  /** Why an operation cannot run, said precisely. */
  private unavailable<T>(capability: HisCapability): HisResult<T> | null {
    if (!this.config.baseUrl) {
      return hisFail("not_configured", "No hospital server address has been entered yet.");
    }
    if (!this.config.token) {
      return hisFail("not_configured", "No hospital server credential has been entered yet.");
    }
    if (!this.config.capabilities.includes(capability)) {
      return hisFail("unsupported", "The hospital's API has not been recorded as supporting this operation.");
    }
    if (!this.config.endpoints[capability]) {
      return hisFail(
        "unsupported",
        "No path has been entered for this operation, so there is nothing to call. Add it from the hospital's API documentation."
      );
    }
    return null;
  }

  /**
   * One HTTP call, with a timeout, bounded retries and no secret in anything
   * it returns.
   */
  private async request<T>(
    capability: HisCapability,
    init: { method: "GET" | "POST"; query?: Record<string, string | undefined>; body?: unknown }
  ): Promise<HisResult<T>> {
    const blocked = this.unavailable<T>(capability);
    if (blocked) return blocked;

    const base = this.config.baseUrl!.replace(/\/+$/, "");
    const path = this.config.endpoints[capability].replace(/^\/+/, "");
    let url: URL;
    try {
      url = new URL(`${base}/${path}`);
    } catch {
      return hisFail("not_configured", "The hospital server address is not a valid URL.");
    }
    if (!/^https:$/i.test(url.protocol) && url.hostname !== "localhost") {
      return hisFail(
        "not_configured",
        "The hospital server address must use HTTPS. Patient data is not sent over an unencrypted connection."
      );
    }
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value) url.searchParams.set(key, value);
    }

    let lastProblem = hisFail<T>("unreachable", "The hospital server could not be reached.");
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const gap = Date.now() - lastCallAt;
      if (gap < MIN_GAP_MS) await new Promise((resolve) => setTimeout(resolve, MIN_GAP_MS - gap));
      lastCallAt = Date.now();

      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(url, {
          method: init.method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.config.token}`,
            ...(init.body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: abort.signal,
          cache: "no-store",
        });

        if (response.status === 404) return hisFail("not_found", "The hospital server has no such record.");
        if (response.status === 401 || response.status === 403) {
          return hisFail("rejected", "The hospital server refused the credential. It may need renewing.");
        }
        if (response.status === 429) {
          lastProblem = hisFail("unreachable", "The hospital server is rate limiting requests.");
        } else if (response.status >= 500) {
          lastProblem = hisFail("unreachable", `The hospital server returned an error (${response.status}).`);
        } else if (!response.ok) {
          // A 4xx that is not one of the above is the hospital's answer, not a
          // fault worth retrying.
          const detail = await response.text().catch(() => "");
          return hisFail("rejected", `The hospital server declined the request (${response.status}). ${detail.slice(0, 180)}`.trim());
        } else {
          const text = await response.text();
          if (!text.trim()) return hisOk({} as T);
          try {
            return hisOk(JSON.parse(text) as T);
          } catch {
            return hisFail("malformed", "The hospital server's answer was not valid JSON.");
          }
        }
      } catch (failure) {
        const aborted = failure instanceof Error && failure.name === "AbortError";
        lastProblem = aborted
          ? hisFail("timeout", `The hospital server did not answer within ${Math.round(this.config.timeoutMs / 1000)}s.`)
          : hisFail("unreachable", "The hospital server could not be reached.");
      } finally {
        clearTimeout(timer);
      }

      if (!lastProblem.ok && !isTransient(lastProblem.code)) break;
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS * attempt));
    }
    return lastProblem;
  }

  async health(): Promise<HisResult<{ detail: string }>> {
    if (!this.config.baseUrl || !this.config.token) {
      return hisFail("not_configured", "The hospital server has not been configured yet.");
    }
    // Checked with whichever read operation the hospital has given us, rather
    // than a health path we would have had to invent.
    const probe: HisCapability | undefined = (["providers_read", "faqs_read", "appointments_read"] as HisCapability[]).find(
      (capability) => this.supports(capability)
    );
    if (!probe) {
      return hisFail("unsupported", "No read operation is configured, so the connection cannot be checked.");
    }
    const result = await this.request<unknown>(probe, { method: "GET" });
    return result.ok ? hisOk({ detail: "The hospital server answered." }) : result;
  }

  async findPatient(lookup: HisPatientLookup): Promise<HisResult<HisPatientMatch>> {
    const result = await this.request<Partial<HisPatientMatch>>("patient_lookup", { method: "POST", body: lookup });
    if (!result.ok) return result;
    const confidence = result.data.confidence;
    if (confidence !== "match" && confidence !== "ambiguous" && confidence !== "none") {
      return hisFail("malformed", "The hospital server did not say how confident the patient match was.");
    }
    // A match without an id is not a match we can key a history on.
    if (confidence === "match" && !result.data.patientId) {
      return hisFail("malformed", "The hospital server reported a match but returned no patient id.");
    }
    return hisOk({
      confidence,
      patientId: result.data.patientId ?? null,
      name: result.data.name ?? null,
      matchedOn: Array.isArray(result.data.matchedOn) ? result.data.matchedOn : [],
      candidates: typeof result.data.candidates === "number" ? result.data.candidates : confidence === "ambiguous" ? 2 : 0,
      hasHistory: Boolean(result.data.hasHistory),
      demo: false,
    });
  }

  async listProviders(): Promise<HisResult<HisProvider[]>> {
    const result = await this.request<{ providers?: unknown }>("providers_read", { method: "GET" });
    if (!result.ok) return result;
    const rows = Array.isArray(result.data.providers) ? result.data.providers : [];
    return hisOk(rows.map((row) => normaliseProvider(row as Record<string, unknown>)).filter((row): row is HisProvider => row !== null));
  }

  async getProvider(providerId: string): Promise<HisResult<HisProvider>> {
    const all = await this.listProviders();
    if (!all.ok) return all;
    const found = all.data.find((provider) => provider.id === providerId);
    return found ? hisOk(found) : hisFail("not_found", "The hospital server has no such provider.");
  }

  async listAppointments(options: { patientId?: string; from?: string; to?: string }): Promise<HisResult<HisAppointment[]>> {
    const result = await this.request<{ appointments?: unknown }>("appointments_read", {
      method: "GET",
      query: { patientId: options.patientId, from: options.from, to: options.to },
    });
    if (!result.ok) return result;
    const rows = Array.isArray(result.data.appointments) ? result.data.appointments : [];
    return hisOk(
      rows
        .map((row): HisAppointment | null => {
          const entry = row as Record<string, unknown>;
          if (typeof entry.id !== "string" || typeof entry.scheduledAt !== "string") return null;
          return {
            id: entry.id,
            patientId: typeof entry.patientId === "string" ? entry.patientId : null,
            providerId: typeof entry.providerId === "string" ? entry.providerId : "",
            providerName: typeof entry.providerName === "string" ? entry.providerName : null,
            scheduledAt: entry.scheduledAt,
            durationMinutes: typeof entry.durationMinutes === "number" ? entry.durationMinutes : 30,
            status: typeof entry.status === "string" ? entry.status : "unknown",
            demo: false,
          };
        })
        .filter((row): row is HisAppointment => row !== null)
    );
  }

  async confirmAppointment(reference: string, by: string): Promise<HisResult<{ status: string }>> {
    const result = await this.request<{ status?: string }>("appointment_confirm", {
      method: "POST",
      body: { appointmentId: reference, confirmedBy: by },
    });
    return result.ok ? hisOk({ status: result.data.status ?? "confirmed" }) : result;
  }

  async cancelAppointment(reference: string, reason: string | null): Promise<HisResult<{ status: string }>> {
    const result = await this.request<{ status?: string }>("appointment_cancel", {
      method: "POST",
      body: { appointmentId: reference, reason },
    });
    return result.ok ? hisOk({ status: result.data.status ?? "cancelled" }) : result;
  }

  async rescheduleAppointment(reference: string, scheduledAt: string): Promise<HisResult<{ status: string }>> {
    const result = await this.request<{ status?: string }>("appointment_reschedule", {
      method: "POST",
      body: { appointmentId: reference, scheduledAt },
    });
    return result.ok ? hisOk({ status: result.data.status ?? "rescheduled" }) : result;
  }

  async getMedicalHistory(patientId: string): Promise<HisResult<HisHistorySummary>> {
    const result = await this.request<Partial<HisHistorySummary>>("history_read", { method: "GET", query: { patientId } });
    if (!result.ok) return result;
    return hisOk({
      exists: Boolean(result.data.exists),
      reference: result.data.reference ?? null,
      summary: result.data.summary ?? null,
      updatedAt: result.data.updatedAt ?? null,
    });
  }

  async updateMedicalHistory(patientId: string, answers: Record<string, string | null>): Promise<HisResult<{ reference: string }>> {
    const result = await this.request<{ reference?: string }>("history_write", {
      method: "POST",
      body: { patientId, answers },
    });
    if (!result.ok) return result;
    // Without a reference there is nothing to show a clinician who asks where
    // the update went, so it is not treated as having landed.
    if (!result.data.reference) return hisFail("malformed", "The hospital server acknowledged no reference for the update.");
    return hisOk({ reference: result.data.reference });
  }

  async submitReport(payload: unknown): Promise<HisResult<HisSubmissionReceipt>> {
    const result = await this.request<{ reference?: string; acceptedAt?: string }>("report_submit", {
      method: "POST",
      body: payload,
    });
    if (!result.ok) return result;
    if (!result.data.reference) {
      return hisFail("malformed", "The hospital server returned no reference, so the report is not treated as submitted.");
    }
    return hisOk({ reference: result.data.reference, acceptedAt: result.data.acceptedAt ?? new Date().toISOString() });
  }

  async listFaqs(): Promise<HisResult<HisFaq[]>> {
    const result = await this.request<{ faqs?: unknown }>("faqs_read", { method: "GET" });
    if (!result.ok) return result;
    const rows = Array.isArray(result.data.faqs) ? result.data.faqs : [];
    return hisOk(
      rows
        .map((row): HisFaq | null => {
          const entry = row as Record<string, unknown>;
          if (typeof entry.question !== "string" || typeof entry.answer !== "string") return null;
          return {
            question: entry.question,
            answer: entry.answer,
            category: typeof entry.category === "string" ? entry.category : null,
          };
        })
        .filter((row): row is HisFaq => row !== null)
    );
  }
}

/** A provider row, accepted only when it carries the parts we rely on. */
function normaliseProvider(row: Record<string, unknown>): HisProvider | null {
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const hours =
    row.hours && typeof row.hours === "object"
      ? (row.hours as { start?: unknown; end?: unknown })
      : null;
  return {
    id: row.id,
    name: row.name,
    specialty: typeof row.specialty === "string" ? row.specialty : "General",
    department: typeof row.department === "string" ? row.department : null,
    qualifications: typeof row.qualifications === "string" ? row.qualifications : null,
    days: Array.isArray(row.days) ? row.days.filter((day): day is string => typeof day === "string") : [],
    hours:
      hours && typeof hours.start === "string" && typeof hours.end === "string"
        ? { start: hours.start, end: hours.end }
        : null,
    slotMinutes: typeof row.slotMinutes === "number" ? row.slotMinutes : 30,
    breaks: Array.isArray(row.breaks)
      ? (row.breaks as Array<Record<string, unknown>>)
          .filter((gap) => typeof gap.start === "string" && typeof gap.end === "string")
          .map((gap) => ({ start: gap.start as string, end: gap.end as string }))
      : [],
    unavailableDates: Array.isArray(row.unavailableDates)
      ? row.unavailableDates.filter((date): date is string => typeof date === "string")
      : [],
    specialHours: Array.isArray(row.specialHours)
      ? (row.specialHours as Array<Record<string, unknown>>)
          .filter((entry) => typeof entry.date === "string" && typeof entry.start === "string" && typeof entry.end === "string")
          .map((entry) => ({ date: entry.date as string, start: entry.start as string, end: entry.end as string }))
      : [],
    accepting: row.accepting === undefined ? true : Boolean(row.accepting),
    consultationFee: typeof row.consultationFee === "number" ? row.consultationFee : null,
    avatar: typeof row.avatar === "string" ? row.avatar : null,
    demo: false,
  };
}
