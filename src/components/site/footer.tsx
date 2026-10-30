import Link from "next/link";

import { CookieSettingsButton } from "@/components/site/cookie-settings";
import { Wordmark } from "@/components/site/header";
import { LEGAL_LINKS, SITE, isPlaceholder } from "@/lib/site";

function Fact({ value }: { value: string }) {
  return isPlaceholder(value) ? (
    <span className="tbc" title="To be confirmed by the business">
      {value}
    </span>
  ) : (
    <>{value}</>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="on-ink bg-ink text-cream" aria-labelledby="site-footer-title">
      <h2 id="site-footer-title" className="sr-only">
        Site information
      </h2>
      <div className="blueprint-ink">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-5 py-16 md:grid-cols-12 md:px-8">
          <div className="md:col-span-5">
            <Link href="/" aria-label={`${SITE.name} home`} className="text-cream">
              <Wordmark inverse />
            </Link>
            <p className="serif mt-6 max-w-sm text-[24px] leading-[32px] text-cream">
              Outbound calls that remember the last conversation.
            </p>
          </div>

          <nav aria-label="Product" className="md:col-span-2">
            <p className="mono-label text-cream/60">Product</p>
            <ul className="mt-4 space-y-2.5 text-[14px]">
              <li><Link className="text-cream/85 hover:text-cream" href="/#how-it-works">How it works</Link></li>
              <li><Link className="text-cream/85 hover:text-cream" href="/#calling">Single calls &amp; campaigns</Link></li>
              <li><Link className="text-cream/85 hover:text-cream" href="/#outcomes">Outcomes &amp; memory</Link></li>
              <li><Link className="text-cream/85 hover:text-cream" href="/#platform">Platform</Link></li>
              <li><Link className="text-cream/85 hover:text-cream" href="/#faq">FAQ</Link></li>
            </ul>
          </nav>

          <nav aria-label="Legal" className="md:col-span-2">
            <p className="mono-label text-cream/60">Legal</p>
            <ul className="mt-4 space-y-2.5 text-[14px]">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link className="text-cream/85 hover:text-cream" href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <CookieSettingsButton className="text-left text-cream/85 hover:text-cream" />
              </li>
            </ul>
          </nav>

          <div className="md:col-span-3">
            <p className="mono-label text-cream/60">Business</p>
            <address className="mt-4 space-y-2.5 text-[14px] not-italic text-cream/85">
              <p>
                <Fact value={SITE.legalName} />
              </p>
              <p>
                <Fact value={SITE.address} />
              </p>
              <p>
                {isPlaceholder(SITE.contactEmail) ? (
                  <Fact value={SITE.contactEmail} />
                ) : (
                  <a className="underline underline-offset-4" href={`mailto:${SITE.contactEmail}`}>
                    {SITE.contactEmail}
                  </a>
                )}
              </p>
              <p>
                <a className="underline underline-offset-4" href={`tel:${SITE.phone.replace(/\s/g, "")}`}>
                  {SITE.phone}
                </a>
              </p>
              <p>
                <a className="underline underline-offset-4" href={`https://${SITE.website}`} rel="noreferrer">
                  {SITE.website}
                </a>
              </p>
              <p>
                <Link className="underline underline-offset-4 hover:text-cream" href="/contact">
                  Contact form
                </Link>
              </p>
            </address>
          </div>
        </div>

        <div className="border-t border-cream/15">
          <div className="mx-auto flex max-w-[1320px] flex-col gap-2 px-5 py-6 text-[13px] text-cream/65 md:flex-row md:items-center md:justify-between md:px-8">
            <p>
              © {year} <Fact value={SITE.legalName} />. All rights reserved.
            </p>
            <p>Calls are placed by the workspace that uploads the leads, under its own consent and calling obligations.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
