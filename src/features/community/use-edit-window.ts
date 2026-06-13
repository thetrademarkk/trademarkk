"use client";

import * as React from "react";
import { editMinutesLeft, isWithinEditWindow } from "./edit-window";

/**
 * Live edit-window state for owner UI: whether the author can still edit, and a
 * minute-granularity countdown ("editable for N min"). Ticks once a minute while
 * the window is open, then settles. Hydration-safe: the first render assumes
 * still-editable (mounted=false) so the server HTML and first client paint match,
 * and the real value resolves in an effect.
 */
export function useEditWindow(createdAt: string): { editable: boolean; minutesLeft: number } {
  const [mounted, setMounted] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    if (!isWithinEditWindow(createdAt)) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [createdAt]);

  if (!mounted) return { editable: true, minutesLeft: 0 };
  return {
    editable: isWithinEditWindow(createdAt, now),
    minutesLeft: editMinutesLeft(createdAt, now),
  };
}
