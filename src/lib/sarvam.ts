// ============================================================
// Sarvam AI — Constants & Script Generator
// ============================================================

import type { AgentConfig } from "./types";

// --- Supported Languages ---
export const SARVAM_LANGUAGES = [
    { code: "hi-IN", label: "Hindi" },
    { code: "en-IN", label: "English (India)" },
    { code: "ta-IN", label: "Tamil" },
    { code: "te-IN", label: "Telugu" },
    { code: "kn-IN", label: "Kannada" },
    { code: "ml-IN", label: "Malayalam" },
    { code: "mr-IN", label: "Marathi" },
    { code: "bn-IN", label: "Bengali" },
    { code: "gu-IN", label: "Gujarati" },
    { code: "pa-IN", label: "Punjabi" },
    { code: "od-IN", label: "Odia" },
] as const;

export type SarvamLanguageCode = (typeof SARVAM_LANGUAGES)[number]["code"];

// --- Supported Speakers (bulbul:v3) ---
export const SARVAM_SPEAKERS = [
    { id: "priya", label: "Priya", gender: "Female", language: "en-IN" },
    { id: "rohan", label: "Rohan", gender: "Male", language: "en-IN" },
    { id: "neha", label: "Neha", gender: "Female", language: "hi-IN" },
    { id: "aditya", label: "Aditya", gender: "Male", language: "hi-IN" },
    { id: "ritu", label: "Ritu", gender: "Female", language: "hi-IN" },
    { id: "rahul", label: "Rahul", gender: "Male", language: "hi-IN" },
    { id: "pooja", label: "Pooja", gender: "Female", language: "hi-IN" },
    { id: "simran", label: "Simran", gender: "Female", language: "pa-IN" },
    { id: "kavya", label: "Kavya", gender: "Female", language: "te-IN" },
    { id: "kavitha", label: "Kavitha", gender: "Female", language: "ta-IN" },
    { id: "vijay", label: "Vijay", gender: "Male", language: "ta-IN" },
    { id: "dev", label: "Dev", gender: "Male", language: "gu-IN" },
    { id: "ishita", label: "Ishita", gender: "Female", language: "bn-IN" },
    { id: "shreya", label: "Shreya", gender: "Female", language: "mr-IN" },
    { id: "kabir", label: "Kabir", gender: "Male", language: "en-IN" },
    { id: "anand", label: "Anand", gender: "Male", language: "kn-IN" },
    { id: "shruti", label: "Shruti", gender: "Female", language: "en-IN" },
    { id: "mohit", label: "Mohit", gender: "Male", language: "hi-IN" },
    { id: "soham", label: "Soham", gender: "Male", language: "bn-IN" },
    { id: "rupali", label: "Rupali", gender: "Female", language: "mr-IN" },
] as const;

export type SarvamSpeakerId = (typeof SARVAM_SPEAKERS)[number]["id"];

// --- TTS Model ---
export const SARVAM_TTS_MODEL = "bulbul:v3";

// --- Sarvam API Base ---
export const SARVAM_API_BASE = "https://api.sarvam.ai";

// --- Preview Script (shorter, for TTS test) ---
export function generatePreviewScript(config: AgentConfig): string {
    const company = config.companyName || "our company";
    const products = config.productsServices || "our products and services";

    return `Hello! This is a preview of your AI sales agent from ${company}. We specialize in ${products}. Thank you for listening!`;
}

// --- Decode Sarvam base64 audio ---
export function base64ToAudioBlob(base64: string, mimeType = "audio/wav"): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}
