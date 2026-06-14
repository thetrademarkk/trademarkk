"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

export const useIsDesktop = () => useMediaQuery("(min-width: 768px)");

/**
 * True when the user has asked the OS to minimise motion. Recharts animations are
 * JS-driven (SVG <animate>), so the global `prefers-reduced-motion` CSS rule
 * can't reach them — chart components read this and pass `isAnimationActive={!reduced}`.
 */
export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
