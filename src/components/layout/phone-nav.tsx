"use client";

// ============================================================
// Dialo AI — Phone Navigation
// ============================================================
//
// A bottom tab bar, and a sheet for everything that does not fit in it.
//
// Bottom rather than a hamburger at the top, because a phone is held in one
// hand and the top of the screen is the hardest place to reach with a thumb.
// The four tabs are the pages someone checks between calls — the overview,
// the leads they are about to call, the results that just came in, and the
// callbacks that are due. Everything else is one tap further, in "More".
//
// Rendered only in phone view (`hidden phone:flex`). The desktop sidebar is
// untouched and this does not exist above the phone breakpoint.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Clock, LayoutDashboard, LogOut, MoreHorizontal, Users, X } from "lucide-react";

import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { isNavActive, navigation } from "./sidebar";

const PRIMARY_TABS = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Leads", href: "/leads", icon: Users },
  { name: "Results", href: "/results", icon: ClipboardList },
  { name: "Follow-ups", href: "/follow-ups", icon: Clock },
];

const PRIMARY_HREFS = new Set(PRIMARY_TABS.map((tab) => tab.href));

/** Everything the tab bar does not hold, in sidebar order. */
const SECONDARY = navigation.filter((item) => !PRIMARY_HREFS.has(item.href));

export function PhoneNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // "More" is lit when the current page is one of the pages it contains, so
  // the tab bar always shows where you are.
  const inSecondary = SECONDARY.some((item) => isNavActive(pathname, item.href));

  // Navigating closes the sheet. Keyed on the path rather than on the tap, so
  // browser back and forward close it too.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (sheetOpen) setSheetOpen(false);
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 hidden border-t border-border bg-card/95 backdrop-blur-sm pb-safe phone:flex"
      >
        <ul className="flex w-full pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
          {PRIMARY_TABS.map((tab) => {
            const active = isNavActive(pathname, tab.href);
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-14 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors active:bg-muted",
                    active ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {/* A short bar at the top edge marks the current tab, clearer
                      in daylight than a colour change alone. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-1/2 top-0 h-[2px] w-8 -translate-x-1/2 rounded-full bg-primary transition-opacity",
                      active ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <tab.icon className="h-5 w-5" strokeWidth={active ? 2.25 : 1.75} />
                  {tab.name}
                </Link>
              </li>
            );
          })}

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              className={cn(
                "relative flex h-14 w-full flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-colors active:bg-muted",
                inSecondary ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-1/2 top-0 h-[2px] w-8 -translate-x-1/2 rounded-full bg-primary transition-opacity",
                  inSecondary ? "opacity-100" : "opacity-0"
                )}
              />
              <MoreHorizontal className="h-5 w-5" strokeWidth={inSecondary ? 2.25 : 1.75} />
              More
            </button>
          </li>
        </ul>
      </nav>

      <MoreSheet open={sheetOpen} onClose={() => setSheetOpen(false)} pathname={pathname} />
    </>
  );
}

function MoreSheet({
  open,
  onClose,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
}) {
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Escape closes; focus moves into the sheet and back out to the "More" tab,
  // so a keyboard or switch-control user is never left somewhere invisible.
  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>("a, button");
    first?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    // The page behind must not scroll while the sheet is up.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      returnFocusRef.current?.focus();
    };
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 hidden phone:block",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none",
          open ? "opacity-100" : "opacity-0"
        )}
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="More pages"
        className={cn(
          "absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card pb-safe shadow-[0_-8px_30px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-y-0" : "translate-y-full"
        )}
      >
        {/* Grab handle — reads as "this slides", which it does. */}
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-9 rounded-full bg-border" aria-hidden="true" />
        </div>

        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <p className="text-sm font-semibold text-foreground">More</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ul className="grid grid-cols-3 gap-2 px-4 pb-4 pt-2">
          {SECONDARY.map((item) => {
            const active = isNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-[76px] flex-col items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-colors active:bg-muted",
                    active
                      ? "border-primary/30 bg-accent text-accent-foreground"
                      : "border-border text-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" strokeWidth={1.75} />
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Account. The workspace name matters on a phone as much as on the
            desktop: it is the difference between "my data is missing" and
            "I am signed into the other workspace". */}
        <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-border px-4 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {(user?.name || "U").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{user?.name || "User"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.tenantName || user?.email || ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              signOut();
            }}
            className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground active:bg-destructive/10 active:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
