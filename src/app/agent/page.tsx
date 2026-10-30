"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus, Volume2, X } from "lucide-react";

import { emptyAgentConfig, useAgentConfigStore } from "@/lib/store";
import type { AgentConfig } from "@/lib/types";
import { SARVAM_LANGUAGES, SARVAM_SPEAKERS, base64ToAudioBlob, generatePreviewScript } from "@/lib/sarvam";
import { useFadeIn, useReveal } from "@/lib/animation";
import { PageTitle } from "@/components/ui/data-display";

interface FAQ {
    id: string;
    question: string;
    answer: string;
}

export default function AgentPage() {
    const { config, updateConfig } = useAgentConfigStore();
    const [isTesting, setIsTesting] = useState(false);
    const [testMsg, setTestMsg] = useState("");

    // The configuration is mirrored to the server, because the follow-up
    // scheduler places callbacks with no browser open and needs the company,
    // product and objective to call with. Debounced so typing does not write on
    // every keystroke.
    const [syncState, setSyncState] = useState<"synced" | "saving" | "error">("synced");
    // Nothing is written back until this workspace's own configuration has
    // been read. Saving before that would write whatever the form happened to
    // be holding over what the workspace actually has.
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const response = await fetch("/api/agent-config", { cache: "no-store" });
                if (!response.ok) throw new Error("not ok");
                const body = await response.json();
                if (cancelled) return;
                // Replaces the form wholesale, so a field this workspace has
                // not set reads empty rather than keeping the last one's.
                updateConfig({ ...emptyAgentConfig, ...(body.agentConfig ?? {}) });
            } catch {
                // Leave the form as it is and allow editing; the save below
                // reports its own failures.
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();

        return () => {
            cancelled = true;
        };
        // Runs once per visit to the page.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!loaded) return;

        const timer = setTimeout(async () => {
            setSyncState("saving");
            try {
                const response = await fetch("/api/agent-config", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ agentConfig: config }),
                });
                setSyncState(response.ok ? "synced" : "error");
            } catch {
                setSyncState("error");
            }
        }, 700);

        return () => clearTimeout(timer);
    }, [config, loaded]);

    const headerRef = useFadeIn<HTMLDivElement>();
    const formRef = useReveal<HTMLDivElement>({ delay: 0.05 });
    const panelRef = useFadeIn<HTMLDivElement>({ delay: 0.15 });

    // FAQs state (derive from config.faqs string or manage locally)
    const parseFAQs = (): FAQ[] => {
        if (!config.faqs) return [{ id: "1", question: "", answer: "" }];
        const lines = config.faqs.split("\n");
        const faqs: FAQ[] = [];
        let q = "", a = "";
        lines.forEach(line => {
            if (line.startsWith("Q:")) { if (q) faqs.push({ id: String(faqs.length), question: q, answer: a }); q = line.slice(2).trim(); a = ""; }
            else if (line.startsWith("A:")) a = line.slice(2).trim();
        });
        if (q) faqs.push({ id: String(faqs.length), question: q, answer: a });
        if (faqs.length === 0) faqs.push({ id: "0", question: "", answer: "" });
        return faqs;
    };

    const [faqs, setFaqs] = useState<FAQ[]>(parseFAQs);

    const syncFaqs = (updated: FAQ[]) => {
        setFaqs(updated);
        const text = updated.filter(f => f.question.trim()).map(f => `Q: ${f.question}\nA: ${f.answer}`).join("\n");
        updateConfig({ faqs: text });
    };

    const addFaq = () => syncFaqs([...faqs, { id: String(Date.now()), question: "", answer: "" }]);
    const removeFaq = (id: string) => { if (faqs.length > 1) syncFaqs(faqs.filter(f => f.id !== id)); };
    const updateFaq = (id: string, field: "question" | "answer", value: string) => {
        syncFaqs(faqs.map(f => f.id === id ? { ...f, [field]: value } : f));
    };

    const handleTestVoice = async () => {
        setIsTesting(true);
        setTestMsg("");
        const previewText = generatePreviewScript(config);
        try {
            const response = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: previewText, languageCode: config.voiceLanguage || "en-IN", speaker: config.voiceSpeaker || "priya" }),
            });
            if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `HTTP ${response.status}`); }
            const data = await response.json();
            const blob = base64ToAudioBlob(data.audioBase64, "audio/wav");
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play();
            audio.onended = () => URL.revokeObjectURL(url);
            setTestMsg("Playing voice preview");
        } catch (err) {
            setTestMsg(err instanceof Error ? err.message : "Test failed");
        } finally {
            setIsTesting(false);
        }
    };

    const languageSpeakers = SARVAM_SPEAKERS.filter(s => s.language === config.voiceLanguage);
    const availableSpeakers = languageSpeakers.length > 0 ? languageSpeakers : SARVAM_SPEAKERS;

    return (
        <div className="space-y-6">
            {/* Page header. There is no Save button: every field below writes as you
                type, so a button that only waited would be theatre. */}
            <div ref={headerRef} className="flex items-end justify-between gap-4 pb-2">
                <div>
                    <PageTitle title="AI agent" />
                    <p className="mt-2 text-sm text-muted-foreground">
                        What the agent knows and how it speaks. Changes save as you type.
                    </p>
                </div>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    {syncState === "saving" ? (
                        <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Saving
                        </>
                    ) : syncState === "error" ? (
                        <span className="text-amber-600 dark:text-amber-400">
                            Not saved to the server — callbacks cannot run without it
                        </span>
                    ) : (
                        <>
                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            Saved
                        </>
                    )}
                </span>
            </div>

            {/* Two-column layout — matches Figma */}
            <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
                {/* LEFT: Configuration forms */}
                <div ref={formRef} className="space-y-5">
                    {/* Company Information */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <h3 className="text-sm font-semibold mb-4">Company Information</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Company Name</label>
                                <input
                                    type="text"
                                    value={config.companyName}
                                    onChange={e => updateConfig({ companyName: e.target.value })}
                                    placeholder="Your company name"
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Industry</label>
                                <input
                                    type="text"
                                    value={config.industry}
                                    onChange={e => updateConfig({ industry: e.target.value })}
                                    placeholder="e.g. SaaS, E-commerce"
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                    Company Description
                                </label>
                                <textarea
                                    value={config.companyDescription}
                                    onChange={e => updateConfig({ companyDescription: e.target.value })}
                                    placeholder="What your company does, in a sentence or two"
                                    rows={2}
                                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                />
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    The agent introduces the company with this. Left blank, it has nothing to say about who is calling.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Product / Service Details */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <h3 className="text-sm font-semibold mb-4">Product / Service Details</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Product Name</label>
                                <input
                                    type="text"
                                    value={config.productName}
                                    onChange={e => updateConfig({ productName: e.target.value })}
                                    placeholder="Your product name"
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Description</label>
                                <textarea
                                    value={config.productDescription}
                                    onChange={e => updateConfig({ productDescription: e.target.value })}
                                    placeholder="What it is and what it does. Be specific — this is what the agent will say."
                                    rows={4}
                                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                />
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    Without this the agent knows only the name, and will invent the rest if a customer asks.
                                </p>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                    Who it is for
                                </label>
                                <input
                                    type="text"
                                    value={config.targetAudience}
                                    onChange={e => updateConfig({ targetAudience: e.target.value })}
                                    placeholder="e.g. parents and guardians of children aged 3 to 7"
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    Tringlo assumes nothing about your audience. Say whether this is sold to businesses, to individuals, or to both.
                                </p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                        A good fit is
                                    </label>
                                    <textarea
                                        value={config.qualifyingCriteria}
                                        onChange={e => updateConfig({ qualifyingCriteria: e.target.value })}
                                        placeholder="What makes someone worth pursuing"
                                        rows={3}
                                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                        Not a fit if
                                    </label>
                                    <textarea
                                        value={config.disqualifyingCriteria}
                                        onChange={e => updateConfig({ disqualifyingCriteria: e.target.value })}
                                        placeholder="Leave blank unless you have a real rule"
                                        rows={3}
                                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                                    />
                                    <p className="mt-1.5 text-xs text-muted-foreground">
                                        Only rules you enter here disqualify a lead.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* FAQs */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-sm font-semibold">FAQs</h3>
                                <p className="text-xs text-muted-foreground mt-0.5">Common questions and answers the AI should know</p>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {faqs.map((faq) => (
                                <div key={faq.id} className="rounded-lg border bg-background p-4 space-y-3 relative group">
                                    {faqs.length > 1 && (
                                        <button onClick={() => removeFaq(faq.id)} className="absolute top-3 right-3 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all">
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                    <div>
                                        <label className="text-[11px] font-semibold text-primary uppercase tracking-wider block mb-1">Q:</label>
                                        <input
                                            type="text"
                                            value={faq.question}
                                            onChange={e => updateFaq(faq.id, "question", e.target.value)}
                                            placeholder="What is the price range?"
                                            className="w-full h-9 rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">A:</label>
                                        <input
                                            type="text"
                                            value={faq.answer}
                                            onChange={e => updateFaq(faq.id, "answer", e.target.value)}
                                            placeholder="Our plans start at..."
                                            className="w-full h-9 rounded-md border border-input bg-card px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        />
                                    </div>
                                </div>
                            ))}
                            <button onClick={addFaq} className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors">
                                <Plus className="h-4 w-4" /> Add FAQ
                            </button>
                        </div>
                    </div>

                    {/* Sales Objectives */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <div className="mb-4">
                            <h3 className="text-sm font-semibold">Sales Objectives</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">What should the AI try to achieve in each call?</p>
                        </div>
                        <textarea
                            value={config.salesObjective || config.objectives}
                            onChange={e => updateConfig({ salesObjective: e.target.value, objectives: e.target.value })}
                            placeholder="e.g. Schedule a demo, Qualify lead interest, Collect requirements..."
                            rows={3}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                        />
                    </div>

                    {/* Agent identity */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <div className="mb-4">
                            <h3 className="text-sm font-semibold">Agent Identity</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                The name the agent introduces itself with, and how it carries itself
                            </p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Agent Name</label>
                                <input
                                    type="text"
                                    value={config.agentName}
                                    onChange={e => updateConfig({ agentName: e.target.value })}
                                    placeholder="e.g. Priya"
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                                    Typical customer pain points
                                </label>
                                <input
                                    type="text"
                                    value={config.typicalPainPoints}
                                    onChange={e => updateConfig({ typicalPainPoints: e.target.value })}
                                    placeholder="What your customers struggle with"
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Agent Persona & Talking Style Prompt */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <div className="mb-3">
                            <h3 className="text-sm font-semibold">Agent Persona & Talking Style Prompt</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                Instructions for how the agent should talk, its personality, conversation style, and objection handling rules
                            </p>
                        </div>
                        <textarea
                            value={config.systemPrompt || ""}
                            onChange={e => updateConfig({ systemPrompt: e.target.value })}
                            placeholder="e.g. You are Alex, a friendly, enthusiastic, and highly knowledgeable sales consultant. Speak in a warm, conversational, and natural human tone. Keep answers under 2 sentences. Always listen actively, acknowledge objections with empathy, and naturally steer the conversation toward scheduling a quick 10-minute demo..."
                            rows={4}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                        />
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-muted-foreground mr-1">Quick Presets:</span>
                            {[
                                {
                                    label: "Friendly & Consultative",
                                    prompt: "Speak warmly and conversationally. Listen actively, acknowledge what the person tells you, and keep replies to one or two sentences. Let the configured product description define what you are offering and who it is for.",
                                },
                                {
                                    label: "Direct & Professional",
                                    prompt: "Be polite, direct and concise. Lead with the value described in the product information, avoid filler, and respect the person's time. Do not assume whether they are buying for a business or for themselves — ask, and accept either answer.",
                                },
                                {
                                    label: "High Energy & Enthusiastic",
                                    prompt: "Be energetic and engaging. Speak positively about the benefits stated in the product information, address doubts without dismissing them, and invite a next step. Never claim a benefit the product description does not state.",
                                },
                            ].map((preset) => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => updateConfig({ systemPrompt: preset.prompt })}
                                    className="text-[11px] rounded-full border border-input bg-muted/40 hover:bg-muted px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Voice Settings */}
                    <div className="rounded-xl border bg-card p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold">Voice Settings</h3>
                            <button
                                onClick={handleTestVoice}
                                disabled={isTesting}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-input bg-background hover:bg-accent h-8 px-3 text-xs font-medium transition-colors disabled:opacity-50"
                            >
                                {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />}
                                Test Voice
                            </button>
                        </div>
                        {testMsg && <p className="text-xs text-muted-foreground mb-3">{testMsg}</p>}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Language</label>
                                <select
                                    value={config.voiceLanguage}
                                    onChange={e => updateConfig({ voiceLanguage: e.target.value })}
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    {SARVAM_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Speaker</label>
                                <select
                                    value={config.voiceSpeaker}
                                    onChange={e => updateConfig({ voiceSpeaker: e.target.value })}
                                    className="w-full h-10 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    {availableSpeakers.map(s => <option key={s.id} value={s.id}>{s.label} ({s.gender})</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: what the agent can actually speak from.
                    The previous version showed a disabled chat box that implied a
                    prospect simulator this build does not have. */}
                <div ref={panelRef} className="h-fit lg:sticky lg:top-6">
                    <div className="overflow-hidden rounded-lg border bg-card">
                        <div className="border-b px-5 py-4">
                            <h3 className="font-heading text-sm font-semibold tracking-tight">
                                Approved knowledge
                            </h3>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                Only these fields reach the agent. Anything left blank is something
                                it will decline to answer rather than guess at.
                            </p>
                        </div>

                        {MISSING_ESSENTIALS(config).length > 0 && (
                            <div className="border-b bg-amber-50 px-5 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                The agent has not been told:{" "}
                                <span className="font-medium">{MISSING_ESSENTIALS(config).join(", ")}</span>.
                                It will improvise if a customer asks.
                            </div>
                        )}

                        <ul className="divide-y">
                            {KNOWLEDGE_FIELDS.map((field) => {
                                const filled = Boolean((config[field.key] as string | undefined)?.trim());
                                return (
                                    <li
                                        key={field.key}
                                        className="flex items-center justify-between px-5 py-2.5 text-sm"
                                    >
                                        <span className={filled ? "text-foreground" : "text-muted-foreground"}>
                                            {field.label}
                                        </span>
                                        {filled ? (
                                            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                        ) : (
                                            <span
                                                className={
                                                    field.essential
                                                        ? "text-xs font-medium text-amber-600 dark:text-amber-400"
                                                        : "text-xs text-muted-foreground/60"
                                                }
                                            >
                                                Not set
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="border-t px-5 py-4">
                            <button
                                onClick={handleTestVoice}
                                disabled={isTesting}
                                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                            >
                                {isTesting ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Volume2 className="h-3.5 w-3.5" />
                                )}
                                {isTesting ? "Generating" : "Preview the voice"}
                            </button>
                            {testMsg && (
                                <p className="mt-2 text-center text-xs text-muted-foreground">{testMsg}</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** The config fields that are actually forwarded to Sarvam as input variables. */
const KNOWLEDGE_FIELDS: Array<{ key: keyof AgentConfig; label: string; essential?: boolean }> = [
    { key: "companyName", label: "Company name", essential: true },
    { key: "companyDescription", label: "Company description", essential: true },
    { key: "industry", label: "Industry" },
    { key: "productName", label: "Product name", essential: true },
    { key: "productDescription", label: "Product description", essential: true },
    { key: "targetAudience", label: "Who it is for" },
    { key: "qualifyingCriteria", label: "A good fit is" },
    { key: "disqualifyingCriteria", label: "Not a fit if" },
    { key: "pricing", label: "Pricing" },
    { key: "faqs", label: "FAQs" },
    { key: "salesObjective", label: "Sales objective", essential: true },
    { key: "agentName", label: "Agent name" },
];

/** Essential context whose absence makes the agent guess on a live call. */
function MISSING_ESSENTIALS(config: AgentConfig): string[] {
    return KNOWLEDGE_FIELDS.filter(
        (field) => field.essential && !(config[field.key] as string | undefined)?.trim()
    ).map((field) => field.label.toLowerCase());
}
