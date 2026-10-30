"use client";

// ============================================================
// Tringlo AI — Communication Network: Choreography
// ============================================================
//
// Every GSAP timeline the authentication scene uses, in one place.
//
// The component below this owns markup and React state; it owns none of the
// animation. That split is what keeps the scene maintainable: the entrance,
// the idle loop, the focus states and the outcome sequences can be read and
// tuned together, and the component is left with `scene.focusEmail()` rather
// than thirty lines of tweens inline.
//
// Two rules hold throughout:
//
//   - Only transform and opacity are animated on the DOM, plus stroke-dashoffset
//     for path drawing, which the compositor also handles cheaply.
//   - Every timeline is owned by a `gsap.context` and reverted on teardown, so
//     nothing survives unmount and nothing accumulates across hot reloads.
// ============================================================

import gsap from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";

import { INTAKE_NODES, SECURE_EDGES, TRUNK_ROUTES } from "./network-model";

let registered = false;

/** Registered once, lazily, because the plugin touches the DOM on import. */
function ensurePlugins() {
  if (registered || typeof window === "undefined") return;
  gsap.registerPlugin(MotionPathPlugin);
  registered = true;
}

export const SCENE_MOTION = {
  entrance: 1.15,
  fast: 0.28,
  base: 0.5,
  slow: 0.9,
  ease: "power2.out",
  easeInOut: "power2.inOut",
} as const;

/** Opacity the network rests at, by state. Kept here so the scale is visible. */
const REST = {
  edge: 0.16,
  trunkEdge: 0.26,
  node: 0.5,
  focusedEdge: 0.4,
  dimmedEdge: 0.05,
} as const;

export interface SceneOptions {
  root: HTMLElement;
  /** True when the visitor asked for reduced motion; the scene stays still. */
  reduced: boolean;
}

export interface AuthScene {
  /** Plays the construction sequence. Resolves when the scene is at rest. */
  enter: () => gsap.core.Timeline;
  /** Email focus: intake nodes wake and one signal runs the trunk. */
  focusEmail: () => void;
  /** Password focus: the network narrows to a closed circuit. */
  focusSecure: () => void;
  /** Returns to the idle state from any focus state. */
  releaseFocus: () => void;
  /** A short burst of activity, for typing. Safe to call often; it throttles. */
  pulse: () => void;
  /** Signals converging on the centre, then the panel handing off. */
  success: (onComplete: () => void) => void;
  /** An interrupted signal and a settle on the panel. */
  failure: (panel: HTMLElement | null) => void;
  /** Cross-fades the panel's contents when the mode changes. */
  switchChannel: (panel: HTMLElement | null) => void;
  /** Pointer parallax, in viewBox units. Call with normalised -1..1 values. */
  parallax: (x: number, y: number) => void;
  /** Stops everything and reverts. */
  destroy: () => void;
}

const q = (root: HTMLElement, selector: string) =>
  gsap.utils.toArray<SVGElement>(root.querySelectorAll(selector));

/**
 * Builds the scene controller.
 *
 * Nothing runs until `enter()` is called, so the caller decides when the page
 * is ready to animate.
 */
