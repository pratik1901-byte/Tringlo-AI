import { NextRequest, NextResponse } from "next/server";

import { notFound, ownedByTenant, requireAuth, scopeToTenant } from "@/lib/auth/guard";
import { deleteLead, getLead, getLeads, saveLead, suppressLead, updateLead } from "@/lib/db";
import { cleanPersonName, renameLead } from "@/lib/customers/rename";
import type { Lead } from "@/lib/types";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({
      leads: scopeToTenant(getLeads(), auth.tenantId),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[GET /api/leads]", message);
    return NextResponse.json({ error: "Could not load leads." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    if (!body?.phone) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const lead: Lead = {
      id: body.id || `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId: auth.tenantId,
      name: (body.name || "").trim() || "Customer",
      phone: String(body.phone).trim(),
      email: body.email,
      company: body.company,
      notes: body.notes,
      campaign: body.campaign,
      callingDate: body.callingDate || new Date().toISOString().split("T")[0],
      callingTime: body.callingTime || "10:00",
      timezone: body.timezone || "Asia/Kolkata",
      createdAt: new Date().toISOString(),
      status: "queued",
      suppressed: false,
    };

    return NextResponse.json(saveLead(lead));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[POST /api/leads]", message);
    return NextResponse.json({ error: "Could not create lead." }, { status: 500 });
  }
}

/**
 * PATCH /api/leads
 *
 * Suppression is handled separately from an ordinary field update: it also has to
 * cancel pending callbacks, so it must not be reachable as a plain `suppressed: true`
 * assignment that skips that step.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    if (!ownedByTenant(getLead(body?.id), auth.tenantId)) {
      return notFound("Lead not found");
    }
    if (!body?.id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    if (body.suppressed === true) {
      const reason = (body.reason || "").trim() || "Marked do-not-call from the Leads page.";
      if (!suppressLead(body.id, reason)) {
        return NextResponse.json({ error: "Lead not found" }, { status: 404 });
      }
      return NextResponse.json({ id: body.id, suppressed: true, reason });
    }

    // Only these fields are editable. Anything else in the body — the
    // workspace, the phone (the contact's identity), status, suppression — is
    // ignored, never written.
    const updates: Partial<Lead> = {};
    for (const field of ["email", "company", "notes"] as const) {
      if (body[field] === undefined) continue;
      const value = typeof body[field] === "string" ? body[field].trim() : "";
      if (value.length > (field === "notes" ? 2000 : 200)) {
        return NextResponse.json({ error: `${field} is too long.` }, { status: 400 });
      }
      if (field === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      }
      updates[field] = value || undefined;
    }

    if (body.name !== undefined) {
      if (!cleanPersonName(body.name)) {
        return NextResponse.json(
          { error: "Enter the person's name — letters only, 2 to 60 characters." },
          { status: 400 }
        );
      }
      // Carries the name onto the contact's calls, follow-ups and memory, and
      // to the inbound line.
      renameLead(body.id, body.name, "team");
    }

    const updated = Object.keys(updates).length ? updateLead(body.id, updates) : getLead(body.id);
    if (!updated) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[PATCH /api/leads]", message);
    return NextResponse.json({ error: "Could not update lead." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id query parameter is required" }, { status: 400 });
    }
    if (!ownedByTenant(getLead(id), auth.tenantId)) {
      return notFound("Lead not found");
    }

    if (!deleteLead(id)) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ id, deleted: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DELETE /api/leads]", message);
    return NextResponse.json({ error: "Could not delete lead." }, { status: 500 });
  }
}
