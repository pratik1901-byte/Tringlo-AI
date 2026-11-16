"use client";

// ============================================================
// Wellness Hospital — the frame
// ============================================================
//
// A sidebar of the places staff work, a bar that says where they are, and the
// page beside it. On a phone the sidebar becomes a drawer, because a hospital
// corridor is not a desk.
// ============================================================

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  HelpCircle,
  LayoutDashboard,
  Menu,
  Moon,
  PhoneCall,
  PhoneForwarded,
  Settings,
  Stethoscope,
  Sun,
  Users,
  X,
} from "lucide-react";

import { api, useWorkspace } from "@/lib/hospital/panel-api";
import { usePageEntrance } from "./motion";
import { Button, cn } from "./ui";

/**
 * Where staff work.
 *
 * There is no Doctors entry, and that is the point of this version: the
 * provider directory belongs to the hospital's own system, and Tringlo reads
 * it rather than managing it. Who consults when is shown on Appointments,
 * where it is needed, from whatever the hospital's system currently says.
 */
const NAV = [
  { href: "/hospital", label: "Dashboard", icon: LayoutDashboard, group: "Today" },
  { href: "/hospital/appointments", label: "Appointments", icon: CalendarDays, group: "Clinic" },
  { href: "/hospital/patients", label: "Patients", icon: Users, group: "Clinic" },
  { href: "/hospital/demo-doctors", label: "Doctors", icon: Stethoscope, group: "Clinic" },
  { href: "/hospital/medical-history", label: "Questionnaire", icon: ClipboardList, group: "Clinic" },
  { href: "/hospital/agent", label: "Maya", icon: Bot, group: "Voice" },
  { href: "/hospital/reminders", label: "Confirmation Calls", icon: Bell, group: "Voice" },
  { href: "/hospital/calls", label: "Call History", icon: PhoneCall, group: "Voice" },
  { href: "/hospital/inquiries", label: "Inquiries & Reception", icon: HelpCircle, group: "Front desk" },
  { href: "/hospital/follow-ups", label: "Follow-ups", icon: PhoneForwarded, group: "Front desk" },
  { href: "/hospital/analytics", label: "Analytics", icon: BarChart3, group: "Hospital" },
  { href: "/hospital/settings", label: "Settings", icon: Settings, group: "Hospital" },
];

const SECTIONS = ["Today", "Clinic", "Voice", "Front desk", "Hospital"].map((group) => ({
  group,
  items: NAV.filter((item) => item.group === group),
}));

/** The platform's own key: one theme choice for the whole application. */
const THEME_KEY = "tringlo-theme";

/** Where this panel lives inside the platform. */
const ROOT = "/hospital";

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

