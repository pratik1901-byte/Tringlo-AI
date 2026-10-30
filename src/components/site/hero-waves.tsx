"use client";

// A field of hairline wave lines behind the hero, drawn with Three.js.
//
// It is the one place WebGL earns its cost: a few thousand vertices moving as
// one continuous surface read as "signal" in a way a flat SVG cannot, and it
// stays quiet enough to sit behind type. It renders only while visible and
// while the tab is in front, caps the pixel ratio, and never runs for
// visitors who prefer reduced motion or whose browser lacks WebGL — the hero
// is complete without it.

import { useEffect, useRef } from "react";

export default function HeroWaves() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let cleanup: (() => void) | null = null;

    void import("three").then((THREE) => {
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        return; // No WebGL: the hero stands on its own.
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.domElement.setAttribute("aria-hidden", "true");
      renderer.domElement.style.display = "block";
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 5.2, 11);
      camera.lookAt(0, 0, -1);

      const LINES = 34;
      const POINTS = 140;
      const WIDTH = 26;
      const DEPTH = 16;

      const ink = new THREE.LineBasicMaterial({ color: 0x171614, transparent: true, opacity: 0.13 });
      const iris = new THREE.LineBasicMaterial({ color: 0x5c69f8, transparent: true, opacity: 0.55 });

      const lines: Array<{ geometry: import("three").BufferGeometry; z: number }> = [];
      for (let row = 0; row < LINES; row++) {
        const positions = new Float32Array(POINTS * 3);
        const z = -DEPTH / 2 + (row / (LINES - 1)) * DEPTH;
        for (let i = 0; i < POINTS; i++) {
          positions[i * 3] = -WIDTH / 2 + (i / (POINTS - 1)) * WIDTH;
          positions[i * 3 + 2] = z;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        // One line in the accent colour: the call being carried.
        scene.add(new THREE.Line(geometry, row === Math.floor(LINES * 0.62) ? iris : ink));
        lines.push({ geometry, z });
      }

      const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (width === 0 || height === 0) return;
        renderer.setSize(width, height, false);
        renderer.domElement.style.width = `${width}px`;
        renderer.domElement.style.height = `${height}px`;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      let visible = true;
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
      });
      io.observe(host);

      let frame = 0;
      let running = false;
      const clock = new THREE.Clock();

      const draw = () => {
        const t = clock.getElapsedTime() * 0.55;
        for (const { geometry, z } of lines) {
          const attribute = geometry.getAttribute("position") as import("three").BufferAttribute;
          const array = attribute.array as Float32Array;
          for (let i = 0; i < POINTS; i++) {
            const x = array[i * 3];
            // Two travelling waves and a slow swell from the centre.
            const r = Math.sqrt(x * x + z * z);
            array[i * 3 + 1] =
              Math.sin(x * 0.42 + t * 1.1 + z * 0.18) * 0.34 +
              Math.sin(z * 0.55 - t * 0.8) * 0.22 +
              Math.sin(r * 0.6 - t * 1.6) * 0.18 * Math.exp(-r * 0.08);
          }
          attribute.needsUpdate = true;
        }
        renderer.render(scene, camera);
      };

      const loop = () => {
        if (!visible || document.hidden || disposed) {
          running = false;
          return;
        }
        draw();
        frame = requestAnimationFrame(loop);
      };
      function start() {
        if (running || disposed) return;
        running = true;
        frame = requestAnimationFrame(loop);
      }
      const onVisibility = () => {
        if (!document.hidden) start();
      };
      document.addEventListener("visibilitychange", onVisibility);
      start();

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        io.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        lines.forEach(({ geometry }) => geometry.dispose());
        ink.dispose();
        iris.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={hostRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />;
}
