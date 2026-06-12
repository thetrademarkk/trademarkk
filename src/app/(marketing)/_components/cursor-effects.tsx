"use client";

import * as React from "react";

/**
 * Landing-only cursor treatment (Linear/Vercel-style): a soft radial
 * spotlight that follows the pointer across the hero (`[data-spotlight]`)
 * and a glow + border-shine that tracks it inside each `[data-glow]` card.
 *
 * One passive, rAF-throttled pointermove listener writes CSS custom props
 * (consumed by paint-only gradients in globals.css) — no React state, no
 * layout-affecting styles, nothing on the main thread between frames.
 * Pointer-fine devices only; reduced-motion and touch get nothing.
 */
export function CursorEffects() {
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const spotlights = Array.from(document.querySelectorAll<HTMLElement>("[data-spotlight]"));
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-glow]"));
    if (spotlights.length === 0 && cards.length === 0) return;

    let raf = 0;
    let px = 0;
    let py = 0;

    const apply = () => {
      raf = 0;
      for (const el of spotlights) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--sx", `${px - r.left}px`);
        el.style.setProperty("--sy", `${py - r.top}px`);
        // Fade the spotlight in only once a real pointer position exists.
        el.style.setProperty("--so", "1");
      }
      for (const el of cards) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--gx", `${px - r.left}px`);
        el.style.setProperty("--gy", `${py - r.top}px`);
      }
    };

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
