"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";

import { useProviderStatus } from "@/lib/use-dialo-data";
import { LiveClock } from "./live-clock";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/leads": "Leads",
  "/upload": "Upload leads",
  "/campaigns": "Campaigns",
  "/results": "Results",
  "/follow-ups": "Follow-ups",
  "/agent": "AI agent",
  "/analytics": "Analytics",
  "/settings": "Settings",
};

export function TopBar() {
  const pathname = usePathname();
  // The inline bootstrap script in the root layout has already set the class, so
  // the toggle reads the DOM rather than re-deciding and re-rendering.
  const [isDark, setIsDark] = useState(() =>
    typeof document === "undefined" ? false : document.documentElement.classList.contains("dark")
  );

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("dialo-theme", next ? "dark" : "light");
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6">
      <h1 className="text-sm font-medium text-foreground">
        {PAGE_TITLES[pathname] ?? "Dialo AI"}
      </h1>

      <div className="flex items-center gap-3">
        <ProviderIndicator />
        <LiveClock />
        <button
          onClick={toggleTheme}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}

/**
 * Reports whether Dialo can actually place a call right now.
 *
 * Replaces the old always-on "AI Active" badge, which said the same thing
 * whether or not the provider was configured at all.
 */
function ProviderIndicator() {
  const { data, isLoading } = useProviderStatus();

  if (isLoading || !data) {
    return (
      <span className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground">
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
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
        ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {ready ? "Calling ready" : "Setup required"}
    </Link>
  );
}
