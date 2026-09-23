"use client";

// ============================================================
// Dialo AI — Communication Network
// ============================================================
//
// The background scene: routed paths, nodes that activate, signals that travel
// between them, and a waveform that answers while someone types.
//
// SVG rather than canvas, because the paths need to be animated individually —
// drawn on entrance, dimmed when the password field takes focus, and used as
// motion paths for the travelling signals. That is roughly forty elements,
// which the compositor handles comfortably; it is the per-frame JavaScript
// that would be expensive, and there is none here.
//
// This component owns no animation. It renders the scene and hands the root to
// lib/auth-scene/timelines, which owns all of it.
// ============================================================

import { forwardRef } from "react";

import { EDGES, NODES, VIEWBOX, edgePath } from "@/lib/auth-scene/network-model";

/** Pooled travelling dots. Signals reuse these rather than creating elements. */
const SIGNAL_POOL = 8;

/** Bars in the waveform strip. */
const WAVE_BARS = 28;

interface CommunicationNetworkProps {
  /** Drops the `far` tier on small screens, where density becomes noise. */
  density: "full" | "reduced";
}

export const CommunicationNetwork = forwardRef<SVGSVGElement, CommunicationNetworkProps>(
  function CommunicationNetwork({ density }, ref) {
    const visibleNodes =
      density === "full" ? NODES : NODES.filter((node) => node.tier === "near");
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = EDGES.filter(
      (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)
    );

    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        // Fills the viewport and crops rather than letterboxing, so the network
        // reaches the edges on any aspect ratio.
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 h-full w-full text-primary"
        // Decorative: it carries nothing the form does not already say.
        aria-hidden="true"
        focusable="false"
      >
        {/* Far layer: parallaxes most, sits quietest. */}
        <g data-layer data-depth="1.8" opacity="0.55">
          {visibleEdges
            .filter((edge) => !edge.trunk)
            .map((edge) => (
              <path
                key={edge.id}
                data-edge={edge.id}
                data-trunk="false"
                d={edgePath(edge)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0"
                // Set from the real path length on entrance; this is only the
                // pre-hydration state so nothing flashes fully drawn.
                style={{ strokeDasharray: 2000, strokeDashoffset: 2000 }}
              />
            ))}
        </g>

        {/* Near layer: the trunk routes and the nodes that matter. */}
        <g data-layer data-depth="1" >
          {visibleEdges
            .filter((edge) => edge.trunk)
            .map((edge) => (
              <path
                key={edge.id}
                data-edge={edge.id}
                data-trunk="true"
                d={edgePath(edge)}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                opacity="0"
                style={{ strokeDasharray: 2000, strokeDashoffset: 2000 }}
              />
            ))}

          {visibleNodes.map((node) => (
            <g key={node.id}>
              {/* The expanding ring, at rest until a timeline uses it. */}
              <circle
                data-halo={node.id}
                cx={node.x}
                cy={node.y}
                r={node.r * 2}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.75"
                opacity="0"
              />
              <circle
                data-node={node.id}
                cx={node.x}
                cy={node.y}
                r={node.r}
                fill="currentColor"
                opacity="0"
              />
            </g>
          ))}
        </g>

        {/* Travelling signals. Positioned by MotionPath, not by layout. */}
        <g data-layer data-depth="0.6">
          {Array.from({ length: SIGNAL_POOL }, (_, index) => (
            <circle
              key={index}
              data-signal
              data-busy="false"
              r="3"
              fill="currentColor"
              opacity="0"
            />
          ))}
        </g>

        {/* The waveform strip, low in the frame. It answers to typing as one
            group, so a burst costs a single tween rather than one per bar. */}
        <g
          data-wave
          data-layer
          data-depth="1.3"
          transform={`translate(0 ${VIEWBOX.height - 46})`}
          opacity="0.35"
        >
          {Array.from({ length: WAVE_BARS }, (_, index) => {
            // Rounded before it reaches an attribute. Server and client format
            // long floats differently — "14.91060462359573" against
            // "14.910604623595729" — which React reports as a hydration
            // mismatch even though the geometry is identical.
            const round = (value: number) => Math.round(value * 100) / 100;
            const x = round(60 + index * ((VIEWBOX.width - 120) / (WAVE_BARS - 1)));
            // A fixed, hand-shaped profile: taller toward the middle, with an
            // irregular step so it does not read as a sine wave.
            const envelope = Math.sin((index / (WAVE_BARS - 1)) * Math.PI);
            const jitter = ((index * 37) % 11) / 11;
            const height = round(4 + envelope * 20 * (0.45 + jitter * 0.55));

            return (
              <rect
                key={index}
                x={x}
                y={round(-height / 2)}
                width="1.75"
                height={height}
                rx="0.875"
                fill="currentColor"
              />
            );
          })}
        </g>
      </svg>
    );
  }
);
