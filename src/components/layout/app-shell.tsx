"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/store";
import { ActiveCallBanner } from "@/components/call/ActiveCallBanner";
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
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <ActiveCallBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-6 py-7 sm:px-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
