// ============================================================
// Tringlo AI — Campaign CSV validation
// ============================================================
//
// Reads an uploaded lead sheet and decides, row by row and column by column,
// what will be sent to Sarvam — before anything is sent.
//
// Columns are never renamed. A column is either:
//   - the phone number (`mobile`, `phone_number` or `phone`),
//   - an agent variable the Sarvam app declares, sent under its own name,
//   - an output variable the agent fills in itself, which is not sent, or
//   - a name the agent does not declare, which is not sent.
// Each decision is reported, so nothing disappears silently.
// ============================================================

import Papa from "papaparse";

import { normalisePhone } from "@/lib/customers/identity";
import { CONVERSATION_OUTPUT_KEYS, declaredVariableNames } from "@/lib/providers/sarvam/variables";
import type { AgentVariableMapping } from "@/lib/providers/variable-mapping";

export const PHONE_COLUMNS = ["mobile", "phone_number", "phone"] as const;
export const MAX_ROWS = 10000;

export type ColumnRole = "phone" | "sent" | "output_not_sent" | "undeclared_not_sent" | "identifier";

export interface ColumnReport {
  name: string;
  role: ColumnRole;
  note: string;
}

export interface RowIssue {
  row: number; // 1-based, as a spreadsheet shows it (header is row 1)
  field: string | null;
  message: string;
}

export interface ValidRow {
  row: number;
  /** E.164. */
  phone: string;
  name: string;
  customerId: string | null;
  /** Declared agent variables from this row, verbatim names, trimmed values. */
  variables: Record<string, string>;
}

