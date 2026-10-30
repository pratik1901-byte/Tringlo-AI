import type { Metadata } from "next";
import Link from "next/link";

import { F, LegalPage, Tbc, type LegalSection } from "@/components/site/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Refunds & Cancellation — ${SITE.name}`,
  description: `How cancellation and refunds work for ${SITE.name}.`,
};

const sections: LegalSection[] = [
  {
    id: "payments",
    title: "How you pay",
    body: (
      <p>
        No payments are taken through this website. Paid use of {SITE.name} is agreed with us directly and billed by invoice or
        order form <Tbc>describe plans and billing cycle</Tbc>.
      </p>
    ),
  },
  {
    id: "cancel",
    title: "Cancelling",
    body: (
      <>
        <p>
          You can stop using {SITE.name} at any time. To cancel a paid plan or close your workspace, email{" "}
          <F v={SITE.contactEmail} /> from your account’s email address, or use the <Link href="/contact">contact form</Link>.
        </p>
        <p>
          Cancellation takes effect <Tbc>at the end of the current billing period / immediately</Tbc>. Scheduled callbacks stop
          when the workspace is closed.
        </p>
      </>
    ),
  },
  {
    id: "refunds",
    title: "Refunds",
    body: (
      <ul>
        <li>
          <strong>Charges made in error</strong> — duplicate payments or amounts that do not match your invoice — are refunded in
          full to the original payment method within <Tbc>N working days</Tbc> of being confirmed.
        </li>
        <li>
          <strong>Usage already delivered</strong> — calls already placed or minutes already used — is <Tbc>non-refundable / refundable
          on these conditions</Tbc>, because the voice and telephony providers charge for it as it happens.
        </li>
        <li>
          <strong>Prepaid periods</strong> — <Tbc>state whether unused time on a cancelled plan is refunded, credited, or neither</Tbc>.
        </li>
        <li>
          <strong>Service failures on our side</strong> that stop calls from being placed are credited or refunded as agreed in
          your order form.
        </li>
      </ul>
    ),
  },
  {
    id: "request",
    title: "Requesting a refund",
    body: (
      <p>
        Email <F v={SITE.contactEmail} /> with your workspace name, the invoice and what went wrong. We will acknowledge within{" "}
        <Tbc>N working days</Tbc> and tell you the outcome and timeline.
      </p>
    ),
  },
  {
    id: "consumers",
    title: "Consumers",
    body: (
      <p>
        {SITE.name} is sold to businesses. If it is ever sold to individual consumers, the Consumer Protection Act, 2019 and the
        Consumer Protection (E-Commerce) Rules, 2020 may give additional rights, which this page does not limit.
      </p>
    ),
  },
];

export default function RefundsPage() {
  return (
    <LegalPage
      current="/refunds"
      title="Refunds & Cancellation"
      summary={<p>Cancel whenever you like. Charges made in error are always refunded.</p>}
      sections={sections}
    />
  );
}
