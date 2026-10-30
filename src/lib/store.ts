"use client";

import { create } from "zustand";
import type { StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import type {
    AgentConfig,
    AppSettings,
    CompanyProfile,
    TTSGeneration,
} from "./types";

// --- Auth Store ---
//
// A cache of the server's answer, never the authority for it.
//
// This used to BE the authority: `login(email)` set a flag, ignored the
// password entirely, and persisted to localStorage. It gated navigation and
// protected nothing, because no API route checked anything. Authentication now
// lives on the server and travels as an httpOnly session cookie, which this
// code cannot read — which is the point. What is kept here is only who the
// server said you are, so the sidebar can show a name without re-asking.
//
// Nothing is persisted. On reload the app asks /api/auth/me again, because a
// session can be revoked or expire while the tab is closed and only the server
// knows.
export interface AuthUser {
    id: string;
    email: string;
    name: string;
    role: string;
    tenantId: string;
    tenantName: string;
}

interface AuthState {
    status: "checking" | "signedIn" | "signedOut";
    user: AuthUser | null;
    /** The workspace currently open on the session, or null if none is. */
    activeTenantId: string | null;
    /** Whether the open workspace runs the hospital panel. */
    isHospital: boolean;
    /** How many workspaces this account may open. */
    workspaceCount: number;
    /** Set when a session ended by itself rather than by the user signing out. */
    expired: boolean;
    /** Asks the server who this is. Called on load and after signing in. */
    refresh: () => Promise<void>;
    signIn: (
        email: string,
        password: string,
        remember?: boolean
    ) => Promise<{ ok: boolean; error?: string; workspaceCount?: number; activeTenantId?: string | null }>;
    signOut: () => Promise<void>;
    /** Called when any request is rejected, so one 401 signs out every screen. */
    handleUnauthorized: () => void;
    /** Replaces the user after the server confirms a profile change. */
    setUser: (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
    status: "checking",
    user: null,
    activeTenantId: null,
    isHospital: false,
    workspaceCount: 0,
    expired: false,

    refresh: async () => {
        try {
            const response = await fetch("/api/auth/me", { cache: "no-store" });
            if (!response.ok) {
                set({ status: "signedOut", user: null, activeTenantId: null, isHospital: false, workspaceCount: 0 });
                return;
            }
            const body = await response.json();
            set({
                status: "signedIn",
                user: body.user ?? null,
                expired: false,
                // Null until a workspace has been opened. The shell uses it to
                // send the account to the selector rather than to a dashboard
                // that has no workspace to show.
                activeTenantId: body.activeTenantId ?? null,
                isHospital: Boolean(body.isHospital),
                workspaceCount: typeof body.workspaceCount === "number" ? body.workspaceCount : 0,
            });
        } catch {
            // Unreachable server is not the same as signed out, but there is
            // nothing to show either way until it answers.
            set({ status: "signedOut", user: null, activeTenantId: null, isHospital: false, workspaceCount: 0 });
        }
    },

    signIn: async (email, password, remember = true) => {
        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, remember }),
            });
            const body = await response.json().catch(() => ({}));

            if (!response.ok) {
                return { ok: false, error: body?.error?.message ?? "Could not sign in." };
            }

            // The session is the cookie the server just set; the token in the
            // body is for mobile clients and is deliberately not stored here.
            set({ status: "signedIn", user: body.user ?? null, expired: false });
            // One workspace opens straight away; several need choosing, and
            // none means there is a workspace to create first.
            const count = Array.isArray(body.workspaces) ? body.workspaces.length : 0;
            return { ok: true, workspaceCount: count, activeTenantId: body.activeTenantId ?? null };
        } catch {
            return { ok: false, error: "Could not reach the server." };
        }
    },

    signOut: async () => {
        clearBrowserHeldWorkspaceState();
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch {
            // The local state is cleared regardless: someone who asked to sign
            // out must end up signed out even if the network refused.
        }
        set({ status: "signedOut", user: null, expired: false });
    },

    setUser: (user) => set({ user }),

    handleUnauthorized: () => {
        if (get().status === "signedOut") return;
        clearBrowserHeldWorkspaceState();
        set({ status: "signedOut", user: null, expired: true });
    },
}));

// Leads, call records and follow-ups deliberately have no client store.
//
// They used to be mirrored into zustand and persisted to localStorage, which let
// the browser show call outcomes the database did not have — including results
// from a previous session that no longer existed server-side. They are now read
// only through the hooks in lib/use-dialo-data.ts, so the database is the single
// source of truth for anything a call produced.

// Campaigns are server-side (lib/campaigns) and created at Sarvam; the old
// browser-only campaign list that lived here is gone.

// --- Agent Config Store ---
interface AgentConfigState {
    config: AgentConfig;
    updateConfig: (updates: Partial<AgentConfig>) => void;
}

/**
 * The workspace's agent configuration, held for the page that is open.
 *
 * Deliberately NOT persisted to localStorage. It used to be, and the browser
 * then carried one workspace's company into the next: sign out of one
 * workspace, sign in to another, and its AI Agent page opened holding the
 * previous company's name, product and FAQs — which the page's auto-save then
 * wrote into the new workspace. The server is the only source of truth for
 * this, and it is fetched on every load.
 */
