import Link from "next/link";

import { LEGAL_LINKS, SITE, isPlaceholder } from "@/lib/site";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

/** A fact from lib/site, shown as "to be confirmed" while it is a placeholder. */
export function F({ v }: { v: string }) {
  return isPlaceholder(v) ? (
    <span className="tbc" title="To be confirmed by the business">
      {v}
    </span>
  ) : (
    <>{v}</>
  );
}

/** Text the business must still decide, marked the same way. */
export function Tbc({ children }: { children: React.ReactNode }) {
  return (
    <span className="tbc" title="To be decided by the business">
      [{children}]
    </span>
  );
}

const PENDING = [SITE.legalName, SITE.address, SITE.contactEmail, SITE.grievanceOfficer, SITE.grievanceEmail, SITE.jurisdiction].some(isPlaceholder);

export function LegalPage({
  title,
  summary,
  sections,
  current,
}: {
  title: string;
  summary: React.ReactNode;
  sections: LegalSection[];
  current: string;
}) {
  const updated = new Date(`${SITE.legalUpdated}T12:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <article className="border-b border-stone">
      <header className="blueprint border-b border-stone">
        <div className="mx-auto max-w-[1320px] px-5 pb-14 pt-16 md:px-8 md:pt-20">
          <p className="mono-label text-ink-faint">Legal · last updated {updated}</p>
          <h1 className="serif mt-4 max-w-3xl text-[40px] leading-[48px] tracking-[-0.015em] md:text-[56px] md:leading-[64px]">{title}</h1>
          <div className="mt-5 max-w-[680px] text-[17px] leading-7 text-ink-muted">{summary}</div>

          <div role="note" className="mt-8 max-w-[680px] rounded-[4px] border border-ink bg-paper px-4 py-3 text-[14px] leading-[22px] text-ink">
            <strong className="font-medium">Draft for legal review.</strong> This page describes how the service
            actually works today, but it is not legal advice and has not yet been reviewed by a lawyer.
            {PENDING && (
              <>
                {" "}Highlighted values such as <span className="tbc">[Registered legal entity name]</span> are still to be
                confirmed by the business.
              </>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1320px] gap-12 px-5 py-14 md:px-8 lg:grid-cols-12">
        <nav aria-label="On this page" className="lg:col-span-3">
          <div className="lg:sticky lg:top-24">
            <p className="mono-label text-ink-faint">On this page</p>
            <ol className="mt-3 space-y-1.5 text-[14px]">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="grid grid-cols-[26px_1fr] text-ink-muted hover:text-ink">
                    <span className="font-mono text-[12px] text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
            <p className="mono-label mt-8 text-ink-faint">Other policies</p>
            <ul className="mt-3 space-y-1.5 text-[14px]">
              {LEGAL_LINKS.filter((link) => link.href !== current).map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-ink-muted underline-offset-4 hover:text-ink hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="prose-legal max-w-[680px] lg:col-span-8 lg:col-start-5">
          {sections.map((section, index) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id} className={index === 0 ? "!mt-0" : undefined}>
                {section.title}
              </h2>
              {section.body}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
