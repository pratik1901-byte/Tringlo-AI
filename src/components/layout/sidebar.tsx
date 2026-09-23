"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    BarChart3,
    Bot,
    ClipboardList,
    Clock,
    LayoutDashboard,
    LogOut,
    Megaphone,
    Phone,
    Settings,
    Upload,
    Users,
} from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const navigation = [
    { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
    { name: "Leads", href: "/leads", icon: Users },
    { name: "Upload", href: "/upload", icon: Upload },
    { name: "Campaigns", href: "/campaigns", icon: Megaphone },
    { name: "Results", href: "/results", icon: ClipboardList },
    { name: "Follow-ups", href: "/follow-ups", icon: Clock },
    { name: "AI Agent", href: "/agent", icon: Bot },
    { name: "Analytics", href: "/analytics", icon: BarChart3 },
    { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();
    const { user, logout } = useAuthStore();

    return (
        <aside className="flex h-full w-[220px] flex-col bg-sidebar border-r border-sidebar-border">
            {/* Logo */}
            <div className="flex h-14 items-center gap-2 px-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                    <Phone className="h-4 w-4 text-primary-foreground" />
                </div>
                <span className="text-base font-bold tracking-tight text-foreground">
                    Dialo AI
                </span>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-0.5 px-3 pt-2">
                {navigation.map((item) => {
                    const isActive =
                        pathname === item.href ||
                        (item.href !== "/dashboard" && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                                isActive
                                    ? "bg-sidebar-accent text-sidebar-primary"
                                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
                            )}
                        >
                            <item.icon className="h-4 w-4 shrink-0" />
                            {item.name}
                        </Link>
                    );
                })}
            </nav>

            {/* User profile at bottom — matches Figma */}
            <div className="border-t border-sidebar-border p-3">
                <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {(user?.name || "U").charAt(0).toUpperCase()}{(user?.name || "Us").charAt(1)?.toUpperCase() || ""}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-none">{user?.name || "User"}</p>
                        <p className="truncate text-[11px] text-muted-foreground mt-0.5">{user?.email || ""}</p>
                    </div>
                    <button
                        onClick={logout}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title="Sign out"
                    >
                        <LogOut className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
        </aside>
    );
}
