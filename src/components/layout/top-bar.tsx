"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Moon, Sun } from "lucide-react";

import { useAuthStore } from "@/lib/store";
import { useProviderStatus } from "@/lib/use-tringlo-data";
import { LiveClock } from "./live-clock";

/** Where the chosen theme is remembered; read before first paint by the root layout. */
const THEME_KEY = "tringlo-theme";

/**
 * Whether the dark theme is on, read from the class the root layout's script
 * set before the first paint — the toggle reads it rather than re-deciding.
 * The server cannot know, so it renders the light icon and React swaps it
 * after hydration without a mismatch.
 */
function useIsDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const watch = new MutationObserver(onChange);
      watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => watch.disconnect();
    },
    () => document.documentElement.classList.contains("dark"),
    () => false
  );
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/leads": "Leads",
  "/upload": "Upload leads",
  "/campaigns": "Campaigns",
  "/results": "Results",
  "/follow-ups": "Follow-ups",
  "/agent": "AI agent",
  "/analytics": "Analytics",
  "/inbound": "Inbound calls",
  "/settings": "Settings",
};

export function TopBar() {
  const pathname = usePathname();
  const isDark = useIsDark();
  const workspace = useAuthStore((state) => state.user?.tenantName);

  const toggleTheme = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Storage refused (a private window, say): the switch still applies
      // for this visit; it just will not be remembered.
    }
  };

  return (
    // Phone: tighter gutters, and the page title set a touch larger since it is
    // the only heading on a screen with no sidebar to say where you are.
    //
    // The height grows by the top safe-area inset rather than having it carved
    // out of 3.5rem: under border-box a plain min-height would include the
    // padding, and on a notched phone the header's content would be squeezed
    // into a few pixels.
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-6 phone:bg-card phone:px-4 phone:pt-safe phone:h-[calc(3.5rem+env(safe-area-inset-top))]">
      {/* Desktop: where you are — workspace, then page — since the page names
          itself in its own heading below. A phone shows only the page title:
          there it is the one heading on screen. */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px] phone:hidden">
        <span className="truncate text-muted-foreground">{workspace || "Tringlo AI"}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        <span className="truncate font-medium text-foreground" aria-current="page">
          {PAGE_TITLES[pathname] ?? "Tringlo AI"}
        </span>
      </nav>
      <h1 className="hidden text-base font-semibold text-foreground phone:block">
        {PAGE_TITLES[pathname] ?? "Tringlo AI"}
      </h1>

      <div className="flex items-center gap-3 phone:gap-2">
        <ProviderIndicator />
        {/* The phone already shows the time in its own status bar, and the
            width is better spent on the title. `contents` keeps the desktop
            layout exactly as it was. */}
        <div className="contents phone:hidden">
          <LiveClock />
        </div>
        <button
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground phone:h-11 phone:w-11 phone:-mr-2.5"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}

/**
 * Reports whether Tringlo can actually place a call right now.
 *
 * Replaces the old always-on "AI Active" badge, which said the same thing
 * whether or not the provider was configured at all.
 */
function ProviderIndicator() {
  const { data, isLoading } = useProviderStatus();

  if (isLoading || !data) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        Checking
      </span>
    );
  }

  const ready = data.status === "ready" && data.providerConnectivity !== "unreachable";

  return (
    <Link
      href="/settings"
      title={data.providerDetails || data.details}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
        ready
          ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/15"
          : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/15"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {ready ? "Calling ready" : "Setup required"}
    </Link>
  );
}
