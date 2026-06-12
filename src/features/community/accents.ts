/**
 * Profile cover accents — a small preset palette (never free hex input, so a
 * profile can't paint anything unreadable or off-brand). The chosen id is
 * stored on `profiles.accent_color` and painted as a subtle gradient band on
 * the profile header for everyone who visits.
 */

export interface ProfileAccent {
  id: string;
  name: string;
  /** Gradient endpoints (hex, no alpha — alpha is applied per surface). */
  from: string;
  to: string;
}

export const PROFILE_ACCENTS: readonly ProfileAccent[] = [
  { id: "ocean", name: "Ocean", from: "#0284c7", to: "#6366f1" },
  { id: "ember", name: "Ember", from: "#ea580c", to: "#dc2626" },
  { id: "forest", name: "Forest", from: "#059669", to: "#65a30d" },
  { id: "violet", name: "Violet", from: "#7c3aed", to: "#c026d3" },
  { id: "gold", name: "Gold", from: "#d97706", to: "#ca8a04" },
  { id: "rose", name: "Rose", from: "#db2777", to: "#e11d48" },
];

export function isAccentId(id: string): boolean {
  return PROFILE_ACCENTS.some((a) => a.id === id);
}

export function accentById(id: string | null | undefined): ProfileAccent | null {
  if (!id) return null;
  return PROFILE_ACCENTS.find((a) => a.id === id) ?? null;
}

/** Clamps to 0..1 and renders as a 2-digit hex alpha suffix ("59" = 35%). */
function hexAlpha(alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  return Math.round(a * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * Subtle cover band gradient — low alpha so the band reads as a tint in both
 * light and dark themes instead of a solid block of colour.
 */
export function coverGradient(accent: ProfileAccent, alpha = 0.35): string {
  const a = hexAlpha(alpha);
  return `linear-gradient(120deg, ${accent.from}${a}, ${accent.to}${a})`;
}

/** Full-strength gradient for the picker swatches (small dots — needs punch). */
export function swatchGradient(accent: ProfileAccent): string {
  return `linear-gradient(135deg, ${accent.from}, ${accent.to})`;
}
