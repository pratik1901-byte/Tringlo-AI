import type { Metadata } from "next";
import Link from "next/link";

import { CookieSettingsButton } from "@/components/site/cookie-settings";
import { F, LegalPage, type LegalSection } from "@/components/site/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Cookie Policy — ${SITE.name}`,
  description: `The cookies and browser storage ${SITE.name} uses.`,
};

const sections: LegalSection[] = [
  {
    id: "short",
    title: "In short",
    body: (
      <p>
        {SITE.name} uses one strictly necessary cookie, to keep you signed in, and one preference stored in your browser. There
        are no analytics, advertising, social-media or other tracking cookies, and no third-party scripts that set them — so
        there is no consent banner, because there is nothing optional to consent to.
      </p>
    ),
  },
  {
    id: "list",
    title: "Everything we store",
    body: (
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Purpose</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>dialo_session</td>
            <td>First-party cookie, http-only, strictly necessary</td>
            <td>Keeps you signed in. Set only after you log in; never set for visitors who don’t.</td>
            <td>30 days (12 hours without “remember me”), or until you sign out</td>
          </tr>
          <tr>
            <td>dialo-theme</td>
            <td>Browser local storage, functional</td>
            <td>Remembers whether you chose light or dark mode in the app.</td>
            <td>Until you clear it</td>
          </tr>
        </tbody>
      </table>
    ),
  },
  {
    id: "third-parties",
    title: "Third parties",
    body: (
      <p>
        Fonts are served from our own server, so loading a page does not contact Google or any font service. The website embeds
        no videos, maps, chat widgets or social buttons. If that ever changes, we will list the service here and, where it sets
        non-essential cookies, load it only after you opt in.
      </p>
    ),
  },
  {
    id: "control",
    title: "Your choices",
    body: (
      <>
        <p>
          You can delete or block cookies in your browser settings. Blocking the session cookie means you cannot stay signed in;
          the public website works without it.
        </p>
        {/* A div, not a p: the button renders a <dialog> with a heading and a table. */}
        <div className="mt-3 text-[15px] leading-[26px] text-ink-muted">
          <CookieSettingsButton className="font-medium text-iris-deep underline underline-offset-4" /> shows the same list at
          any time from the footer.
        </div>
      </>
    ),
  },
  {
    id: "eu",
    title: "Visitors in the EU and UK",
    body: (
      <p>
        Under the ePrivacy rules, strictly necessary cookies such as the session cookie do not need consent. Non-essential cookies
        would; we do not use any. See the <Link href="/privacy">Privacy Policy</Link> for how we handle personal data.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Questions: <F v={SITE.contactEmail} />.
      </p>
    ),
  },
];

export default function CookiesPage() {
  return (
    <LegalPage
      current="/cookies"
      title="Cookie Policy"
      summary={<p>One cookie to keep you signed in. Nothing that tracks you.</p>}
      sections={sections}
    />
  );
}
