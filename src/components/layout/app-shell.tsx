"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/store";
import { ActiveCallBanner } from "@/components/call/ActiveCallBanner";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

const PUBLIC_PATHS = ["/login", "/privacy", "/terms"];

/**
 * Waits for the persisted auth store to rehydrate from localStorage.
 *
 * Rendering before hydration finishes would briefly show the signed-out state to
 * someone who is signed in, and bounce them to /login.
 */
function useAuthHydrated(): boolean {
  // The persist API is not attached while prerendering on the server, so every
  // access goes through this guard rather than assuming a browser.
  const persist = useAuthStore.persist as typeof useAuthStore.persist | undefined;

  const [hydrated, setHydrated] = useState(() => persist?.hasHydrated() ?? false);

  useEffect(() => {
    if (!persist) return;
    const unsubscribe = persist.onFinishHydration(() => setHydrated(true));
    // If rehydration finished between the initial render and this effect, the
    // subscription above would never fire, so catch up on the next tick.
    const catchUp = setTimeout(() => {
      if (persist.hasHydrated()) setHydrated(true);
    }, 0);

    return () => {
      clearTimeout(catchUp);
      unsubscribe();
    };
  }, [persist]);

  return hydrated;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthHydrated();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated && !isPublic) router.replace("/login");
    if (isAuthenticated && pathname === "/login") router.replace("/dashboard");
  }, [hydrated, isAuthenticated, isPublic, pathname, router]);

  if (isPublic) return <>{children}</>;

  if (!hydrated || !isAuthenticated) {
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
