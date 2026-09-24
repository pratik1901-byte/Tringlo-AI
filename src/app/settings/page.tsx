"use client";

import { useEffect, useState } from "react";
import { NotificationsCard } from "@/components/settings/notifications-card";
import { Check, RefreshCw } from "lucide-react";

import { useSettingsStore } from "@/lib/store";
import { useProviderStatus } from "@/lib/use-dialo-data";
import { ErrorState } from "@/components/ui/data-display";

export default function SettingsPage() {
    const { settings, updateSettings } = useSettingsStore();
    const [savedNotice, setSavedNotice] = useState(false);

    const triggerSavedNotice = () => {
        setSavedNotice(true);
        setTimeout(() => setSavedNotice(false), 2000);
    };

    // The calling window is enforced by the server-side scheduler, so it lives on
    // the server. These fields used to write only to browser storage, which the
    // scheduler never read — changing them had no effect on any call.
    const [windowError, setWindowError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/agent-config", { cache: "no-store" })
            .then((response) => response.json())
            .then((body) => {
                if (cancelled || !body?.callingWindow) return;
                updateSettings({
                    callWindowFrom: body.callingWindow.from,
                    callWindowTo: body.callingWindow.to,
                });
            })
            .catch(() => {
                if (!cancelled) setWindowError("Could not load the calling window from the server.");
            });
        return () => {
            cancelled = true;
        };
    }, [updateSettings]);

    const saveCallingWindow = async (from: string, to: string) => {
        updateSettings({ callWindowFrom: from, callWindowTo: to });
        try {
            const response = await fetch("/api/agent-config", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    callingWindow: {
                        from,
                        to,
                        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    },
                }),
            });
            if (!response.ok) throw new Error();
            setWindowError(null);
            triggerSavedNotice();
        } catch {
            setWindowError("The calling window was not saved to the server.");
        }
    };

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header matching Figma */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Manage your account and preferences
                    </p>
                </div>
                {savedNotice && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        Saved
                    </span>
                )}
            </div>

            {/* 1. Business Profile Card */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold">Business Profile</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Business Name
                        </label>
                        <input
                            type="text"
                            value={settings.businessName}
                            onChange={(e) => {
                                updateSettings({ businessName: e.target.value });
                                triggerSavedNotice();
                            }}
                            className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Contact Email
                        </label>
                        <input
                            type="email"
                            value={settings.contactEmail}
                            onChange={(e) => {
                                updateSettings({ contactEmail: e.target.value });
                                triggerSavedNotice();
                            }}
                            className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Phone Number
                        </label>
                        <input
                            type="tel"
                            value={settings.phoneNumber}
                            onChange={(e) => {
                                updateSettings({ phoneNumber: e.target.value });
                                triggerSavedNotice();
                            }}
                            className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Timezone
                        </label>
                        <select
                            value={settings.timezone}
                            onChange={(e) => {
                                updateSettings({ timezone: e.target.value });
                                triggerSavedNotice();
                            }}
                            className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <option value="Asia/Kolkata (IST)">Asia/Kolkata (IST)</option>
                            <option value="America/New_York (EST)">America/New_York (EST)</option>
                            <option value="America/Los_Angeles (PST)">America/Los_Angeles (PST)</option>
                            <option value="Europe/London (GMT)">Europe/London (GMT)</option>
                            <option value="Asia/Dubai (GST)">Asia/Dubai (GST)</option>
                            <option value="Asia/Singapore (SGT)">Asia/Singapore (SGT)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* 2. Call Preferences Card */}
            <div className="rounded-xl border bg-card p-6 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold">Call Preferences</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Max Retries per Lead
                        </label>
                        <select
                            value={settings.maxRetries}
                            onChange={(e) => {
                                updateSettings({ maxRetries: e.target.value });
                                triggerSavedNotice();
                            }}
                            className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <option value="1 attempt">1 attempt</option>
                            <option value="2 attempts">2 attempts</option>
                            <option value="3 attempts">3 attempts</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Retry Delay (minutes)
                        </label>
                        <select
                            value={settings.retryDelay}
                            onChange={(e) => {
                                updateSettings({ retryDelay: e.target.value });
                                triggerSavedNotice();
                            }}
                            className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <option value="15 min">15 min</option>
                            <option value="30 min">30 min</option>
                            <option value="45 min">45 min</option>
                            <option value="60 min">60 min</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Call Window — From
                        </label>
                        <div className="relative">
                            <input
                                type="time"
                                value={settings.callWindowFrom}
                                onChange={(e) => saveCallingWindow(e.target.value, settings.callWindowTo)}
                                className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                            Call Window — To
                        </label>
                        <div className="relative">
                            <input
                                type="time"
                                value={settings.callWindowTo}
                                onChange={(e) => saveCallingWindow(settings.callWindowFrom, e.target.value)}
                                className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </div>
                    </div>
                    <p className="sm:col-span-2 text-xs leading-relaxed text-muted-foreground">
                        Applies to retries Dialo schedules on its own. A callback time the customer asks
                        for is always honoured, even outside these hours.
                        {windowError && (
                            <span className="ml-1 text-amber-600 dark:text-amber-400">{windowError}</span>
                        )}
                    </p>
                </div>
            </div>

            {/* 3. Notifications — server-backed, so the server can act on them. */}
            <NotificationsCard />

            {/* 5. Sarvam Voice Agents & Telephony Diagnostic Card */}
            <SarvamDiagnosticCard />
        </div>
    );
}

