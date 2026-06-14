/**
 * Preset catalogue types (BT-10). A "preset" is a founder-vetted, EDUCATIONAL
 * house strategy — a fully-formed, schema-valid {@link StrategyDef} plus the
 * discovery metadata the Explore grid needs (thesis, what it teaches, tags,
 * difficulty) and the real expiries it touches so the mandatory CoverageBadge
 * can show honest coverage from the committed manifest.
 *
 * IMPORTANT FRAMING: presets are EXAMPLES to learn the MECHANICS — never
 * recommended trades, signals to copy, or claims of profitability. All copy is
 * descriptive only. No preset asserts an edge.
 *
 * The StrategyDef inside each preset is the single source of truth: "Open in
 * builder" loads it verbatim into the BT-06 wizard (zero translation), and "Run"
 * feeds it to the same BT-05 worker / BT-04 engine the builder uses.
 */

import type { IndexSymbol } from "../shared/instruments";
import type { StrategyDef } from "../shared/strategy-def";

/** Coarse strategy families used for filtering + the card chip. */
export type PresetCategory =
  | "premium-selling"
  | "directional"
  | "hedged"
  | "volatility"
  | "income"
  | "calendar";

/** Free-form, filterable descriptive tags (kept short + lowercase). */
export type PresetTag = string;

/** Self-reported teaching difficulty — descriptive, not a risk rating. */
export type PresetDifficulty = "beginner" | "intermediate" | "advanced";

export interface PresetMeta {
  /** Stable id; used in the ?preset= deep link + persistence. URL-safe. */
  id: string;
  /** Card title (the strategy's common name). */
  title: string;
  /** One-line, descriptive thesis (NOT a recommendation). */
  thesis: string;
  /** Index this educational example is built on. */
  index: IndexSymbol;
  /** Coarse category for the filter + chip. */
  category: PresetCategory;
  /** Descriptive filterable tags. */
  tags: PresetTag[];
  /** "What this teaches" — the educational payload, 1-2 sentences. */
  teaches: string;
  /** Suggested period label for the card (e.g. "Q1 2025, weekly expiries"). */
  periodLabel: string;
  /** Self-reported difficulty (descriptive). */
  difficulty: PresetDifficulty;
  /** Optional extra notes (caveats, what to watch). Descriptive only. */
  notes?: string;
  /**
   * The real expiry dates (YYYY-MM-DD) this preset's period touches, used ONLY
   * to compute honest coverage from the manifest. Empty => fall back to the
   * per-symbol rollup. NEVER cherry-picked to flatter coverage.
   */
  coverageExpiries: string[];
}

/** A catalogue entry: discovery metadata + the runnable, schema-valid strategy. */
export interface Preset {
  meta: PresetMeta;
  /** A fresh, validated StrategyDef (factory so ids/dates are not shared by ref). */
  build: () => StrategyDef;
}
