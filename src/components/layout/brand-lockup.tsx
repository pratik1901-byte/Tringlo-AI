// ============================================================
// Tringlo AI — Brand Lockup (app)
// ============================================================
// The signal mark beside the Tringlo AI wordmark: the same lockup as the
// public website, sized for the app's sidebar.
//
// The wordmark is the brand's own artwork, never re-set in a font, so its
// custom letterforms are always the real ones. Each theme gets its version —
// dark letters on light surfaces, light letters on dark — and the mark
// inverts with it, as it does on the website's dark footer. Both images are
// in the page and CSS shows the right one, so switching theme swaps the logo
// instantly, with nothing to load.
// ============================================================

import Image from "next/image";

import { cn } from "@/lib/utils";

/** Native sizes of the two wordmark files in public/brand. */
const ON_LIGHT = { src: "/brand/tringlo-ai-on-light.png", width: 301, height: 40 };
const ON_DARK = { src: "/brand/tringlo-ai-on-dark.png", width: 314, height: 40 };

export function BrandLockup({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Tringlo AI" className={cn("flex items-center gap-2.5", className)}>
      {/* Mark: a signal crossing a line — a call being placed. The square takes
          the text colour and the signal the sidebar's own surface, so it is
          ink-on-cream in light mode and cream-on-ink in dark. */}
      <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0 text-foreground" aria-hidden="true">
        <rect x="0.5" y="0.5" width="27" height="27" rx="4" fill="currentColor" />
        <path
          d="M5 14h4l2-5 3 10 3-8 2 3h4"
          fill="none"
          stroke="var(--sidebar)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="23" cy="14" r="1.6" fill="#E8F056" />
      </svg>
      <Image
        src={ON_LIGHT.src}
        width={ON_LIGHT.width}
        height={ON_LIGHT.height}
        alt=""
        aria-hidden="true"
        unoptimized
        priority
        className="h-[15px] w-auto dark:hidden"
      />
      <Image
        src={ON_DARK.src}
        width={ON_DARK.width}
        height={ON_DARK.height}
        alt=""
        aria-hidden="true"
        unoptimized
        className="hidden h-[15px] w-auto dark:block"
      />
    </span>
  );
}
