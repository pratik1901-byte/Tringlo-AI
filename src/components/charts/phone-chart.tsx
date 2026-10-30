"use client";

// ============================================================
// Tringlo AI — Charts on a Phone
// ============================================================
//
// On a desktop a chart is read by hovering, and the tooltip floats beside the
// pointer. On a phone that design fails in a specific way: the tooltip appears
// where the finger is, so the finger covers the number it was meant to show.
//
// So on a phone the value moves out from under the finger. The pieces here:
//
//   - a readout pinned above the chart, always visible, showing the selected
//     point's values;
//   - tap, or drag horizontally across the chart, to change the selection,
//     with the selected bar highlighted and the rest stepped back;
//   - legend chips that show and hide a series, because on a small screen
//     comparing two series is easier one at a time.
//
// The selection starts on the most recent point, so the readout shows real,
// current data before anything is touched rather than sitting empty.
//
// Nothing here runs on the desktop. `useIsPhone()` is false there, every page
// only adds these props when it is true, and the desktop charts render exactly
// as they did.
// ============================================================

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from "react";
import { Rectangle, useXAxisInverseScale } from "recharts";
import type { InverseScaleFunction } from "recharts/types/hooks";

import { cn } from "@/lib/utils";

/**
 * The phone query. Must match the `phone` variant and the phone theme block in
 * globals.css — the same three places decide what "phone view" means.
 */
export const PHONE_QUERY =
  "(max-width: 767.98px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True in phone view.
 *
 * `useSyncExternalStore` rather than state set from an effect: it reports
 * `false` during server render and hydration, then the real value, without a
 * hydration mismatch and without an extra render caused by an effect.
 */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
}

// ------------------------------------------------------------------
// Selection
// ------------------------------------------------------------------

export interface ChartSelection {
  /** The selected point, clamped to the data. Null only when there is none. */
  index: number | null;
  select: (index: number) => void;
  /**
   * Spread onto the element that wraps the chart. Tap selects; a horizontal
   * drag scrubs, because touchmove is delivered while the finger moves.
   */
  bind: {
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
    onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
    onTouchMove: (event: React.TouchEvent<HTMLElement>) => void;
  };
  /** Render `<ScaleBridge scaleRef={selection.scaleRef} />` inside the chart. */
  scaleRef: MutableRefObject<InverseScaleFunction | undefined>;
}

/**
 * Which data point is under the finger.
 *
 * Why not Recharts' own `onClick` / `onTouchStart`: they report the tooltip
 * state as it was before this event. On a touch device Recharts updates that
 * state in a separate pass, so every tap reported the point touched *last* —
 * the selection lagged one tap behind, and the first tap selected nothing.
 *
 * So the touch is read here directly, and the chart's own x scale is asked
 * which category sits at that pixel. That is Recharts' mapping, not geometry
 * reimplemented here, so it is right for bar (band) and line (point) axes
 * alike, and for any margin or axis width.
 *
 * `labels` are the category values in data order. Every chart here uses a
 * unique `label` per point, so the category resolves to exactly one index.
 */
export function useChartSelection(labels: readonly string[]): ChartSelection {
  // Null means "nothing chosen yet", which resolves to the latest point.
  const [chosen, setChosen] = useState<number | null>(null);
  const scaleRef = useRef<InverseScaleFunction | undefined>(undefined);

  const select = useCallback((index: number) => setChosen(index), []);

  const pickAt = (clientX: number, container: HTMLElement) => {
    const inverse = scaleRef.current;
    // The scale works in the chart surface's own coordinates.
    const surface = container.querySelector(".recharts-wrapper") ?? container;
    if (!inverse) return;
    const x = clientX - surface.getBoundingClientRect().left;
    const category = inverse(x);
    if (category === undefined || category === null) return;
    const index = labels.indexOf(String(category));
    if (index >= 0) setChosen(index);
  };

  // Clamped at read time rather than corrected in an effect, so a refresh that
  // returns fewer points can never leave the readout pointing past the end.
  const length = labels.length;
  const index = length === 0 ? null : Math.min(chosen ?? length - 1, length - 1);

  return {
    index,
    select,
    scaleRef,
    bind: {
      onClick: (event) => pickAt(event.clientX, event.currentTarget),
      onTouchStart: (event) => {
        const touch = event.touches[0];
        if (touch) pickAt(touch.clientX, event.currentTarget);
      },
      onTouchMove: (event) => {
        const touch = event.touches[0];
        if (touch) pickAt(touch.clientX, event.currentTarget);
      },
    },
  };
}

/**
 * Hands the chart's inverse x scale to the selection hook.
 *
 * Recharts only exposes its scales to components rendered inside the chart,
 * so this sits in the chart's children and renders nothing. A ref rather than
 * state: the scale is only read inside event handlers, so updating it must
 * not cause a render.
 */
