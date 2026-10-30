"use client";

// ============================================================
// Tringlo AI — Agent variable mapping
// ============================================================
//
// One row per variable the agent declares: its name, where its value comes
// from, and whether a call should wait rather than go without it.
//
// Nothing here knows what an agent is for. The sources describe the data
// Tringlo holds — the person being called, the workspace, this campaign's
// sheet — so an agent that wants `patient_name` and one that wants
// `candidate_name` are both configuration, not code.
// ============================================================

import { Plus, X } from "lucide-react";

import { field } from "@/lib/providers/draft";
import { VARIABLE_SOURCES, type AgentVariableMapping } from "@/lib/providers/variable-mapping";

/** What each source is, in the words of someone setting an agent up. */
const SOURCE_LABELS: Record<string, string> = {
  "lead.name": "Name of the person being called",
  "lead.phone": "Their phone number",
  "lead.email": "Their email",
  "lead.company": "Their company",
  "lead.notes": "Notes on them",
  "workspace.name": "This workspace's name",
  "workspace.company": "Your company name",
  "workspace.product": "Your product or service",
  "workspace.industry": "Your industry",
  "call.campaignName": "The campaign's name",
  "call.previousInteraction": "What happened on the last call",
  literal: "A fixed value you type",
};

export function VariableMapper({
  mappings,
  onChange,
  /** Column names from a campaign sheet, offered as sources. */
  csvColumns = [],
  describe,
}: {
  mappings: AgentVariableMapping[];
  onChange: (next: AgentVariableMapping[]) => void;
  csvColumns?: string[];
  describe?: string;
}) {
  const update = (index: number, patch: Partial<AgentVariableMapping>) =>
    onChange(mappings.map((mapping, at) => (at === index ? { ...mapping, ...patch } : mapping)));

  const add = () => onChange([...mappings, { name: "", source: "lead.name" }]);
  const remove = (index: number) => onChange(mappings.filter((_, at) => at !== index));

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {describe ??
          "Only these are sent, under exactly these names. Leave the list empty if the agent takes no variables — then none are sent and the call still goes."}
      </p>

      {mappings.map((mapping, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <input
            value={mapping.name}
            onChange={(event) => update(index, { name: event.target.value })}
            placeholder="As the agent declares it"
            aria-label="Variable name"
            className={`${field} font-mono text-xs`}
          />
          <div className="flex items-center gap-2">
            <select
              value={mapping.source}
              onChange={(event) => update(index, { source: event.target.value as AgentVariableMapping["source"] })}
              aria-label="Where its value comes from"
              className={`${field} min-w-0 flex-1`}
            >
              {VARIABLE_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source] ?? source}
                </option>
              ))}
              {csvColumns.map((column) => (
                <option key={`csv.${column}`} value={`csv.${column}`}>
                  Sheet column “{column}”
                </option>
              ))}
            </select>
            {mapping.source === "literal" && (
              <input
                value={mapping.value ?? ""}
                onChange={(event) => update(index, { value: event.target.value })}
                placeholder="Value"
                aria-label="Fixed value"
                className={`${field} min-w-0 flex-1`}
              />
            )}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(mapping.required)}
                onChange={(event) => update(index, { required: event.target.checked })}
                className="h-3.5 w-3.5"
              />
              Required
            </label>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Remove ${mapping.name || "this variable"}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" />
        Add a variable
      </button>
    </div>
  );
}
