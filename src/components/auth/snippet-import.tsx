"use client";

// ============================================================
// Tringlo AI — "paste the Sarvam example" box
// ============================================================
//
// A collapsed area beside each section. The administrator pastes the cURL
// example from Sarvam's documentation; the recognised fields drop into the
// form above, where they can be read and corrected before anything is saved.
//
// The paste is parsed, never run: see lib/providers/sarvam/snippet-import.
// Anything that cannot be read is explained in words, so nobody has to read
// the snippet back to find out what went wrong.
// ============================================================

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ClipboardPaste } from "lucide-react";

import { parseSarvamSnippet, type SnippetKind, type SnippetResult } from "@/lib/providers/sarvam/snippet-import";
import type { ConfigStatus } from "@/lib/providers/types";

export function SnippetImport({
  kind,
  label,
  hint,
  onImport,
  onResult,
}: {
  kind: SnippetKind;
  label: string;
  hint: string;
  /** Called with the recognised fields; the form decides what to keep. */
  onImport?: (fields: Record<string, unknown>) => void;
  /**
   * Called with the whole parse, accepted or not, so the form can show what
   * changed and what it kept. A refused parse is reported too — with no
   * fields — so nothing is ever overwritten on the strength of a bad paste.
   */
  onResult?: (result: SnippetResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[] | null>(null);

  const read = () => {
    const result = parseSarvamSnippet(kind, text);
    setProblems(result.problems);
    setWarnings(result.warnings);
    if (!result.ok) {
      // A refused paste changes nothing. The form keeps what it had, and the
      // reason is shown instead.
      setApplied(null);
      onResult?.(result);
      return;
    }
    onImport?.(result.fields);
    onResult?.(result);
    setApplied(Object.keys(result.fields));
  };

  return (
    <div className="rounded-lg border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-medium">
          <ClipboardPaste className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </span>
        <span className="flex items-center gap-2">
          {applied && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t px-3 py-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            spellCheck={false}
            placeholder="curl --location 'https://apps.sarvam.ai/api/…' --data '{ … }'"
            className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={read}
              disabled={!text.trim()}
              className="h-8 rounded-md border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              Read example
            </button>
            {applied && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                Filled in {applied.length} {applied.length === 1 ? "field" : "fields"} — check them above.
              </span>
            )}
          </div>

          {problems.map((problem) => (
            <p key={problem} className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {problem}
            </p>
          ))}
          {warnings.map((warning) => (
            <p key={warning} className="text-[11px] text-muted-foreground">
              {warning}
            </p>
          ))}

          <p className="text-[11px] text-muted-foreground">
            The example is read, never run. Nothing is sent anywhere, and the snippet itself is not saved.
          </p>
        </div>
      )}
    </div>
  );
}

// What each state is allowed to claim. "Parsed" is as much as the creation
// wizard can honestly say, because nothing is stored until the last button.
// "Verified" belongs only to a check that actually reached Sarvam.
const STATES: Record<ConfigStatus, { words: string; tone: string }> = {
  verified: { words: "Provider verified", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  saved: { words: "Saved", tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  parsed: { words: "Ready to save", tone: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" },
  unavailable: { words: "Not available yet", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  inherited: { words: "Using single-call settings", tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" },
  error: { words: "Needs attention", tone: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" },
  incomplete: { words: "Incomplete", tone: "bg-muted text-muted-foreground" },
  off: { words: "Off", tone: "bg-muted text-muted-foreground" },
};

/** The state of a piece of configuration, in words rather than a colour alone. */
export function StatusChip({ state, label }: { state: ConfigStatus; label?: string }) {
  const { words, tone } = STATES[state];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>
      {label ?? words}
    </span>
  );
}
