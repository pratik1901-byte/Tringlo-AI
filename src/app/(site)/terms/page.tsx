import type { Metadata } from "next";
import Link from "next/link";

import { F, LegalPage, Tbc, type LegalSection } from "@/components/site/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Terms & Conditions — ${SITE.name}`,
  description: `The terms for using ${SITE.name}.`,
};

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement",
    body: (
      <p>
        These terms are an agreement between <F v={SITE.legalName} /> (“we”) and the business or person who creates a
        workspace (“you”). By creating a workspace or using {SITE.name} you accept them. If you use {SITE.name} for an
        organisation, you confirm you may bind it. Where a signed order form or contract with us says something different, that
        document prevails.
      </p>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          {SITE.name} lets you upload leads, have an AI voice agent place outbound calls to them, and review each call’s
          transcript, recording and outcome. It can schedule callbacks customers ask for, remember facts customers stated for
          later calls, and email you alerts and summaries.
        </p>
        <p>
          Calls are carried out by third-party voice and telephony providers (currently Sarvam AI and its carriers). Their
          availability affects ours.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and workspaces",
    body: (
      <ul>
        <li>Keep your password confidential. You are responsible for activity in your workspace.</li>
        <li>Give accurate account details and keep your email address current — security codes are sent there.</li>
        <li>Workspaces are currently created on request; we may decline or close a workspace that breaches these terms.</li>
      </ul>
    ),
  },
  {
    id: "calling",
    title: "Your responsibilities when calling people",
    body: (
      <>
        <p>
          You decide whom {SITE.name} calls, so you are responsible for every call placed from your workspace being lawful. In
          particular, you must:
        </p>
        <ul>
          <li>
            have the consent or other lawful basis the DPDP Act and other applicable law require to use each person’s data and
            to call them;
          </li>
          <li>
            comply with the Telecom Regulatory Authority of India’s rules on commercial communications, including the
            Telecom Commercial Communications Customer Preference Regulations and the National Customer Preference Register
            (“Do Not Disturb”), and any registration or number-series requirements that apply to your calls;
          </li>
          <li>tell people, where required, that they are speaking with an automated agent and that the call is recorded;</li>
          <li>call only at reasonable hours, set your calling window accordingly, and honour every request not to be called;</li>
          <li>not upload data about children, or data you have no right to use;</li>
          <li>make sure what you tell the agent about your business, products and prices is accurate.</li>
        </ul>
        <p>
          {SITE.name} helps — it keeps calls inside your calling window and suppresses a lead that asks not to be called — but
          these tools do not make a call lawful on their own.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: (
      <ul>
        <li>No fraud, impersonation, harassment, threats, or misleading claims.</li>
        <li>No calls to emergency services, or calls intended to harass or overwhelm a number.</li>
        <li>No attempts to access another workspace, bypass security, or overload the service.</li>
        <li>No use that breaks the law or our providers’ usage policies.</li>
      </ul>
    ),
  },
  {
    id: "ai",
    title: "AI limitations",
    body: (
      <p>
        The voice agent generates responses automatically. It can mishear, misunderstand, or say something inaccurate, and its
        summaries and extracted facts can be wrong. Review important outcomes before relying on them, and do not use{" "}
        {SITE.name} for decisions with legal or similarly significant effects on a person without human review.
      </p>
    ),
  },
  {
    id: "data",
    title: "Your data",
    body: (
      <p>
        You own the data you upload and the call records created for you. We process it only to provide the service, as your
        data processor, as described in the <Link href="/privacy">Privacy Policy</Link>. <Tbc>A data processing addendum is available on request — confirm</Tbc>.
        You can delete customer memory at any time; on closure we delete your workspace data within <Tbc>N days</Tbc>.
      </p>
    ),
  },
  {
    id: "fees",
    title: "Fees",
    body: (
      <p>
        Fees, billing periods and usage charges (for example per call or per minute) are set out in your order form or invoice{" "}
        <Tbc>describe the pricing model</Tbc>. No payments are taken through this website. See{" "}
        <Link href="/refunds">Refunds &amp; Cancellation</Link>.
      </p>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <p>
        We own {SITE.name}, its software and this website. You receive a non-exclusive, non-transferable right to use the service
        during your subscription. Feedback you give us may be used to improve the service without obligation to you.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <p>
        We work to keep {SITE.name} available but do not guarantee uninterrupted service unless a written service level has been
        agreed. We may change features; we will give reasonable notice of changes that materially reduce what you are paying
        for.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <p>
        <Tbc>Limitation of liability, exclusions and cap — to be drafted by counsel</Tbc>. Nothing in these terms limits liability
        that cannot be limited by law. You will indemnify us against claims arising from calls you instruct {SITE.name} to place
        in breach of these terms or the law.
      </p>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    body: (
      <p>
        You may stop using the service at any time. We may suspend or close a workspace that breaches these terms, harms others,
        or puts the service at risk, and will tell you why unless the law prevents it.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of India. Courts at <F v={SITE.jurisdiction} /> have exclusive jurisdiction, subject
        to any dispute-resolution process agreed in writing.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        <F v={SITE.legalName} />, <F v={SITE.address} />. Email <F v={SITE.contactEmail} />, or use the{" "}
        <Link href="/contact">contact form</Link>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms & Conditions"
      summary={<p>The rules for using {SITE.name} — above all, that the business placing the calls is responsible for making them lawful.</p>}
      sections={sections}
    />
  );
}
