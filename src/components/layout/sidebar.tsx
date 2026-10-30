"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    Building2,
    ChevronsUpDown,
    BarChart3,
    Bot,
    ClipboardList,
    Clock,
    LayoutDashboard,
    LogOut,
    Megaphone,
    PhoneIncoming,
    Settings,
    Upload,
    Users,
} from "lucide-react";
import { BrandLockup } from "@/components/layout/brand-lockup";
import { useAccountCenter, useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Every destination in the app. Shared with the phone navigation, so the two
 * cannot drift apart when a page is added. `group` sorts the sidebar into the
 * three jobs the app does; the phone menu ignores it.
 */
export const navigation = [
    { name: "Overview", href: "/dashboard", icon: LayoutDashboard, group: null },
    { name: "Leads", href: "/leads", icon: Users, group: "Calling" },
    { name: "Upload", href: "/upload", icon: Upload, group: "Calling" },
    { name: "Campaigns", href: "/campaigns", icon: Megaphone, group: "Calling" },
    { name: "Follow-ups", href: "/follow-ups", icon: Clock, group: "Calling" },
    { name: "Inbound", href: "/inbound", icon: PhoneIncoming, group: "Calling" },
    { name: "Results", href: "/results", icon: ClipboardList, group: "Insights" },
    { name: "Analytics", href: "/analytics", icon: BarChart3, group: "Insights" },
    { name: "AI Agent", href: "/agent", icon: Bot, group: "Configure" },
    { name: "Settings", href: "/settings", icon: Settings, group: "Configure" },
];

/** The sidebar's sections, in order, each with the destinations inside it. */
const SECTIONS = [null, "Calling", "Insights", "Configure"].map((group) => ({
    group,
    items: navigation.filter((item) => item.group === group),
}));

/** The section a page belongs to, for the eyebrow above its title. */
export function sectionFor(pathname: string): string | null {
    return navigation.find((item) => isNavActive(pathname, item.href))?.group ?? null;
}

/** Whether a nav item is the current page, including its sub-routes. */
export function isNavActive(pathname: string, href: string): boolean {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
}

/** Two initials from a name, for an avatar. */
export function initials(name: string | null | undefined, fallback: string): string {
    const parts = (name || fallback).trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || fallback).slice(0, 2);
    return letters.toUpperCase();
}

export function Sidebar() {
    const pathname = usePathname();
    const user = useAuthStore((state) => state.user);
    const signOut = useAuthStore((state) => state.signOut);
    const openAccount = useAccountCenter((state) => state.show);

    return (
        // The sidebar sits on the canvas; the page itself is the raised panel
        // beside it (see AppShell), so the two read as frame and content.
        <aside className="flex h-full w-[232px] shrink-0 flex-col bg-sidebar phone:hidden">
            <div className="flex h-16 items-center px-5">
                <BrandLockup />
            </div>

            {/* Which workspace is open, and the way to another — at the top,
                because every number below belongs to it. Each workspace has
                entirely separate leads, calls and customer memory, so knowing
                which you are in is the difference between "my data is
                missing" and "I am in the other one". */}
            <div className="px-3">
                <Link
                    href="/workspaces"
                    title="Switch workspace"
                    className="group flex w-full items-center gap-2.5 rounded-xl border border-sidebar-border bg-card px-2.5 py-2 text-left shadow-[0_1px_2px_rgba(23,22,20,0.04)] transition-colors hover:border-input"
                >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-[11px] font-semibold tracking-wide text-sidebar-primary-foreground">
                        {user?.tenantName ? initials(user.tenantName, "WS") : <Building2 className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
                            {user?.tenantName || "Choose one"}
                        </span>
                        <span className="block text-[11px] leading-tight text-muted-foreground">Workspace</span>
                    </span>
                    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                </Link>
            </div>

            <nav className="mt-5 flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Main">
                {SECTIONS.map(({ group, items }) => (
                    <div key={group ?? "home"}>
                        {group && (
                            <p className="mb-1.5 px-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                {group}
                            </p>
                        )}
                        <ul className="space-y-0.5">
                            {items.map((item) => {
                                const isActive = isNavActive(pathname, item.href);
                                return (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            aria-current={isActive ? "page" : undefined}
                                            className={cn(
                                                "group flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13px] font-medium transition-[background-color,color,box-shadow]",
                                                isActive
                                                    ? "bg-card text-foreground shadow-[0_1px_2px_rgba(23,22,20,0.06),0_0_0_1px_var(--sidebar-border)]"
                                                    : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
                                            )}
                                        >
                                            <item.icon
                                                className={cn(
                                                    "h-4 w-4 shrink-0 transition-colors",
                                                    isActive ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-foreground"
                                                )}
                                            />
                                            {item.name}
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </nav>

            {/* The account: opens the Account Center (name, email, password),
                with signing out beside it. */}
            <div className="border-t border-sidebar-border p-3">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => openAccount()}
                        aria-haspopup="dialog"
                        title="Account settings"
                        className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                            {initials(user?.name, "U")}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
                                {user?.name || "User"}
                            </span>
                            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                                {user?.email || user?.tenantName || ""}
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={signOut}
                        title="Sign out"
                        aria-label="Sign out"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                        <LogOut className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </aside>
    );
}
