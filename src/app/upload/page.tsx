"use client";

import { useState, useRef } from "react";
import { UploadCloud, FileType, CheckCircle2, AlertCircle, Loader2, Plus, X, Calendar } from "lucide-react";
import { parseCSV } from "@/lib/csv-utils";
import { useAgentConfigStore } from "@/lib/store";
import type { CSVParseResult, Lead } from "@/lib/types";
import { useRouter } from "next/navigation";
import { RealCallModal } from "@/components/call/RealCallModal";
import { ErrorState, PageTitle } from "@/components/ui/data-display";

type InputMethod = "enter" | "csv";
type ScheduleMode = "now" | "schedule";

interface LeadRow {
    id: string;
    name: string;
    phone: string;
    mode: ScheduleMode;
    date: string;
    time: string;
}

function emptyRow(): LeadRow {
    return {
        id: `row_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: "",
        phone: "",
        mode: "now",
        date: new Date().toISOString().split("T")[0],
        time: "10:00",
    };
}

export default function UploadPage() {
    const [method, setMethod] = useState<InputMethod>("enter");
    const [rows, setRows] = useState<LeadRow[]>([emptyRow()]);
    const [isDragging, setIsDragging] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [result, setResult] = useState<CSVParseResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { config: agentConfig } = useAgentConfigStore();
    const router = useRouter();
    const [activeLead, setActiveLead] = useState<Lead | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    /**
     * Persists leads to the database and returns the saved rows.
     *
     * Uploads used to land only in browser state, so a lead existed on the page
     * that had no row on the server — which meant the call pipeline could not
     * find it, and a different browser saw nothing at all.
     */
    const persistLeads = async (drafts: Array<Partial<Lead>>): Promise<Lead[]> => {
        const saved: Lead[] = [];
        for (const draft of drafts) {
            const response = await fetch("/api/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(draft),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || `Could not save ${draft.phone}.`);
            }
            saved.push((await response.json()) as Lead);
        }
        return saved;
    };

    // --- Enter Numbers logic ---
    const updateRow = (id: string, field: keyof LeadRow, value: string) => {
        setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const addRow = () => setRows(prev => [...prev, emptyRow()]);

    const removeRow = (id: string) => {
        if (rows.length <= 1) return;
        setRows(prev => prev.filter(r => r.id !== id));
    };

    const validRows = rows.filter(r => r.phone.replace(/\D/g, "").length >= 10);
    const callNowCount = validRows.filter(r => r.mode === "now").length;
    const scheduleCount = validRows.filter(r => r.mode === "schedule").length;

    const getSubmitLabel = () => {
        if (isSaving) return "Saving";
        if (validRows.length === 0) return "Add phone number to start";
        const parts: string[] = [];
        if (callNowCount > 0) parts.push(`Start ${callNowCount} Now`);
        if (scheduleCount > 0) parts.push(`Schedule ${scheduleCount}`);
        return parts.join(" · ");
    };

    const handleSubmitNumbers = async () => {
        if (validRows.length === 0 || isSaving) return;
        setIsSaving(true);
        setSaveError(null);

        try {
            const saved = await persistLeads(
                validRows.map((row, index) => ({
                    name: row.name.trim() || (validRows.length > 1 ? `Customer ${index + 1}` : "Customer"),
                    phone: row.phone.trim(),
                    callingDate: row.date,
                    callingTime: row.time,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }))
            );

            // Only the first "call now" row is dialled here. Calls are placed one at
            // a time so every attempt has a visible, attributable result.
            const firstImmediate = validRows.findIndex((row) => row.mode === "now");
            if (firstImmediate >= 0 && saved[firstImmediate]) {
                setActiveLead(saved[firstImmediate]);
            } else {
                router.push("/leads");
            }
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Could not save these leads.");
        } finally {
            setIsSaving(false);
        }
    };

    // --- CSV logic ---
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault(); setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type === "text/csv") await processFile(file);
    };
    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) await processFile(file);
    };
    const processFile = async (file: File) => {
        setIsParsing(true); setResult(null);
        try { const parsed = await parseCSV(file); setResult(parsed); } catch (error) { console.error("Error parsing CSV:", error); } finally { setIsParsing(false); }
    };
    const handleImport = async () => {
        if (!result || result.valid.length === 0 || isSaving) return;
        setIsSaving(true);
        setSaveError(null);

        try {
            await persistLeads(result.valid);
            router.push("/leads");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Could not import these leads.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Page header */}
            <div className="">
                <PageTitle title="Upload leads" />
                <p className="mt-2 text-sm text-muted-foreground">
                    Add phone numbers and set a call schedule for each one
                </p>
            </div>

            {/* Input method tabs */}
            <div className="rounded-xl border bg-card shadow-sm">
                <div className="px-5 pt-5 pb-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Input Method</p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setMethod("enter")}
                            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${method === "enter" ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                        >
                            Enter Numbers
                        </button>
                        <button
                            onClick={() => setMethod("csv")}
                            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${method === "csv" ? "bg-primary text-primary-foreground shadow-sm" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
                        >
                            Upload CSV
                        </button>
                    </div>
                </div>

                {method === "enter" ? (
                    <div className="p-5 space-y-4">
                        {/* Column headers */}
                        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1 phone:hidden">
                            <span>Name</span>
                            <span>Phone Number</span>
                            <span className="text-center">Schedule</span>
                            <span />
                        </div>

                        {/* Rows */}
                        {rows.map((row) => (
                            <div key={row.id} className="space-y-2">
                                <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-center phone:grid-cols-[1fr_auto]! phone:gap-2 phone:rounded-lg phone:border phone:p-3">
                                    <input
                                        type="text"
                                        placeholder="Name (e.g. Rahul, Priya...)"
                                        aria-label="Name"
                                        value={row.name}
                                        onChange={e => updateRow(row.id, "name", e.target.value)}
                                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring phone:col-span-2 phone:h-11"
                                    />
                                    <input
                                        type="text"
                                        placeholder="+91 98765 43210"
                                        aria-label="Phone number"
                                        inputMode="tel"
                                        value={row.phone}
                                        onChange={e => updateRow(row.id, "phone", e.target.value)}
                                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11 phone:min-w-0"
                                    />
                                    <div className="flex items-center gap-1 rounded-lg border border-input bg-background p-0.5 phone:order-last phone:col-span-2">
                                        <button
                                            onClick={() => updateRow(row.id, "mode", "now")}
                                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors phone:h-9 phone:flex-1 ${row.mode === "now" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                                        >
                                            Call Now
                                        </button>
                                        <button
                                            onClick={() => updateRow(row.id, "mode", "schedule")}
                                            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors phone:h-9 phone:flex-1 ${row.mode === "schedule" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                                        >
                                            Schedule
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeRow(row.id)}
                                        aria-label="Remove this number"
                                        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors phone:h-11 phone:w-11 phone:border"
                                        disabled={rows.length <= 1}
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>

                                {/* Schedule date/time picker (inline beneath row) */}
                                {row.mode === "schedule" && (
                                    <div className="flex items-center gap-3 pl-1 phone:gap-2 phone:pl-0">
                                        <Calendar className="h-4 w-4 text-muted-foreground shrink-0 phone:hidden" />
                                        <input
                                            type="date"
                                            value={row.date}
                                            onChange={e => updateRow(row.id, "date", e.target.value)}
                                            className="h-9 rounded-lg border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11 phone:min-w-0 phone:flex-1"
                                        />
                                        <input
                                            type="time"
                                            value={row.time}
                                            onChange={e => updateRow(row.id, "time", e.target.value)}
                                            className="h-9 rounded-lg border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring phone:h-11 phone:min-w-0 phone:flex-1"
                                        />
                                    </div>
                                )}
                            </div>
                        ))}

                        {/* Add number button */}
                        <button
                            onClick={addRow}
                            className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors pt-1"
                        >
                            <Plus className="h-4 w-4" />
                            Add number
                        </button>

                        {/* Summary footer */}
                        {validRows.length >= 2 && (
                            <p className="text-xs text-muted-foreground border-t pt-3">
                                {validRows.length} numbers · {callNowCount} call now · {scheduleCount} scheduled
                            </p>
                        )}

                        {/* Submit */}
                        <button
                            onClick={handleSubmitNumbers}
                            disabled={validRows.length === 0 || isSaving}
                            className="w-full h-11 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none shadow-sm"
                        >
                            {getSubmitLabel()}
                        </button>
                    </div>
                ) : (
                    /* CSV Upload */
                    <div className="p-5 space-y-5">
                        {!result && (
                            <>
                                <div
                                    className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                >
                                    <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileSelect} />
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
                                        {isParsing ? <Loader2 className="h-6 w-6 text-primary animate-spin" /> : <UploadCloud className="h-6 w-6 text-primary" />}
                                    </div>
                                    <h3 className="text-base font-semibold mb-1">{isParsing ? "Parsing..." : "Drop CSV here"}</h3>
                                    <p className="text-xs text-muted-foreground mb-4">
                                        Required columns: name, phone_number, calling_date, calling_time, timezone
                                    </p>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isParsing}
                                        className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-5 text-sm font-medium transition-colors disabled:opacity-50"
                                    >
                                        Select File
                                    </button>
                                </div>

                                {/* Column reference */}
                                <div className="rounded-lg bg-muted/50 border p-4 text-xs text-muted-foreground">
                                    <p className="font-semibold text-foreground mb-1.5">Accepted CSV columns:</p>
                                    <p>name · phone_number · calling_date · calling_time · timezone · email · company · campaign · notes</p>
                                </div>
                            </>
                        )}

                        {result && (
                            <div className="space-y-5">
                                <div className="grid gap-4 grid-cols-3 phone:gap-2">
                                    <div className="rounded-lg border bg-background p-4 flex items-center gap-3 phone:flex-col phone:items-start phone:gap-2 phone:p-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent">
                                            <FileType className="h-5 w-5 text-accent-foreground" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Total</p>
                                            <p className="text-xl font-bold">{result.totalRows}</p>
                                        </div>
                                    </div>
                                    <div className="rounded-lg border bg-background p-4 flex items-center gap-3 phone:flex-col phone:items-start phone:gap-2 phone:p-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Valid</p>
                                            <p className="text-xl font-bold">{result.valid.length}</p>
                                        </div>
                                    </div>
                                    <div className="rounded-lg border bg-background p-4 flex items-center gap-3 phone:flex-col phone:items-start phone:gap-2 phone:p-3">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                                            <AlertCircle className="h-5 w-5 text-red-600" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">Errors</p>
                                            <p className="text-xl font-bold">{result.errors.length}</p>
                                        </div>
                                    </div>
                                </div>

                                {result.errors.length > 0 && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/10 p-4 max-h-40 overflow-auto space-y-1.5">
                                        {result.errors.map((err, i) => (
                                            <div key={i} className="text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                                                <span className="font-mono bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 rounded text-[10px]">Row {err.row}</span>
                                                <span>{err.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex items-center justify-end gap-3 pt-2">
                                    <button onClick={() => setResult(null)} className="h-10 px-4 rounded-lg border border-input bg-background hover:bg-accent text-sm font-medium transition-colors">Cancel</button>
                                    <button onClick={handleImport} disabled={result.valid.length === 0 || isSaving} className="h-10 px-6 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors disabled:opacity-50 shadow-sm">
                                        {isSaving ? "Importing" : `Import ${result.valid.length} leads`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {saveError && <ErrorState message={saveError} />}

            {/* Real Sarvam Voice Agents Call Modal */}
            {activeLead && (
                <RealCallModal
                    lead={activeLead}
                    agentConfig={agentConfig}
                    onClose={() => {
                        setActiveLead(null);
                        router.push("/results");
                    }}
                />
            )}
        </div>
    );
}
