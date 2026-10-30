import type { Metadata } from "next";

import { ContactForm } from "@/components/site/contact-form";
import { F } from "@/components/site/legal-page";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: `Contact — ${SITE.name}`,
  description: `Ask about ${SITE.name}, request a workspace, or send a privacy request.`,
};

export default async function ContactPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const topic = params.topic === "workspace" ? "Request a workspace" : params.topic === "privacy" ? "Privacy or data request" : undefined;

  return (
    <section aria-labelledby="contact-title" className="blueprint border-b border-stone">
      <div className="mx-auto grid max-w-[1320px] gap-14 px-5 py-16 md:px-8 md:py-24 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <p className="mono-label text-ink-faint">Contact</p>
          <h1 id="contact-title" className="serif mt-4 text-[40px] leading-[48px] tracking-[-0.015em] md:text-[56px] md:leading-[64px]">
            Talk to a person.
          </h1>
          <p className="mt-5 max-w-md text-[17px] leading-7 text-ink-muted">
            Ask a question, request a workspace for your business, or send a request about your personal data. We reply by email.
          </p>

          <dl className="mt-10 divide-y divide-stone border-y border-stone text-[15px]">
            <div className="grid grid-cols-[120px_1fr] gap-4 py-4">
              <dt className="mono-label pt-0.5 text-ink-faint">Email</dt>
              <dd className="text-ink">
                <a className="underline underline-offset-4 hover:text-iris-deep" href={`mailto:${SITE.contactEmail}`}>
                  {SITE.contactEmail}
                </a>
              </dd>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-4 py-4">
              <dt className="mono-label pt-0.5 text-ink-faint">Phone</dt>
              <dd className="text-ink">
                <a className="underline underline-offset-4 hover:text-iris-deep" href={`tel:${SITE.phone.replace(/\s/g, "")}`}>
                  {SITE.phone}
                </a>
              </dd>
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-4 py-4">
              <dt className="mono-label pt-0.5 text-ink-faint">Registered</dt>
              <dd className="text-ink">
                <F v={SITE.legalName} />
                <br />
                <F v={SITE.address} />
                <br />
                <a className="underline underline-offset-4 hover:text-iris-deep" href={`https://${SITE.website}`} rel="noreferrer">
                  {SITE.website}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <ContactForm initialTopic={topic} />
        </div>
      </div>
    </section>
  );
}
