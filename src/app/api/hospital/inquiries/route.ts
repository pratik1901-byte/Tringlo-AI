// ============================================================
// Hospital — inquiries and reception
// ============================================================
//
// The approved answers the agent may give, and the questions it had no
// approved answer for.
//
// `answer` is the endpoint the agent itself calls during a conversation. It
// either returns the hospital's own words or it returns nothing and leaves a
// row behind — there is no third branch where something plausible is made up.
// ============================================================

import { NextRequest, NextResponse } from "next/server";

import { requireHospitalAuth } from "@/lib/hospital/guard";
import {
  FAQ_CATEGORIES,
  answerInquiry,
  listFaqs,
  listUnanswered,
  removeFaq,
  resolveInquiry,
  saveFaq,
  setFaqActive,
} from "@/lib/hospital/inquiries";
import { hospitalProfile } from "@/lib/hospital/service";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const profile = hospitalProfile(auth.tenantId);

  const faqs = listFaqs(auth.tenantId, {
    search: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    includeInactive: true,
  });

  return NextResponse.json(
    {
      faqs,
      categories: FAQ_CATEGORIES,
      unanswered: listUnanswered(auth.tenantId),
      openUnanswered: listUnanswered(auth.tenantId, { status: "open" }).length,
      // Whether a handoff is even possible, so the page can say if it is not.
      staffContact: profile.staffContact ?? null,
      counts: {
        total: faqs.length,
        active: faqs.filter((faq) => faq.active).length,
      },
    },
    { headers: noStore }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const action = String(body?.action ?? "save");
  const fail = (message: string, status = 400) =>
    NextResponse.json({ error: { message } }, { status, headers: noStore });

  if (action === "save") {
    const result = saveFaq(
      auth.tenantId,
      {
        id: typeof body?.id === "string" ? body.id : null,
        question: String(body?.question ?? ""),
        answer: String(body?.answer ?? ""),
        topic: typeof body?.topic === "string" ? body.topic : null,
        active: body?.active === undefined ? undefined : Boolean(body.active),
      },
      auth.user.id
    );
    if (!result.ok) return fail(result.problem);
    return NextResponse.json({ faq: result.faq }, { status: body?.id ? 200 : 201, headers: noStore });
  }

  if (action === "toggle") {
    const result = setFaqActive(auth.tenantId, String(body?.id ?? ""), Boolean(body?.active), auth.user.id);
    if (!result.ok) return fail(result.problem, 404);
    return NextResponse.json({ faq: result.faq }, { headers: noStore });
  }

  // What the agent calls mid-conversation.
  if (action === "answer") {
    const answer = answerInquiry({
      tenantId: auth.tenantId,
      question: String(body?.question ?? ""),
      callId: typeof body?.callId === "string" ? body.callId : null,
      patientLeadId: typeof body?.patientLeadId === "string" ? body.patientLeadId : null,
      demo: Boolean(body?.demo),
    });
    return NextResponse.json(answer, { headers: noStore });
  }

  if (action === "resolve") {
    const result = resolveInquiry(
      auth.tenantId,
      String(body?.inquiryId ?? ""),
      {
        answer: typeof body?.answer === "string" ? body.answer : undefined,
        faqId: typeof body?.faqId === "string" ? body.faqId : undefined,
        dismiss: Boolean(body?.dismiss),
        topic: typeof body?.topic === "string" ? body.topic : null,
      },
      auth.user.id
    );
    if (!result.ok) return fail(result.problem);
    return NextResponse.json({ inquiry: result.inquiry, faq: result.faq }, { headers: noStore });
  }

  return fail("Unknown action.");
}

export async function DELETE(request: NextRequest) {
  const auth = await requireHospitalAuth(request);
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id") ?? "";
  const removed = removeFaq(auth.tenantId, id, auth.user.id);
  return removed
    ? NextResponse.json({ ok: true }, { headers: noStore })
    : NextResponse.json({ error: { message: "No such FAQ." } }, { status: 404, headers: noStore });
}
