"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
    AgentConfig,
    AppSettings,
    Campaign,
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
interface AuthUser {
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
    /** Set when a session ended by itself rather than by the user signing out. */
    expired: boolean;
    /** Asks the server who this is. Called on load and after signing in. */
    refresh: () => Promise<void>;
    signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
    signOut: () => Promise<void>;
    /** Called when any request is rejected, so one 401 signs out every screen. */
    handleUnauthorized: () => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
    status: "checking",
    user: null,
    expired: false,

    refresh: async () => {
        try {
            const response = await fetch("/api/auth/me", { cache: "no-store" });
            if (!response.ok) {
                set({ status: "signedOut", user: null });
                return;
            }
            const body = await response.json();
            set({ status: "signedIn", user: body.user ?? null, expired: false });
        } catch {
            // Unreachable server is not the same as signed out, but there is
            // nothing to show either way until it answers.
            set({ status: "signedOut", user: null });
        }
    },

    signIn: async (email, password) => {
        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const body = await response.json().catch(() => ({}));

            if (!response.ok) {
                return { ok: false, error: body?.error?.message ?? "Could not sign in." };
            }

            // The session is the cookie the server just set; the token in the
            // body is for mobile clients and is deliberately not stored here.
            set({ status: "signedIn", user: body.user ?? null, expired: false });
            return { ok: true };
        } catch {
            return { ok: false, error: "Could not reach the server." };
        }
    },

    signOut: async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } catch {
            // The local state is cleared regardless: someone who asked to sign
            // out must end up signed out even if the network refused.
        }
        set({ status: "signedOut", user: null, expired: false });
    },

    handleUnauthorized: () => {
        if (get().status === "signedOut") return;
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

// --- Campaigns Store ---
interface CampaignsState {
    campaigns: Campaign[];
    addCampaign: (campaign: Campaign) => void;
    updateCampaign: (id: string, updates: Partial<Campaign>) => void;
}

export const useCampaignsStore = create<CampaignsState>()(
    persist(
        (set) => ({
            campaigns: [],
            addCampaign: (campaign) =>
                set((state) => ({ campaigns: [...state.campaigns, campaign] })),
            updateCampaign: (id, updates) =>
                set((state) => ({
                    campaigns: state.campaigns.map((c) =>
                        c.id === id ? { ...c, ...updates } : c
                    ),
                })),
        }),
        { name: "dialo-campaigns" }
    )
);

// --- Agent Config Store ---
interface AgentConfigState {
    config: AgentConfig;
    updateConfig: (updates: Partial<AgentConfig>) => void;
}

export const useAgentConfigStore = create<AgentConfigState>()(
    persist(
        (set) => ({
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
        }),
        { name: "dialo-agent-config" }
    )
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

export const useCompanyProfileStore = create<CompanyProfileState>()(
    persist(
        (set) => ({
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
        }),
        { name: "dialo-company" }
    )
);

// --- Settings Store ---
// Blank by default: a pre-filled business name, contact or API key would read as
// configured state the user never entered.
interface SettingsState {
    settings: AppSettings;
    updateSettings: (updates: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
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
        }),
        { name: "dialo-settings" }
    )
);
