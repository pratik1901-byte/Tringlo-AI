// ============================================================
// Dialo AI — Chart Theme
// ============================================================
// One palette and one tooltip treatment for every chart, so the product's data
// reads as a single system. Colours are chosen for legibility against both the
// light and dark surfaces rather than for decoration, and outcome categories
// keep a fixed colour wherever they appear.
// ============================================================

export const CHART_COLORS = {
  primary: "#4F46E5",
  muted: "#C7D2FE",
  axis: "var(--muted-foreground)",
  grid: "var(--border)",

  /** Outcome colours. Stable across the dashboard, analytics and any legend. */
  categorical: {
    interested: "#0F766E",
    not_interested: "#B91C1C",
    unresolved: "#A16207",
    no_answer: "#64748B",
    busy: "#C2410C",
    failed: "#7F1D1D",
  } as Record<string, string>,
} as const;

/** Tooltip chrome matched to the app's cards, in both themes. */
export const chartTooltipStyle = {
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    fontSize: "12px",
    padding: "8px 10px",
    boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.25)",
    color: "var(--card-foreground)",
  },
  labelStyle: {
    color: "var(--muted-foreground)",
    fontSize: "11px",
    marginBottom: "2px",
  },
  itemStyle: {
    color: "var(--card-foreground)",
    fontSize: "12px",
    padding: 0,
  },
} as const;