/** One blank configuration, shared by the store default, the sign-out reset and the Agent page. */
export const emptyAgentConfig: AgentConfig = {
    companyName: "",
    industry: "",
    companyDescription: "",
    productName: "",
    productDescription: "",
    targetAudience: "",
    qualifyingCriteria: "",
    disqualifyingCriteria: "",
    typicalPainPoints: "",
    agentName: "",
    agentPersona: "",
    objectives: "",
    productsServices: "",
    features: "",
    benefits: "",
    pricing: "",
    faqs: "",
    salesObjective: "",
    conversationGuidelines: "",
    optionalScript: "",
    tone: "professional",
    callDurationGuidance: "",
    systemPrompt: "",
    voiceLanguage: "en-IN",
    voiceSpeaker: "priya",
};

export const useAgentConfigStore = create<AgentConfigState>()(
    ((set) => ({
            config: {
                companyName: "",
                industry: "",
                companyDescription: "",
                productName: "",
                productDescription: "",
                targetAudience: "",
                qualifyingCriteria: "",
                disqualifyingCriteria: "",
                typicalPainPoints: "",
                agentName: "",
                agentPersona: "",
                objectives: "",
                productsServices: "",
                features: "",
                benefits: "",
                pricing: "",
                faqs: "",
                salesObjective: "",
                conversationGuidelines: "",
                optionalScript: "",
                tone: "professional",
                callDurationGuidance: "",
                systemPrompt: "",
                voiceLanguage: "en-IN",
                voiceSpeaker: "priya",
            },
            updateConfig: (updates) =>
                set((state) => ({ config: { ...state.config, ...updates } })),
        })) satisfies StateCreator<AgentConfigState>
);

// --- TTS Generations Store ---
interface TTSGenerationsState {
    generations: TTSGeneration[];
    addGeneration: (gen: TTSGeneration) => void;
    clearGenerations: () => void;
}

export const useTTSGenerationsStore = create<TTSGenerationsState>()(
    persist(
        (set) => ({
            generations: [],
            addGeneration: (gen) =>
                set((state) => ({ generations: [gen, ...state.generations].slice(0, 50) })),
            clearGenerations: () => set({ generations: [] }),
        }),
        { name: "dialo-tts-generations" }
    )
);

// --- Company Profile Store ---
interface CompanyProfileState {
    profile: CompanyProfile;
    updateProfile: (updates: Partial<CompanyProfile>) => void;
}

/** Not persisted: a company profile belongs to a workspace, not to a browser. */
export const useCompanyProfileStore = create<CompanyProfileState>()(
    ((set) => ({
            profile: {
                name: "",
                industry: "",
                website: "",
                phone: "",
                email: "",
                address: "",
                description: "",
            },
            updateProfile: (updates) =>
                set((state) => ({ profile: { ...state.profile, ...updates } })),
        })) satisfies StateCreator<CompanyProfileState>
);

// --- Settings Store ---
// Blank by default: a pre-filled business name, contact or API key would read as
// configured state the user never entered.
interface SettingsState {
    settings: AppSettings;
    updateSettings: (updates: Partial<AppSettings>) => void;
}

/** Not persisted, for the same reason: these are the workspace's settings. */
export const useSettingsStore = create<SettingsState>()(
    ((set) => ({
            settings: {
                businessName: "",
                contactEmail: "",
                phoneNumber: "",
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                maxRetries: "2",
                retryDelay: "30",
                callWindowFrom: "09:00",
                callWindowTo: "18:00",
                emailAlerts: false,
                smsAlerts: false,
                dailySummary: false,
            },
            updateSettings: (updates) =>
                set((state) => ({ settings: { ...state.settings, ...updates } })),
        })) satisfies StateCreator<SettingsState>
);

// ------------------------------------------------------------
// Account Center
// ------------------------------------------------------------
//
// Whether the account window is open, and on which tab. Global rather than
// local to the sidebar because it is opened from two places — the desktop
// sidebar and the phone "More" sheet — and rendered once, in the app shell.

export type AccountTab = "profile" | "email" | "password";

interface AccountCenterState {
    open: boolean;
    tab: AccountTab;
    show: (tab?: AccountTab) => void;
    hide: () => void;
    setTab: (tab: AccountTab) => void;
}

export const useAccountCenter = create<AccountCenterState>()((set) => ({
    open: false,
    tab: "profile",
    show: (tab = "profile") => set({ open: true, tab }),
    hide: () => set({ open: false }),
    setTab: (tab) => set({ tab }),
}));

// ------------------------------------------------------------
// Leaving a workspace
// ------------------------------------------------------------

/**
 * Empties everything the browser was holding on a workspace's behalf.
 *
 * Called when someone signs out or their session is refused. Without it, the
 * next workspace signed into on this machine would open pages still showing
 * the previous one's company, product and generated audio — and the AI Agent
 * page's auto-save would then write them into the new workspace.
 */
export function clearBrowserHeldWorkspaceState(): void {
    useAgentConfigStore.setState({ config: { ...emptyAgentConfig } });
    useCompanyProfileStore.setState({
        profile: { name: "", industry: "", website: "", phone: "", email: "", address: "", description: "" },
    });
    useTTSGenerationsStore.setState({ generations: [] });
    if (typeof window !== "undefined") {
        // Written by earlier versions, which persisted this state. Removed so a
        // browser that still has them does not rehydrate another workspace's.
        for (const key of ["dialo-agent-config", "dialo-company", "dialo-settings", "dialo-tts-generations"]) {
            try {
                window.localStorage.removeItem(key);
            } catch {
                // A browser with storage blocked has nothing to clear.
            }
        }
    }
}