export function ScaleBridge({
  scaleRef,
}: {
  scaleRef: MutableRefObject<InverseScaleFunction | undefined>;
}) {
  const inverse = useXAxisInverseScale();
  useEffect(() => {
    scaleRef.current = inverse;
  }, [scaleRef, inverse]);
  return null;
}

// ------------------------------------------------------------------
// Series visibility
// ------------------------------------------------------------------

export interface Series {
  key: string;
  name: string;
  color: string;
}

/**
 * Which series are shown. Refuses to hide the last visible one: an empty chart
 * reads as "there is no data", which would be false.
 */
export function useSeriesVisibility(series: Series[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const toggle = useCallback(
    (key: string) => {
      setHidden((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else if (series.length - next.size > 1) {
          next.add(key);
        }
        return next;
      });
    },
    [series.length]
  );

  return { isVisible: (key: string) => !hidden.has(key), toggle };
}

// ------------------------------------------------------------------
// Readout
// ------------------------------------------------------------------

export interface ReadoutItem {
  name: string;
  color: string;
  value: number | string | null;
}

/**
 * The selected point's values, pinned above the chart.
 *
 * `aria-live` so a screen-reader user scrubbing the chart hears each point,
 * which is the same thing a sighted user gets from watching this change.
 */
export function ChartReadout({
  label,
  items,
  hint = "Tap or drag across the chart",
}: {
  label: string | null;
  items: ReadoutItem[];
  hint?: string;
}) {
  return (
    <div
      className="mt-4 flex min-h-[52px] items-center justify-between gap-3 rounded-lg bg-muted/60 px-3.5 py-2.5"
      aria-live="polite"
    >
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label ?? "No data"}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</p>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {items.map((item) => (
          <div key={item.name} className="text-right">
            <p className="flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
              {item.name}
            </p>
            <p className="font-mono text-lg font-semibold leading-tight tabular-nums text-foreground">
              {item.value === null || item.value === undefined ? "—" : item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Legend chips
// ------------------------------------------------------------------

/** A legend that doubles as series toggles. 36px tall — a real touch target. */
export function SeriesChips({
  series,
  isVisible,
  onToggle,
}: {
  series: Series[];
  isVisible: (key: string) => boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Series">
      {series.map((item) => {
        const on = isVisible(item.key);
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onToggle(item.key)}
            aria-pressed={on}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors active:scale-[0.98]",
              on
                ? "border-border bg-card text-foreground"
                : "border-dashed border-border bg-transparent text-muted-foreground"
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-sm transition-opacity"
              style={{ background: item.color, opacity: on ? 1 : 0.3 }}
            />
            {item.name}
          </button>
        );
      })}
    </div>
  );
}

/** Tooltip content for phones: the readout replaces it, so render nothing. */
export function NoTooltip() {
  return null;
}

/** Opacity for a bar or slice given the current selection. */
export function selectionOpacity(index: number, selected: number | null): number {
  if (selected === null) return 1;
  return index === selected ? 1 : 0.38;
}

/**
 * A bar shape that steps back every bar except the selected one.
 *
 * A shape renderer rather than per-bar `<Cell>` children: Recharts 3
 * deprecated Cell and removes it in 4.0, and the rest of the app already
 * colours charts through shape renderers.
 *
 * `key` is lifted out of the props for the same reason as in the dashboard's
 * outcome sector: Recharts passes React's key inside the props object, and
 * spreading it into JSX makes React warn.
 */
export function phoneBarShape(selected: number | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts hands shape renderers untyped props
  return function PhoneBar({ key, ...bar }: any) {
    const index = typeof bar?.index === "number" ? bar.index : null;
    return (
      <Rectangle
        key={key ?? index ?? undefined}
        {...bar}
        fillOpacity={index === null ? 1 : selectionOpacity(index, selected)}
      />
    );
  };
}

/**
 * A line dot that grows at the selected point, so a line chart shows where the
 * readout is reading from. Returns a keyed element for every point, which is
 * what Recharts expects from a dot renderer.
 */
export function phoneLineDot(selected: number | null, color: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts hands dot renderers untyped props
  return function PhoneDot(props: any) {
    const { cx, cy, index } = props ?? {};
    // A null value has no position; drawing it at (0,0) would put a dot in
    // the corner of the chart.
    if (typeof cx !== "number" || typeof cy !== "number") {
      return <g key={`dot-${index}`} />;
    }
    const isSelected = selected !== null && index === selected;
    return (
      <circle
        key={`dot-${index}`}
        cx={cx}
        cy={cy}
        r={isSelected ? 6 : 3}
        fill={isSelected ? "var(--card)" : color}
        stroke={color}
        strokeWidth={isSelected ? 3 : 0}
      />
    );
  };
}
