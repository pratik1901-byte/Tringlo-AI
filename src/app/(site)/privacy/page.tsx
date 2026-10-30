import type { Metadata } from "next";
import Link from "next/link";

import { F, LegalPage, Tbc, type LegalSection } from "@/components/site/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Privacy Policy — ${SITE.name}`,
  description: `How ${SITE.name} collects, uses, shares and protects personal data.`,
};

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          {SITE.name} is operated by <F v={SITE.legalName} />, <F v={SITE.address} /> (“we”, “us”). This policy explains what
          personal data we handle through this website and the {SITE.name} service, why, and what you can do about it.
        </p>
        <p>
          Questions about personal data go to our grievance officer, <F v={SITE.grievanceOfficer} />, at{" "}
          <F v={SITE.grievanceEmail} />.
        </p>
      </>
    ),
  },
  {
    id: "roles",
    title: "Two different roles",
    body: (
      <>
        <p>We handle personal data in two capacities, and the difference matters for your rights:</p>
        <ul>
          <li>
            <strong>For our own account holders and website visitors</strong> — people who create a workspace or contact us —
            we decide why and how the data is used. Under India’s Digital Personal Data Protection Act, 2023 (“DPDP Act”) we
            act as the <em>Data Fiduciary</em> for this data.
          </li>
          <li>
            <strong>For the people our customers call</strong> — the leads a business uploads to its workspace — the business
            decides whom to call and why. It is the Data Fiduciary; we process that data on its behalf, as its{" "}
            <em>Data Processor</em>. If you received a call placed through {SITE.name}, the business that called you is the
            right first contact for requests about your data; we will help them respond.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect and why",
    body: (
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account: name, email address, workspace name, password (stored only as a salted scrypt hash)</td>
            <td>Creating and securing your account; signing you in; sending security and service emails</td>
          </tr>
          <tr>
            <td>Sessions: a hashed session token, when it was created and last used, and whether it is “web” or “mobile”</td>
            <td>Keeping you signed in; letting a password change sign out other devices</td>
          </tr>
          <tr>
            <td>One-time codes (stored only as a salted hash) for password resets and email changes</td>
            <td>Verifying that you control the email address</td>
          </tr>
          <tr>
            <td>Contact form: name, email, optional company, your message</td>
            <td>Replying to you. Sent to our inbox by email; not stored in the application database</td>
          </tr>
          <tr>
            <td>Workspace data uploaded by a business: lead names, phone numbers, notes</td>
            <td>Placing the calls the business asks for (processor role)</td>
          </tr>
          <tr>
            <td>Call data: call status, times, transcript, recording, the voice agent’s summary and structured outcome</td>
            <td>Showing the business the result of each call; scheduling callbacks it was asked for (processor role)</td>
          </tr>
          <tr>
            <td>Customer memory: short facts a called person stated, with the words they used</td>
            <td>Letting a later call continue the conversation (processor role). Health, religion, caste, political views and identity or account numbers are excluded by design</td>
          </tr>
          <tr>
            <td>IP address</td>
            <td>Limiting abusive request rates. Held briefly in server memory only; not written to the database</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    id: "legal-basis",
    title: "Basis for processing",
    body: (
      <>
        <p>
          We process account data to provide the service you signed up for, with your consent given at sign-up, and for
          legitimate uses the DPDP Act permits (such as keeping the service secure). You can withdraw consent at any time by
          closing your account; this does not affect processing already carried out.
        </p>
        <p>
          For workspace data, the business that uploads it is responsible for having a lawful basis — including any consent
          required — to call each person and to have calls recorded. Our <Link href="/terms">Terms</Link> require this.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Service providers who process data for us",
    body: (
      <>
        <p>We do not sell personal data or use it for advertising. We share it only with providers needed to run the service:</p>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>What they receive</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sarvam AI</td>
              <td>The number and name being called, the business context and relevant customer memory given to the agent; the call audio and transcript it produces</td>
              <td>Conducting the voice call and returning its outcome</td>
            </tr>
            <tr>
              <td>The telephony carrier used by Sarvam AI for the call</td>
              <td>The phone number and call audio</td>
              <td>Connecting the call</td>
            </tr>
            <tr>
              <td>Our email provider <Tbc>confirm provider, e.g. Google Workspace/Gmail SMTP</Tbc></td>
              <td>Recipient address and message content</td>
              <td>Sending codes, alerts, daily summaries and contact-form messages</td>
            </tr>
            <tr>
              <td>Our hosting and network providers <Tbc>confirm, e.g. server host, Cloudflare</Tbc></td>
              <td>All data, in transit and at rest, as infrastructure</td>
              <td>Running and securing the service</td>
            </tr>
          </tbody>
        </table>
        <p>
          We may also disclose data where Indian law requires it. Some providers may process data outside India{" "}
          <Tbc>confirm locations for each provider</Tbc>; where they do, it is subject to any restrictions the Government of
          India notifies under the DPDP Act.
        </p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Kept for</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account</td>
            <td>While the account exists; deleted within <Tbc>N days</Tbc> of a closure request</td>
          </tr>
          <tr>
            <td>Sessions</td>
            <td>Up to 30 days (12 hours if “remember me” is off), or until you sign out</td>
          </tr>
          <tr>
            <td>One-time codes</td>
            <td>Valid for 10 minutes; records removed within 24 hours</td>
          </tr>
          <tr>
            <td>Contact-form messages</td>
            <td>In our inbox for up to <Tbc>N months</Tbc> after the conversation ends</td>
          </tr>
          <tr>
            <td>Leads, calls, transcripts, recordings</td>
            <td>Until the business deletes them or closes its workspace <Tbc>set a default maximum</Tbc></td>
          </tr>
          <tr>
            <td>Customer memory</td>
            <td>Until the business deletes it; a business can erase one fact or a customer’s whole memory at any time</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <ul>
        <li>Passwords are stored only as salted scrypt hashes; session tokens and one-time codes only as hashes.</li>
        <li>Sessions use a secure, http-only cookie that page scripts cannot read. Signing out ends the session on the server.</li>
        <li>Each workspace’s data is separated on the server; every request is checked against the signed-in workspace.</li>
        <li>Provider keys, webhook tokens and mail credentials stay on the server and are never sent to browsers.</li>
        <li>Call results are accepted only from webhooks carrying a secret token.</li>
        <li>Recordings are served only to the workspace that owns the call.</li>
      </ul>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>Under the DPDP Act you may ask us to:</p>
        <ul>
          <li>tell you what personal data we process about you and how;</li>
          <li>correct, complete, update or erase it;</li>
          <li>withdraw consent you gave us;</li>
          <li>nominate someone to exercise these rights if you die or become incapacitated.</li>
        </ul>
        <p>
          Write to <F v={SITE.grievanceEmail} />. We will respond within <Tbc>N days</Tbc>. If you are not satisfied with our
          response, you may complain to the Data Protection Board of India. You can change your name, email and password
          yourself in the Account center, and a business can delete customer memory from its workspace.
        </p>
      </>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        {SITE.name} is a business service and is not intended for anyone under 18. We do not knowingly create accounts for
        children. Businesses must not upload children’s data for calling.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We use one strictly necessary cookie to keep you signed in, and no analytics or advertising cookies. See the{" "}
        <Link href="/cookies">Cookie Policy</Link>.
      </p>
    ),
  },
  {
    id: "law",
    title: "The law this is written against",
    body: (
      <>
        <p>
          This policy is drafted with the DPDP Act and the Digital Personal Data Protection Rules, 2025 in mind. The Rules
          were notified in November 2025 and take effect in stages: some provisions immediately, those on consent managers
          about a year later, and most obligations on Data Fiduciaries about eighteen months after notification. We are
          aligning the service with those obligations ahead of their commencement; this page does not claim that any
          certification or audit has been completed.
        </p>
        <p>
          The service is intended for businesses in India. If it is offered to people in the European Union or elsewhere,
          this policy will be revised for the laws that then apply.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes and contact",
    body: (
      <p>
        We will post any change here and update the date at the top; for material changes we will also email account holders.
        Contact: <F v={SITE.contactEmail} />, or use the <Link href="/contact">contact form</Link>.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      current="/privacy"
      title="Privacy Policy"
      summary={
        <p>
          We collect what is needed to run your account and place the calls you ask for — nothing for advertising, and no
          tracking cookies.
        </p>
      }
      sections={sections}
    />
  );
}