export interface CsvReport {
  columns: ColumnReport[];
  phoneColumn: string | null;
  totalRows: number;
  emptyRows: number;
  valid: ValidRow[];
  invalid: RowIssue[];
  duplicates: Array<{ row: number; phone: string; firstRow: number }>;
  warnings: RowIssue[];
  /** Problems with the file itself; any of these blocks launch. */
  fileErrors: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Checks a value's shape for the fields whose format is well defined. Null when fine. */
function formatProblem(field: string, value: string): string | null {
  switch (field) {
    case "follow_up_date":
      return validDate(value) ? null : "should be a date as YYYY-MM-DD";
    case "follow_up_time":
      return TIME.test(value) ? null : "should be a time as HH:MM (24-hour)";
    case "follow_up_timezone":
      return validTimezone(value) ? null : "is not a known timezone (e.g. Asia/Kolkata)";
    case "next_step_date_time":
      return Number.isNaN(new Date(value).getTime()) ? "is not a valid date and time" : null;
    case "interest_confidence": {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 && n <= 100 ? null : "should be a number from 0 to 100";
    }
    case "follow_up_required":
      return /^(true|false|yes|no|1|0)$/i.test(value) ? null : "should be true or false";
    case "interest_level":
      return /^(high|medium|low|none)$/i.test(value) ? null : "should be high, medium, low or none";
    default:
      return null;
  }
}

export function validateCampaignCsv(
  text: string,
  declaredVariables?: string[] | null,
  mappings?: AgentVariableMapping[] | null
): CsvReport {
  const report: CsvReport = {
    columns: [],
    phoneColumn: null,
    totalRows: 0,
    emptyRows: 0,
    valid: [],
    invalid: [],
    duplicates: [],
    warnings: [],
    fileErrors: [],
  };

  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: false,
    transformHeader: (header) => header.trim(),
  });

  const headers = (parsed.meta.fields ?? []).filter((header) => header !== "");
  if (headers.length === 0) {
    report.fileErrors.push("The file has no header row.");
    return report;
  }

  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header.toLowerCase())) report.fileErrors.push(`Column “${header}” appears more than once.`);
    seen.add(header.toLowerCase());
  }

  // The agent that will dial decides which columns can become variables —
  // either because it declares a variable of that name, or because a mapping
  // reads that column into a variable of its own name.
  const declared = declaredVariableNames(declaredVariables);
  const fromColumn = new Map<string, string>();
  for (const mapping of mappings ?? []) {
    if (mapping.source.startsWith("csv.")) fromColumn.set(mapping.source.slice(4), mapping.name);
  }
  const outputs = new Set<string>(CONVERSATION_OUTPUT_KEYS);

  report.phoneColumn = PHONE_COLUMNS.find((name) => headers.includes(name)) ?? null;
  if (!report.phoneColumn) {
    report.fileErrors.push("No phone column. Add a column named “mobile” or “phone_number”.");
  }

  for (const name of headers) {
    if (name === report.phoneColumn) {
      report.columns.push({
        name,
        role: "phone",
        note: declared.has(name) ? "The number to call. Also sent as a variable of the same name." : "The number to call.",
      });
    } else if (name === "customer_id") {
      report.columns.push({
        name,
        role: declared.has(name) ? "sent" : "identifier",
        note: declared.has(name)
          ? "Your customer ID. Kept on the lead and sent as a variable."
          : "Your customer ID. Kept on the lead; the agent does not declare it, so it is not sent.",
      });
    } else if (fromColumn.has(name)) {
      report.columns.push({
        name,
        role: "sent",
        note: `Mapped to the agent variable ${fromColumn.get(name)}.`,
      });
    } else if (declared.has(name)) {
      report.columns.push({ name, role: "sent", note: "Sent to the agent under this exact name." });
    } else if (outputs.has(name)) {
      report.columns.push({
        name,
        role: "output_not_sent",
        note: "An output the agent fills in after the call — not sent as an input. Checked for format only.",
      });
    } else {
      report.columns.push({
        name,
        role: "undeclared_not_sent",
        note: "Not a variable on your Sarvam agent, so it is not sent. Declare it in the agent to use it.",
      });
    }
  }

  const rows = parsed.data;
  if (rows.length > MAX_ROWS) {
    report.fileErrors.push(`The file has ${rows.length} rows; the limit is ${MAX_ROWS} per campaign.`);
  }

  const firstRowByPhone = new Map<string, number>();

  rows.slice(0, MAX_ROWS).forEach((raw, index) => {
    const row = index + 2; // header is row 1
    const values = Object.fromEntries(
      headers.map((header) => [header, String(raw[header] ?? "").trim()])
    ) as Record<string, string>;

    if (Object.values(values).every((value) => value === "")) {
      report.emptyRows++;
      return;
    }
    report.totalRows++;

    if (!report.phoneColumn) return;
    const rawPhone = values[report.phoneColumn];
    if (!rawPhone) {
      report.invalid.push({ row, field: report.phoneColumn, message: "Phone number is empty." });
      return;
    }
    const phone = normalisePhone(rawPhone);
    if (!phone.valid || !phone.e164) {
      report.invalid.push({ row, field: report.phoneColumn, message: `“${rawPhone}” is not a valid Indian mobile number.` });
      return;
    }

    const first = firstRowByPhone.get(phone.e164);
    if (first !== undefined) {
      report.duplicates.push({ row, phone: phone.e164, firstRow: first });
      return;
    }
    firstRowByPhone.set(phone.e164, row);

    const variables: Record<string, string> = {};
    let rowInvalid = false;
    for (const column of report.columns) {
      const value = values[column.name];
      if (!value) continue;
      const problem = formatProblem(column.name, value);
      if (problem) {
        if (column.role === "sent") {
          // A malformed value the agent would read aloud is a real error.
          report.invalid.push({ row, field: column.name, message: `${column.name} “${value}” ${problem}.` });
          rowInvalid = true;
        } else {
          report.warnings.push({ row, field: column.name, message: `${column.name} “${value}” ${problem}. Not sent either way.` });
        }
        continue;
      }
      if (column.role === "sent" || (column.role === "phone" && declared.has(column.name))) {
        variables[column.name] = column.role === "phone" ? phone.e164 : value;
      }
    }
    if (rowInvalid) return;

    const name = values.customer_name || values.name || "";
    if (!name) report.warnings.push({ row, field: "customer_name", message: "No customer_name — the agent will not know who it is calling." });

    report.valid.push({
      row,
      phone: phone.e164,
      name,
      customerId: values.customer_id || null,
      variables,
    });
  });

  return report;
}
