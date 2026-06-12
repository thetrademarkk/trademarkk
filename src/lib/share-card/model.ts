/**
 * Share-as-image cards — the data model.
 *
 * Everything stringly-rendered on the exported PNG is precomputed into a
 * ShareCardData by a feature-level builder (trade / report) so it can be
 * unit-tested in node; the canvas painter in render.ts only ever paints
 * these strings. Privacy contract: when a builder is called without ₹ P&L
 * opt-in, NO rupee amount may appear anywhere in the returned data — the
 * same opt-in rule as community trade cards.
 */

export type ShareCardTone = "profit" | "loss" | "warning" | "accent";

export interface ShareCardStat {
  label: string;
  value: string;
}

export interface ShareCardBadge {
  label: string;
  tone: ShareCardTone;
}

export interface ShareCardData {
  /** Headline: instrument name or report period label. */
  title: string;
  /** Small pills after the title (LONG / OPEN / WEEKLY REVIEW…). */
  badges: ShareCardBadge[];
  /** The big center line: ₹ P&L (opt-in), R multiple, win rate, WIN/LOSS… */
  hero: string;
  /** Machine-readable hero variant (pnl | r | result | open | winrate | quiet). */
  heroKind: string;
  heroTone: ShareCardTone;
  /** Detail line under the hero — only carries ₹ when P&L was opted in. */
  subline: string | null;
  /** Up to four label/value columns in the stats strip. */
  stats: ShareCardStat[];
  /** Single line above the footer (setup name, green/red days…). */
  footnote: string | null;
  /** Top-right context: trade date or report date range. */
  dateLabel: string;
  fileName: string;
}

/** "M&M 1450 CE" → "M-M-1450-CE" (safe for filenames on every OS). */
export function slugify(parts: (string | number | null | undefined)[]): string {
  return parts
    .filter((p) => p != null && p !== "")
    .join("-")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

/** "+1.5R" / "-0.55R" — paise-free R label, rounded to 2 decimals. */
export function rLabel(r: number): string {
  const rounded = Math.round(r * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${rounded}R`;
}
