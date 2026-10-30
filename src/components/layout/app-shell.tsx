"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/store";
import { AccountCenter } from "@/components/account/account-center";
import { ActiveCallBanner } from "@/components/call/ActiveCallBanner";
import { PhoneNav } from "./phone-nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The public website. It has its own layout, decides "signed in?" on the
 * server, and never needs the app's session check.
 */
const SITE_PATHS = ["/", "/contact", "/privacy", "/terms", "/cookies", "/refunds"];

/**
 * The hospital panel, which is its own application inside this one.
 *
 * It brings its own sidebar, its own top bar and its own design system, so
 * the general shell steps out of the way entirely rather than wrapping one
 * frame in another.
 */
const HOSPITAL_ROOT = "/hospital";
const PUBLIC_PATHS = ["/login", ...SITE_PATHS];

/**
 * Signed in, but no workspace open yet. The chrome belongs to a workspace —
 * showing a sidebar here would name one before the account has chosen it.
 */
const ACCOUNT_PATHS = ["/workspaces", "/workspaces/new"];

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
  const activeTenantId = useAuthStore((state) => state.activeTenantId);
  const isHospital = useAuthStore((state) => state.isHospital);
  const isSite = SITE_PATHS.includes(pathname);
  const inHospital = pathname === HOSPITAL_ROOT || pathname.startsWith(`${HOSPITAL_ROOT}/`);

  // Asks once on mount. `refresh` is a stable store action, so this does not
  // re-run on every render.
  useEffect(() => {
    if (!isSite) refresh();
  }, [refresh, isSite]);

  useEffect(() => {
    if (status === "checking") return;
    if (status === "signedOut" && !isPublic) router.replace("/login");
    if (status === "signedIn" && pathname === "/login") router.replace("/dashboard");
    // Signed in, but no workspace chosen yet: the app has nothing to show
    // until one is. Send them to choose rather than to an empty dashboard.
    if (status === "signedIn" && !activeTenantId && !isPublic && !ACCOUNT_PATHS.includes(pathname)) {
      router.replace("/workspaces");
    }
    // A hospital workspace's home is the hospital panel. Opening one and
    // landing on the general dashboard was the old behaviour, and it showed
    // a hospital's staff a sales pipeline.
    if (status === "signedIn" && isHospital && pathname === "/dashboard") {
      router.replace(HOSPITAL_ROOT);
    }
  }, [status, isPublic, pathname, router, activeTenantId, isHospital]);

  if (isPublic) return <>{children}</>;

  // The hospital panel renders itself, frame and all.
  if (inHospital) return <>{children}</>;

  // Still asking, or signed out and on the way to /login. Showing the app
  // shell here would flash a dashboard the person is not entitled to see.
  if (status === "signedIn" && ACCOUNT_PATHS.includes(pathname)) return <>{children}</>;

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
    //
    // Desktop: the sidebar sits on a canvas and the page is a raised panel
    // inset beside it — frame and content. A phone keeps its full-bleed
    // layout: no canvas, no panel edges.
    <div className="flex h-screen overflow-hidden bg-sidebar phone:h-dvh phone:bg-background phone:pl-[env(safe-area-inset-left)] phone:pr-[env(safe-area-inset-right)]">
      <Sidebar />
      <div className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-sidebar-border bg-background shadow-[0_1px_3px_rgba(23,22,20,0.05),0_12px_32px_-24px_rgba(23,22,20,0.25)] phone:m-0 phone:rounded-none phone:border-0 phone:shadow-none">
        <TopBar />
        <ActiveCallBanner />
        <main data-app-main className="flex-1 overflow-y-auto">
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
      <AccountCenter />
    </div>
  );
}
