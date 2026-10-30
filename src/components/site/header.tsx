"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

import { prefersReducedMotion } from "@/lib/animation";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#calling", label: "Calling" },
  { href: "/#use-cases", label: "Use cases" },
  { href: "/#platform", label: "Platform" },
  { href: "/#faq", label: "FAQ" },
];

/**
 * The lockup: the signal mark beside the Tringlo AI wordmark.
 *
 * The wordmark is the brand's own artwork, never re-set in a font, so its
 * custom letterforms (the stemless R, the open O and its lime arc) are always
 * the real ones. Two versions, each extracted from its own reference: dark
 * letters for light surfaces, light letters for dark ones (`inverse`). Served
 * as-is, unoptimised, so no resampling touches the drawing.
 */
const LOGO = {
  onLight: { src: "/brand/tringlo-ai-on-light.png", width: 301, height: 40 },
  onDark: { src: "/brand/tringlo-ai-on-dark.png", width: 314, height: 40 },
} as const;

export function Wordmark({ className, inverse = false }: { className?: string; inverse?: boolean }) {
  const logo = inverse ? LOGO.onDark : LOGO.onLight;
  return (
    <span className={cn("brand-lockup", className)}>
      {/* Mark: a signal crossing a line — a call being placed. */}
      <svg viewBox="0 0 28 28" className="brand-badge" aria-hidden="true">
        <rect x="0.5" y="0.5" width="27" height="27" rx="4" fill="currentColor" />
        <path
          d="M5 14h4l2-5 3 10 3-8 2 3h4"
          fill="none"
          stroke={inverse ? "var(--color-ink)" : "var(--color-cream)"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="23" cy="14" r="1.6" fill="var(--color-lime)" />
      </svg>
      <Image
        src={logo.src}
        width={logo.width}
        height={logo.height}
        alt={SITE.name}
        unoptimized
        priority={!inverse}
        className="brand-logo"
      />
    </span>
  );
}

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // Hidden while reading downwards, so tall diagrams get the whole window;
  // back the moment the reader scrolls up.
  const [hidden, setHidden] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - last;
      setScrolled(y > 8);
      // Always shown near the top of the page.
      if (y < 80) setHidden(false);
      // A small dead zone, so trackpad jitter doesn't make it flicker.
      else if (delta > 6) setHidden(true);
      else if (delta < -6) setHidden(false);
      if (Math.abs(delta) > 6 || y < 80) last = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Mobile menu: slides down, traps nothing (it is inline), closes on Escape
  // and on navigation, and returns focus to the toggle.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel && !prefersReducedMotion()) {
      gsap.fromTo(panel, { height: 0, opacity: 0 }, { height: "auto", opacity: 1, duration: 0.35, ease: "power3.out" });
      gsap.fromTo(panel.querySelectorAll("li"), { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.03, delay: 0.05 });
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      // Keyboard users tabbing into the header always see it.
      onFocusCapture={() => setHidden(false)}
      className={cn(
        "sticky top-0 z-50 px-3 pt-3 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] md:px-5 md:pt-5",
        hidden && !open && "-translate-y-[calc(100%+20px)]"
      )}
    >
      {/* A raised slab: a lit top edge, a shaded bottom edge, and two shadows —
          one tight under the lip, one soft and far, so it sits above the page. */}
      <div
        className={cn(
          "mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-6 rounded-[14px] border border-stone/80 bg-cream/85 px-4 backdrop-blur-xl transition-[background-color,border-color,box-shadow,translate] duration-500 md:px-6",
          scrolled || open
            ? "bg-cream/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(23,22,20,0.07),0_2px_3px_-1px_rgba(23,22,20,0.1),0_14px_26px_-14px_rgba(23,22,20,0.4),0_34px_60px_-34px_rgba(23,22,20,0.45)]"
            : "shadow-[inset_0_1px_0_rgba(255,255,255,0.85),inset_0_-1px_0_rgba(23,22,20,0.05),0_1px_2px_-1px_rgba(23,22,20,0.08),0_10px_20px_-14px_rgba(23,22,20,0.3),0_24px_44px_-30px_rgba(23,22,20,0.32)]"
        )}
      >
        <Link href="/" aria-label={`${SITE.name} home`} className="text-ink">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className="group relative text-[14px] text-ink-muted transition-colors hover:text-ink"
                >
                  {item.label}
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-ink transition-transform duration-300 group-hover:scale-x-100"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link
              href="/workspaces"
              className="inline-flex h-10 items-center rounded-[5px] bg-ink px-4 text-[14px] font-medium text-cream shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_14px_-8px_rgba(23,22,20,0.7)] transition-[background-color,box-shadow,translate] duration-300 hover:-translate-y-px hover:bg-ink-soft hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_20px_-10px_rgba(23,22,20,0.75)] active:translate-y-0 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
            >
              Your workspaces
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden h-10 items-center rounded-[4px] px-3.5 text-[14px] font-medium text-ink transition-colors hover:bg-parchment sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                href="/login?mode=signup"
                className="inline-flex h-10 items-center rounded-[5px] bg-ink px-4 text-[14px] font-medium text-cream shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_14px_-8px_rgba(23,22,20,0.7)] transition-[background-color,box-shadow,translate] duration-300 hover:-translate-y-px hover:bg-ink-soft hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_20px_-10px_rgba(23,22,20,0.75)] active:translate-y-0 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.3)]"
              >
                Sign up
              </Link>
            </>
          )}
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-mobile-nav"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[5px] border border-stone bg-paper/70 text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_3px_8px_-5px_rgba(23,22,20,0.45)] transition-[box-shadow,translate] duration-300 active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(23,22,20,0.12)] lg:hidden"
          >
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
            <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
              {open ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <div ref={panelRef} id="site-mobile-nav" className="mx-auto mt-2.5 max-w-[1320px] overflow-hidden rounded-[14px] border border-stone/80 bg-cream shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_3px_-1px_rgba(23,22,20,0.1),0_18px_34px_-18px_rgba(23,22,20,0.45),0_40px_70px_-40px_rgba(23,22,20,0.5)] lg:hidden">
          <nav aria-label="Primary mobile">
            <ul className="px-5 py-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex h-12 items-center border-b border-stone text-[16px] text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
              {!signedIn && (
                <li>
                  <Link href="/login" onClick={() => setOpen(false)} className="flex h-12 items-center text-[16px] text-ink">
                    Log in
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