/**
 * Read-only view of the server's Sarvam configuration.
 *
 * Credentials live in server environment variables and are never sent to the
 * browser — this panel reports only whether each one is present, plus whether
 * Sarvam is actually reachable with them.
 */
function SarvamDiagnosticCard() {
    const { data: status, isLoading, isRefreshing, refresh, error } = useProviderStatus();

    const checks: Array<{ label: string; ok: boolean; missingLabel: string }> = status
        ? [
              { label: "API key", ok: status.hasApiKey, missingLabel: "Missing" },
              { label: "Org & workspace", ok: status.hasOrgId && status.hasWorkspaceId, missingLabel: "Not set" },
              { label: "Voice agent", ok: status.hasAgentId, missingLabel: "Not set" },
              { label: "Telephony connection", ok: status.hasConnectionId, missingLabel: "Not set" },
              { label: "Caller ID", ok: status.hasPhoneNumber, missingLabel: "Not set" },
              { label: "Public webhook URL", ok: status.hasPublicUrl, missingLabel: "Not reachable" },
          ]
        : [];

    const isReady = status?.status === "ready";

    return (
        <section className="space-y-4 rounded-lg border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="font-heading text-sm font-semibold tracking-tight">
                        Sarvam Voice Agents &amp; telephony
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        Server configuration and live provider connectivity
                    </p>
                </div>
                <button
                    onClick={refresh}
                    disabled={isLoading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                    <RefreshCw className={`h-3 w-3 ${isRefreshing || isLoading ? "animate-spin" : ""}`} />
                    Check
                </button>
            </div>

            {error && <ErrorState message={error} onRetry={refresh} />}

            {status && (
                <>
                    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {checks.map((check) => (
                            <div key={check.label} className="rounded-md border bg-muted/20 px-3 py-2.5">
                                <dt className="text-xs text-muted-foreground">{check.label}</dt>
                                <dd
                                    className={`mt-1 text-xs font-medium ${
                                        check.ok
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-amber-600 dark:text-amber-400"
                                    }`}
                                >
                                    {check.ok ? "Configured" : check.missingLabel}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    <div
                        className={`rounded-md border px-4 py-3 text-xs leading-relaxed ${
                            isReady
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                                : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
                        }`}
                    >
                        <p>{status.providerDetails || status.details}</p>
                        {status.missing.length > 0 && (
                            <p className="mt-2 font-mono text-[11px]">
                                Not set: {status.missing.join(", ")}
                            </p>
                        )}
                        {status.providerConnectivity === "unreachable" && (
                            <p className="mt-2">
                                Dialo could not reach apps.sarvam.ai, so calls will fail until this is resolved.
                            </p>
                        )}
                    </div>
                </>
            )}
        </section>
    );
}