export function createAuthScene({ root, reduced }: SceneOptions): AuthScene {
  ensurePlugins();

  const context = gsap.context(() => {}, root);
  let idle: gsap.core.Timeline | null = null;
  let lastPulse = 0;

  const edges = () => q(root, "[data-edge]");
  const nodes = () => q(root, "[data-node]");
  const layers = () => q(root, "[data-layer]");

  const edgeRest = (element: SVGElement) =>
    element.dataset.trunk === "true" ? REST.trunkEdge : REST.edge;

  // ----------------------------------------------------------------
  // Signals
  // ----------------------------------------------------------------

  /**
   * Sends one dot along an edge.
   *
   * The travelling element is a pooled circle already in the DOM; creating and
   * destroying nodes per signal is what makes this kind of scene stutter.
   */
  function sendSignal(edgeId: string, options: { delay?: number; duration?: number } = {}) {
    if (reduced) return;

    const path = root.querySelector<SVGPathElement>(`[data-edge="${edgeId}"]`);
    const signal = root.querySelector<SVGCircleElement>("[data-signal]:not([data-busy='true'])");
    if (!path || !signal) return;

    signal.dataset.busy = "true";

    context.add(() => {
      gsap
        .timeline({
          delay: options.delay ?? 0,
          onComplete: () => {
            signal.dataset.busy = "false";
            gsap.set(signal, { opacity: 0 });
          },
        })
        .set(signal, { opacity: 0, scale: 0.6, transformOrigin: "center" })
        .to(signal, { opacity: 0.9, scale: 1, duration: 0.18, ease: SCENE_MOTION.ease }, 0)
        .to(
          signal,
          {
            duration: options.duration ?? 1.4,
            ease: "none",
            motionPath: { path, align: path, alignOrigin: [0.5, 0.5] },
          },
          0
        )
        .to(signal, { opacity: 0, duration: 0.22, ease: SCENE_MOTION.easeInOut }, ">-0.22");
    });
  }

  /** Runs a signal down a whole route, one edge after another. */
  function sendRoute(route: string[], stagger = 0.55) {
    route.forEach((edgeId, index) => {
      sendSignal(edgeId, { delay: index * stagger, duration: 0.9 });
    });
  }

  /** A ring expanding from one node, used sparingly to mark activity. */
  function ring(nodeId: string, delay = 0) {
    if (reduced) return;
    const halo = root.querySelector<SVGCircleElement>(`[data-halo="${nodeId}"]`);
    if (!halo) return;

    context.add(() => {
      gsap.fromTo(
        halo,
        { scale: 0.7, opacity: 0.45, transformOrigin: "center" },
        {
          scale: 2.6,
          opacity: 0,
          duration: 1.6,
          delay,
          ease: "power2.out",
        }
      );
    });
  }

  // ----------------------------------------------------------------
  // Entrance
  // ----------------------------------------------------------------

  function enter(): gsap.core.Timeline {
    const timeline = gsap.timeline();

    context.add(() => {
      if (reduced) {
        // The composition still resolves, it simply does not perform.
        gsap.set(edges(), {
          strokeDasharray: "none",
          strokeDashoffset: 0,
          opacity: (i, target) => edgeRest(target as SVGElement),
        });
        gsap.set(nodes(), { opacity: REST.node, scale: 1, transformOrigin: "center" });
        return;
      }

      timeline
        .set(edges(), {
          // Measured per path: one shared dash length would make short edges
          // snap and long ones never finish drawing.
          strokeDasharray: (i, target) => (target as SVGPathElement).getTotalLength(),
          strokeDashoffset: (i, target) => (target as SVGPathElement).getTotalLength(),
        })
        .set(nodes(), { opacity: 0, scale: 0.4, transformOrigin: "center" })

        // 1–2. The routes draw themselves, trunks leading.
        .to(
          edges(),
          {
            strokeDashoffset: 0,
            opacity: (i, target) => edgeRest(target as SVGElement),
            duration: SCENE_MOTION.entrance,
            ease: "power2.inOut",
            stagger: { each: 0.045, from: "start" },
          },
          0
        )

        // 3. Nodes activate along the routes rather than all at once.
        .to(
          nodes(),
          {
            opacity: REST.node,
            scale: 1,
            duration: SCENE_MOTION.base,
            ease: "back.out(1.6)",
            stagger: { each: 0.05, from: "edges" },
          },
          0.35
        );

      // 6. Settling into the idle state: one route carries traffic.
      timeline.call(() => {
        sendRoute(TRUNK_ROUTES[0], 0.4);
        ring("a2", 0.1);
      }, undefined, 0.9);
    });

    return timeline;
  }

  // ----------------------------------------------------------------
  // Idle
  // ----------------------------------------------------------------

  function startIdle() {
    if (reduced || idle) return;

    context.add(() => {
      // One long repeating timeline rather than many scattered intervals, so
      // the whole idle rhythm can be paused, scrubbed or killed as a unit.
      idle = gsap.timeline({ repeat: -1, defaults: { ease: SCENE_MOTION.easeInOut } });

      idle
        .call(() => sendRoute(TRUNK_ROUTES[0], 0.5))
        .to(edges(), { opacity: (i, t) => edgeRest(t as SVGElement) * 1.25, duration: 2.4 }, 0)
        .to(edges(), { opacity: (i, t) => edgeRest(t as SVGElement), duration: 2.6 }, 2.4)
        .call(() => ring("c1"), undefined, 3.2)
        .call(() => sendRoute(TRUNK_ROUTES[1], 0.5), undefined, 5)
        .call(() => ring("a3"), undefined, 7.5)
        .to({}, { duration: 9 });
    });
  }

  function stopIdle() {
    idle?.kill();
    idle = null;
  }

  // ----------------------------------------------------------------
  // Focus states
  // ----------------------------------------------------------------

  function focusEmail() {
    if (reduced) return;

    context.add(() => {
      gsap.to(edges(), {
        opacity: (i, t) => edgeRest(t as SVGElement) * 1.6,
        duration: SCENE_MOTION.base,
        ease: SCENE_MOTION.ease,
      });

      INTAKE_NODES.forEach((id, index) => {
        const node = root.querySelector(`[data-node="${id}"]`);
        if (node) {
          gsap.to(node, {
            opacity: 0.95,
            scale: 1.35,
            transformOrigin: "center",
            duration: SCENE_MOTION.base,
            delay: index * 0.07,
            ease: "back.out(2)",
          });
        }
        ring(id, index * 0.12);
      });

      sendRoute(TRUNK_ROUTES[0], 0.35);
    });
  }

  function focusSecure() {
    if (reduced) return;

    context.add(() => {
      // Everything that is not part of the circuit recedes. This is the whole
      // idea: the network stops broadcasting and holds a few lines.
      const secure = SECURE_EDGES.map((id) => root.querySelector(`[data-edge="${id}"]`)).filter(
        Boolean
      ) as Element[];

      gsap.to(edges(), {
        opacity: REST.dimmedEdge,
        duration: SCENE_MOTION.base,
        ease: SCENE_MOTION.easeInOut,
      });
      gsap.to(nodes(), {
        opacity: 0.22,
        scale: 0.9,
        transformOrigin: "center",
        duration: SCENE_MOTION.base,
        ease: SCENE_MOTION.easeInOut,
      });

      gsap.to(secure, {
        opacity: REST.focusedEdge,
        duration: SCENE_MOTION.base,
        ease: SCENE_MOTION.ease,
      });

      // A slow closed loop, so the state reads as held rather than frozen.
      SECURE_EDGES.forEach((id, index) => sendSignal(id, { delay: index * 0.5, duration: 1.2 }));
    });
  }

  function releaseFocus() {
    if (reduced) return;

    context.add(() => {
      gsap.to(edges(), {
        opacity: (i, t) => edgeRest(t as SVGElement),
        duration: SCENE_MOTION.base,
        ease: SCENE_MOTION.easeInOut,
      });
      gsap.to(nodes(), {
        opacity: REST.node,
        scale: 1,
        transformOrigin: "center",
        duration: SCENE_MOTION.base,
        ease: SCENE_MOTION.easeInOut,
      });
    });
  }

  // ----------------------------------------------------------------
  // Typing
  // ----------------------------------------------------------------

  /**
   * A short burst of activity.
   *
   * Throttled hard: a keystroke is not an animation, a burst of typing is.
   * Without this the scene would queue one timeline per character and fall
   * behind the typist, which is the opposite of feeling responsive.
   */
  function pulse() {
    if (reduced) return;

    const now = performance.now();
    if (now - lastPulse < 420) return;
    lastPulse = now;

    const route = TRUNK_ROUTES[Math.random() < 0.5 ? 0 : 1];
    sendSignal(route[Math.floor(Math.random() * route.length)], { duration: 0.85 });

    context.add(() => {
      // The waveform answers. One tween on one group, not per bar.
      const wave = root.querySelector("[data-wave]");
      if (!wave) return;
      gsap.fromTo(
        wave,
        { scaleY: 1 },
        {
          scaleY: 1.5,
          duration: 0.2,
          transformOrigin: "center",
          ease: SCENE_MOTION.ease,
          yoyo: true,
          repeat: 1,
        }
      );
    });
  }

  // ----------------------------------------------------------------
  // Outcomes
  // ----------------------------------------------------------------

  function success(onComplete: () => void) {
    stopIdle();

    if (reduced) {
      onComplete();
      return;
    }

    context.add(() => {
      const timeline = gsap.timeline({ onComplete });

      // Signals converge, the network brightens as one, then everything
      // clears to hand over to the application.
      timeline
        .call(() => {
          TRUNK_ROUTES.forEach((route) => sendRoute(route, 0.12));
          ring("a2");
          ring("c1", 0.1);
        })
        .to(
          edges(),
          {
            opacity: 0.55,
            duration: 0.5,
            ease: SCENE_MOTION.ease,
            stagger: { each: 0.015, from: "edges" },
          },
          0.15
        )
        .to(
          nodes(),
          { opacity: 1, scale: 1.25, transformOrigin: "center", duration: 0.4, ease: "back.out(2)" },
          0.2
        )
        .to(layers(), { opacity: 0, duration: 0.45, ease: SCENE_MOTION.easeInOut }, 0.7);
    });
  }

  function failure(panel: HTMLElement | null) {
    if (reduced) return;

    context.add(() => {
      const timeline = gsap.timeline();

      // The signal is interrupted: the network drops, catches, and recovers.
      timeline
        .to(edges(), { opacity: 0.04, duration: 0.12, ease: "power3.in" })
        .to(edges(), {
          opacity: (i, t) => edgeRest(t as SVGElement),
          duration: 0.7,
          ease: SCENE_MOTION.easeInOut,
        });

      if (panel) {
        // Short, controlled, and over quickly — a long shake reads as a toy.
        timeline.fromTo(
          panel,
          { x: -7 },
          { x: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" },
          0
        );
      }
    });
  }

  function switchChannel(panel: HTMLElement | null) {
    if (reduced || !panel) return;

    context.add(() => {
      const fields = panel.querySelectorAll("[data-field]");

      gsap
        .timeline()
        .fromTo(
          panel,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: SCENE_MOTION.base, ease: SCENE_MOTION.ease, clearProps: "transform" }
        )
        .fromTo(
          fields,
          { opacity: 0, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: SCENE_MOTION.base,
            ease: SCENE_MOTION.ease,
            stagger: 0.035,
            clearProps: "transform",
          },
          0.05
        );

      // Changing channel is a routing change, so the network reroutes too.
      sendRoute(TRUNK_ROUTES[1], 0.28);
    });
  }

  // ----------------------------------------------------------------
  // Pointer parallax
  // ----------------------------------------------------------------

  /**
   * Shifts the depth layers a few units against the pointer.
   *
   * Small on purpose, and quick-to'd rather than tweened fresh each move, so
   * it never becomes a cursor-follower. The panel is not a layer and does not
   * move at all.
   */
  const setters = new WeakMap<Element, { x: gsap.QuickToFunc; y: gsap.QuickToFunc }>();

  function parallax(x: number, y: number) {
    if (reduced) return;

    for (const layer of layers()) {
      const depth = Number((layer as SVGElement).dataset.depth ?? 1);
      let setter = setters.get(layer);
      if (!setter) {
        setter = {
          x: gsap.quickTo(layer, "x", { duration: 0.8, ease: "power3.out" }),
          y: gsap.quickTo(layer, "y", { duration: 0.8, ease: "power3.out" }),
        };
        setters.set(layer, setter);
      }
      setter.x(x * 14 * depth);
      setter.y(y * 10 * depth);
    }
  }

  // ----------------------------------------------------------------

  function destroy() {
    stopIdle();
    context.revert();
  }

  return {
    enter: () => {
      const timeline = enter();
      timeline.call(startIdle, undefined, reduced ? 0 : 1.6);
      return timeline;
    },
    focusEmail,
    focusSecure,
    releaseFocus,
    pulse,
    success,
    failure,
    switchChannel,
    parallax,
    destroy,
  };
}
