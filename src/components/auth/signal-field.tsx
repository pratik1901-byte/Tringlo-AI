"use client";

// ============================================================
// Tringlo AI — Signal Field
// ============================================================
//
// The brand visual on the sign-in screen: a voice travelling down a line.
//
// The idea is a conversation rendered as signal. Two speakers alternate, so the
// band swells on one side and settles on the other, the way a real exchange
// does — it is a picture of turn-taking rather than a generic audio widget.
// Nothing here is a phone, a robot, or a blob.
//
// Drawn on a canvas because this is sixty low-opacity strokes a second, which
// is work the compositor should not be asked to do as DOM nodes. The motion is
// slow and shallow on purpose: it should read as breathing at the edge of
// attention, not as something demanding to be watched.
// ============================================================

import { useEffect, useRef } from "react";
import gsap from "gsap";

import { prefersReducedMotion } from "@/lib/animation";

/** Bars across the field. Enough to read as continuous, few enough to stay crisp. */
const BAR_COUNT = 72;

interface SignalFieldProps {
  /** Drawn in the current text colour at low alpha, so it inherits the theme. */
  className?: string;
}

export function SignalField({ className }: SignalFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = prefersReducedMotion();

    // Per-bar phase and rate, so the field never reads as one repeating wave.
    const bars = Array.from({ length: BAR_COUNT }, (_, index) => ({
      phase: (index / BAR_COUNT) * Math.PI * 4 + Math.random() * 0.6,
      rate: 0.6 + Math.random() * 0.5,
      weight: 0.35 + Math.random() * 0.65,
    }));

    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Capped so a 3x phone does not composite a needlessly large buffer.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (time: number) => {
      if (width === 0 || height === 0) return;

      context.clearRect(0, 0, width, height);

      const midY = height / 2;
      const gap = width / BAR_COUNT;
      const barWidth = Math.max(1.5, gap * 0.34);

      // Turn-taking: a slow travelling envelope hands emphasis from one end of
      // the line to the other, which is what makes this read as conversation.
      const turn = (Math.sin(time * 0.22) + 1) / 2;

      for (let index = 0; index < BAR_COUNT; index++) {
        const bar = bars[index];
        const position = index / (BAR_COUNT - 1);

        // Fade at both ends so the field dissolves rather than being cropped.
        const edge = Math.sin(position * Math.PI);

        // Which speaker currently holds the floor.
        const speaker = 1 - Math.abs(position - turn) * 1.5;
        const emphasis = Math.max(0.12, speaker);

        const wave = reduced
          ? 0.42
          : (Math.sin(time * bar.rate + bar.phase) + 1) / 2;

        const amplitude = height * 0.34 * edge * emphasis * (0.25 + wave * 0.75) * bar.weight;
        const barHeight = Math.max(2, amplitude);
        const x = index * gap + (gap - barWidth) / 2;

        context.globalAlpha = 0.1 + edge * emphasis * 0.42;
        context.fillStyle = "currentColor";

        // Rounded ends read as drawn rather than as a bar chart.
        context.beginPath();
        context.roundRect(x, midY - barHeight / 2, barWidth, barHeight, barWidth / 2);
        context.fill();
      }

      context.globalAlpha = 1;
    };

    // `currentColor` is not resolved by canvas, so the computed colour is read
    // from the element and re-read when the theme changes underneath it.
    const applyColour = () => {
      const colour = getComputedStyle(canvas).color;
      context.fillStyle = colour;
      return colour;
    };

    let colour = applyColour();
    const themeObserver = new MutationObserver(() => {
      colour = applyColour();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const render = () => {
      context.fillStyle = colour;
      draw(gsap.ticker.time);
    };

    // One static frame under reduced motion: the composition still reads, and
    // nothing moves for someone who asked for nothing to move.
    if (reduced) {
      render();
    } else {
      gsap.ticker.add(render);
    }

    return () => {
      gsap.ticker.remove(render);
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      // Decorative: it carries no information the form does not already give.
      aria-hidden="true"
    />
  );
}
