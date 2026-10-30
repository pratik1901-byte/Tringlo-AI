"use client";

import Link from "next/link";
import { useRef } from "react";

/**
 * "Cookie settings" in the footer.
 *
 * The site sets no analytics, advertising or other non-essential cookies, so
 * there is nothing to consent to and no banner — a banner would imply a
 * choice that does not exist. This panel says exactly what is stored and
 * why. If a non-essential tool is ever added, this is where its opt-in goes,
 * and the tool must not load until that choice is made.
 *
 * Uses the native <dialog>: focus moves in, Escape closes, focus returns.
 */
export function CookieSettingsButton({ className }: { className?: string }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  return (
    <>
      <button type="button" className={className} onClick={() => dialogRef.current?.showModal()}>
        Cookie settings
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby="cookie-settings-title"
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-lg border border-stone bg-paper p-0 text-ink shadow-[0_8px_30px_rgba(23,22,20,0.12)] backdrop:bg-ink/40"
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="p-6">
          <p className="mono-label text-ink-faint">Cookie settings</p>
          <h2 id="cookie-settings-title" className="serif mt-2 text-[28px] leading-[36px]">
            Only what the site needs to work
          </h2>
          <p className="mt-3 text-[15px] leading-6 text-ink-muted">
            There are no analytics, advertising or tracking cookies on this site, so there is nothing to switch off.
          </p>

          <table className="mt-5 w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-stone text-ink">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Purpose</th>
                <th className="py-2 font-medium">Kept</th>
              </tr>
            </thead>
            <tbody className="text-ink-muted">
              <tr className="border-b border-stone align-top">
                <td className="py-2.5 pr-3 font-mono text-[12px] text-ink">dialo_session</td>
                <td className="py-2.5 pr-3">Keeps you signed in. Set only when you log in. Strictly necessary.</td>
                <td className="py-2.5">Up to 30 days, or until you sign out</td>
              </tr>
              <tr className="align-top">
                <td className="py-2.5 pr-3 font-mono text-[12px] text-ink">dialo-theme</td>
                <td className="py-2.5 pr-3">Remembers light or dark mode inside the app (browser storage, not a cookie).</td>
                <td className="py-2.5">Until you clear it</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Link href="/cookies" className="text-[14px] text-iris-deep underline underline-offset-4">
              Read the Cookie Policy
            </Link>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="inline-flex h-11 items-center rounded-[4px] bg-ink px-5 text-[14px] font-medium text-cream hover:bg-ink-soft"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
