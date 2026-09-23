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
interface AuthState {
    isAuthenticated: boolean;
    user: { email: string; name: string } | null;
    login: (email: string) => boolean;
    logout: () => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            isAuthenticated: false,
            user: null,
            // Local-only session marker. There is no backend auth yet, so this
            // gates navigation and nothing more — it protects no data.
            login: (email: string) => {
                set({ isAuthenticated: true, user: { email, name: email.split("@")[0] } });
                return true;
            },
            logout: () => {
                set({ isAuthenticated: false, user: null });
            },
        }),
        { name: "dialo-auth" }
    )
);

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