/** The panel's root is exact; every other entry matches its own subtree. */
function isCurrent(pathname: string, href: string): boolean {
  return href === ROOT ? pathname === ROOT : pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDark = useIsDark();
  const [drawer, setDrawer] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  usePageEntrance(pageRef, pathname);
  // Which hospital's records are on screen. Read here so every page says it.
  const { data: context } = useWorkspace();

  const toggleTheme = () => {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // A private window will not remember it; the choice still applies now.
    }
  };

  // Longest match wins, so /hospital/appointments is Appointments rather
  // than Dashboard, whose href is a prefix of every page here.
  const current = NAV.filter((item) => isCurrent(pathname, item.href)).sort(
    (a, b) => b.href.length - a.href.length
  )[0];

  const nav = (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Sections">
      {SECTIONS.map(({ group, items }) => (
        <div key={group ?? "home"}>
          {group && (
            <p className="mb-1.5 px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-muted">{group}</p>
          )}
          <ul className="space-y-0.5">
            {items.map((item) => {
              const active = isCurrent(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    // Closed here rather than by watching the path: the tap is
                    // the moment the drawer should go, and an effect that
                    // chases the route change is a second render for nothing.
                    onClick={() => setDrawer(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                      active ? "bg-sage-soft text-ink" : "text-ink-muted hover:bg-raised hover:text-ink"
                    )}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-sage" aria-hidden="true" />}
                    <item.icon className={cn("h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110", active ? "text-sage" : "text-ink-muted")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-sunken">
      {/* Desktop sidebar */}
      <aside className="hidden w-[244px] shrink-0 flex-col md:flex">
        <Brand />
        {nav}
        <Footer workspace={context?.workspace} />
      </aside>

      {/* Phone drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/25" onClick={() => setDrawer(false)} />
          <div className="relative flex h-full w-[260px] flex-col bg-sunken shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            <Footer workspace={context?.workspace} />
          </div>
        </div>
      )}

      <div className="m-0 flex min-w-0 flex-1 flex-col md:my-2 md:mr-2 md:overflow-hidden md:rounded-2xl md:border md:bg-canvas">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open menu"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken md:hidden"
            >
              <Menu className="h-4 w-4" />
            </button>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-[13px]">
              <span className="truncate text-ink-muted">{context?.hospital.name ?? "Wellness Hospital"}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted/60" aria-hidden="true" />
              <span className="truncate font-medium text-ink" aria-current="page">
                {current?.label ?? "Dashboard"}
              </span>
            </nav>
          </div>

          <Link
            href="/dashboard"
            className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink sm:inline-flex"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Tringlo
          </Link>

          <button
            type="button"
            onClick={toggleTheme}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>

        <main className="flex-1 md:overflow-y-auto">
          <div ref={pageRef} className="mx-auto w-full max-w-[1180px] px-4 py-6 md:px-10 md:py-10">
            {/*
              A workspace that is not a hospital gets the invitation rather
              than eleven pages of errors. Nothing here is set up by accident:
              somebody turns it on.
            */}
            {context && !context.isHospital ? <NotAHospital workspace={context.workspace.name} /> : children}
          </div>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-2.5 px-5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-canvas" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[17px] leading-tight text-ink">Wellness Hospital</span>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--lime)] ring-1 ring-ink/10" aria-hidden="true" />
          Operations
        </span>
      </span>
    </div>
  );
}

function Footer({ workspace }: { workspace?: { id: string; name: string } }) {
  return (
    <div className="border-t px-5 py-3">
      <p className="text-[11px] leading-relaxed text-ink-muted">
        Runs on Tringlo AI. Calls, agents and numbers are managed by the platform.
      </p>
      {workspace && (
        <p className="mt-1.5 truncate text-[10.5px] text-ink-muted" title={workspace.id}>
          Workspace: {workspace.name}
        </p>
      )}
    </div>
  );
}

/**
 * Shown when somebody opens the hospital panel on a workspace that is not a
 * hospital.
 *
 * Enabling is a deliberate act and an owner's or admin's to take, so this
 * explains what it does rather than quietly doing it on first view — which is
 * exactly the behaviour that used to turn the wrong workspace into a hospital.
 */
function NotAHospital({ workspace }: { workspace: string }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api("hospital/workspace", { method: "POST", body: JSON.stringify({}) });
      window.location.reload();
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "That did not work.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center rounded-xl border border-dashed bg-surface px-6 py-14 text-center">
      <h1 className="font-display text-[26px] text-ink">Not a hospital workspace</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        <strong className="font-semibold text-ink-soft">{workspace}</strong> is not set up as a hospital, so there are
        no appointments, patients or confirmation calls to show. Turning the hospital panel on adds those sections for
        this workspace. Nothing is created until you do, and the rest of Tringlo is unchanged either way.
      </p>
      {problem && <p className="mt-4 text-[13px] text-alert">{problem}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={enable} disabled={busy}>
          {busy ? "Turning it on…" : "Turn the hospital panel on"}
        </Button>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center rounded-lg border bg-raised px-3.5 text-[13px] font-medium text-ink hover:bg-sunken"
        >
          Back to Tringlo
        </Link>
      </div>
    </div>
  );
}
