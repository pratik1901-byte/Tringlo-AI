// ============================================================
// POST /api/campaigns/validate
// ============================================================
//
// Checks a lead sheet exactly as a launch would, and returns the preview —
// valid, invalid and duplicate rows, warnings, and what happens to each
// column. Nothing is saved and nothing is sent to Sarvam.
// ============================================================

import { NextResponse } from "next/server";

import { requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { normalisePhone } from "@/lib/customers/identity";
import { validateCampaignCsv } from "@/lib/campaigns/csv";
import { findCustomerProfileByPhone, getLeads } from "@/lib/db";
import { resolveBatch } from "@/lib/providers/config";

const noStore = { "Cache-Control": "no-store" };
const PREVIEW_ROWS = 50;

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  let csv = "";
  try {
    const body = await request.json();
    csv = typeof body?.csv === "string" ? body.csv : "";
  } catch {
    return NextResponse.json({ error: { message: "Expected a JSON body." } }, { status: 400, headers: noStore });
  }
  if (!csv.trim()) return NextResponse.json({ error: { message: "The sheet is empty." } }, { status: 400, headers: noStore });
  if (csv.length > 5_000_000) {
    return NextResponse.json({ error: { message: "The sheet is larger than 5 MB." } }, { status: 413, headers: noStore });
  }

  // Checked against the agent this workspace's campaigns actually dial with,
  // so the preview names the same columns the launch will send.
  const campaignAgent = resolveBatch(auth.tenantId)?.batch ?? null;
  const report = validateCampaignCsv(csv, campaignAgent?.agentVariables, campaignAgent?.variableMappings);

  // Which rows are returning customers — decided within this workspace only.
  const known = new Set(
    scopeToTenant(getLeads(), auth.tenantId).map((lead) => normalisePhone(lead.phone).national)
  );
  const withMemory = report.valid.filter((row) => {
    const national = normalisePhone(row.phone).national;
    return national ? Boolean(findCustomerProfileByPhone(auth.tenantId, national)) : false;
  }).length;

  return NextResponse.json(
    {
      columns: report.columns,
      phoneColumn: report.phoneColumn,
      fileErrors: report.fileErrors,
      counts: {
        rows: report.totalRows,
        empty: report.emptyRows,
        valid: report.valid.length,
        invalid: report.invalid.length,
        duplicates: report.duplicates.length,
        warnings: report.warnings.length,
        existingLeads: report.valid.filter((row) => known.has(normalisePhone(row.phone).national)).length,
        returningCustomers: withMemory,
      },
      preview: report.valid.slice(0, PREVIEW_ROWS).map((row) => ({
        row: row.row,
        phone: row.phone,
        name: row.name,
        variables: row.variables,
      })),
      invalid: report.invalid.slice(0, 200),
      duplicates: report.duplicates.slice(0, 200),
      warnings: report.warnings.slice(0, 200),
    },
    { headers: noStore }
  );
}
