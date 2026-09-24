"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/store";
import { ActiveCallBanner } from "@/components/call/ActiveCallBanner";
import { PhoneNav } from "./phone-nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

const PUBLIC_PATHS = ["/login", "/privacy", "/terms"];

/**
 * Gates the application on a session the server confirms.
 *
 * The check is a request, not a localStorage flag. That is the whole change
 * from the previous version: a flag in the browser could be set by anyone and
 * proved nothing, whereas this asks the server, and the server is also what
 * every API route now checks. A session can be revoked or expire while the tab
 * is closed, so the answer is re-fetched on load rather than remembered.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const refresh = useAuthStore((state) => state.refresh);
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  // Asks once on mount. `refresh` is a stable store action, so this does not
  // re-run on every render.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (status === "checking") return;
    if (status === "signedOut" && !isPublic) router.replace("/login");
    if (status === "signedIn" && pathname === "/login") router.replace("/dashboard");
  }, [status, isPublic, pathname, router]);

  if (isPublic) return <>{children}</>;

  // Still asking, or signed out and on the way to /login. Showing the app
  // shell here would flash a dashboard the person is not entitled to see.
  if (status !== "signedIn") {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="sr-only">Loading</span>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    // `dvh` on phones: iOS Safari's 100vh includes the area behind the address
    // bar, which would push the bottom of the app off-screen.
    //
    // The side insets keep content clear of the notch when a phone is turned
    // landscape; they are zero in portrait and on anything without a notch.
    <div className="flex h-screen overflow-hidden bg-background phone:h-dvh phone:pl-[env(safe-area-inset-left)] phone:pr-[env(safe-area-inset-right)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <ActiveCallBanner />
        <main className="flex-1 overflow-y-auto">
          {/* Phone: tighter gutters, and bottom padding that clears the tab
              bar plus the home indicator so the last row is never hidden
              under it. The `!` makes the phone value win over `sm:px-8`,
              which also matches between 640px and the phone breakpoint. */}
          <div className="mx-auto max-w-[1180px] px-6 py-7 sm:px-8 phone:px-4! phone:pt-5! phone:pb-[calc(5.5rem+env(safe-area-inset-bottom))]!">
            {children}
          </div>
        </main>
      </div>
      <PhoneNav />
    </div>
  );
}
