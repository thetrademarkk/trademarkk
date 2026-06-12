/**
 * Smooth theme switching: a 400ms crossfade via the View Transitions API
 * (Chrome/Edge/Safari 18+), with a CSS color-transition fallback elsewhere.
 */
export function withThemeTransition(apply: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === "function") {
    doc.startViewTransition(apply);
    return;
  }
  const root = document.documentElement;
  root.classList.add("theme-fade");
  apply();
  window.setTimeout(() => root.classList.remove("theme-fade"), 450);
}
