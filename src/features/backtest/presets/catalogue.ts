/**
 * The founder-vetted PRESET CATALOGUE (BT-10) — ~12 EDUCATIONAL house
 * strategies spanning the three indices and the main strategy families
 * (premium-selling, directional, hedged, volatility, calendar). Each is a
 * fully-formed, schema-valid {@link StrategyDef} the BT-06 builder can hydrate
 * verbatim and the BT-04 engine can run.
 *
 * HARD RULES (load-bearing):
 *  - EDUCATIONAL EXAMPLES, never recommendations / signals / "good trades".
 *  - NO profitability claims anywhere — copy is descriptive only.
 *  - Every preset's StrategyDef MUST validate against the BT-02 zod schema
 *    (enforced by parseStrategyDef here + a unit test over the whole catalogue).
 *  - `coverageExpiries` are CONTIGUOUS real windows (whole quarters), never
 *    cherry-picked to flatter the CoverageBadge.
 *
 * The `build()` factory returns a FRESH object each call (unique leg ids, fresh
 * meta) so two consumers never mutate a shared reference.
 */

import { INDEX_META, type IndexSymbol } from "../shared/instruments";
import {
  parseStrategyDef,
  type ExecutionConfig,
  type LegDef,
  type OverallRisk,
  type StrategyDef,
  type TimingConfig,
} from "../shared/strategy-def";
import type { Preset, PresetCategory, PresetMeta } from "./types";

// ── Real, contiguous expiry windows from the committed manifest ──────────────
// (Whole quarters / halves — NOT the single best-covered expiries.)

/** NIFTY weeklies, Jul–Sep 2024. INCLUDES 2024-07-25 (the committed golden slice). */
const NIFTY_H2_2024 = [
  "2024-07-04",
  "2024-07-11",
  "2024-07-18",
  "2024-07-25",
  "2024-08-01",
  "2024-08-08",
  "2024-08-14",
  "2024-08-22",
  "2024-08-29",
  "2024-09-05",
  "2024-09-12",
  "2024-09-19",
  "2024-09-26",
];

/** NIFTY weeklies, Q1 2025. */
const NIFTY_Q1_2025 = [
  "2025-01-02",
  "2025-01-09",
  "2025-01-16",
  "2025-01-23",
  "2025-01-30",
  "2025-02-06",
  "2025-02-13",
  "2025-02-20",
  "2025-02-27",
  "2025-03-06",
  "2025-03-13",
  "2025-03-20",
  "2025-03-27",
];

/** BANKNIFTY monthlies, H2 2024 (weeklies were discontinued from Nov 2024). */
const BANKNIFTY_H2_2024 = [
  "2024-07-31",
  "2024-08-28",
  "2024-09-25",
  "2024-10-30",
  "2024-11-27",
  "2024-12-24",
];

/** SENSEX weeklies, Q1 2025 (SENSEX = worst coverage, surfaced honestly). */
const SENSEX_Q1_2025 = [
  "2025-01-03",
  "2025-01-07",
  "2025-01-14",
  "2025-01-21",
  "2025-01-28",
  "2025-02-04",
  "2025-02-11",
  "2025-02-18",
  "2025-02-25",
  "2025-03-04",
  "2025-03-11",
  "2025-03-18",
  "2025-03-25",
];

/** Span (start/end) of an expiry window for a StrategyDef date range. */
function spanOf(expiries: string[]): { start: string; end: string } {
  const sorted = [...expiries].sort();
  return { start: sorted[0]!, end: sorted[sorted.length - 1]! };
}

// ── Leg / config builders ────────────────────────────────────────────────────

let legCounter = 0;
function legId(): string {
  legCounter += 1;
  return `preset-leg-${legCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

function leg(
  optionType: LegDef["optionType"],
  side: LegDef["side"],
  strike: LegDef["strike"],
  extra: Partial<LegDef> = {}
): LegDef {
  return {
    id: legId(),
    enabled: true,
    optionType,
    side,
    lots: 1,
    strike,
    expiry: "WEEKLY",
    squareOff: "partial",
    ...extra,
  };
}

const atm = (steps: number): LegDef["strike"] => ({ mode: "ATM_OFFSET", steps });

const DEFAULT_TIMING: TimingConfig = {
  mode: "fixed_time",
  entryTime: "09:20",
  exitTime: "15:15",
};

const DEFAULT_EXEC: ExecutionConfig = {
  broker: "zerodha",
  product: "MIS",
  slippage: { unit: "pct", value: 0.5 },
  fillModel: "candle_close",
  applyChargesIntraday: false,
  seed: 0xc0ffee,
};

const NO_RISK: OverallRisk = { reEntryOnOverall: false };

/** Assemble + VALIDATE a StrategyDef (parse throws if a preset ever drifts off-schema). */
function strategy(
  meta: PresetMeta,
  legs: LegDef[],
  opts: {
    timing?: TimingConfig;
    risk?: OverallRisk;
    execution?: Partial<ExecutionConfig>;
  } = {}
): StrategyDef {
  const range = spanOf(meta.coverageExpiries);
  const now = new Date().toISOString();
  const def: StrategyDef = {
    schemaVersion: 1,
    id: `preset-${meta.id}-${Math.random().toString(36).slice(2, 8)}`,
    name: meta.title,
    notes: `Educational example — ${meta.thesis} Not a trade recommendation.`,
    tags: meta.tags,
    market: { symbol: meta.index, interval: "1m", dateRange: range },
    legs,
    timing: opts.timing ?? DEFAULT_TIMING,
    risk: opts.risk ?? NO_RISK,
    execution: { ...DEFAULT_EXEC, ...opts.execution },
    meta: { createdAt: now, updatedAt: now, templateId: meta.id, builderMode: "wizard" },
  };
  return parseStrategyDef(def); // validates against the BT-02 schema
}

// ── The catalogue (~12 founder-vetted educational examples) ──────────────────

interface Spec {
  meta: PresetMeta;
  legs: () => LegDef[];
  opts?: Parameters<typeof strategy>[2];
}

const SPECS: Spec[] = [
  // 1 — Short straddle (premium-selling, NIFTY, RUNNABLE on golden window)
  {
    meta: {
      id: "nifty-short-straddle",
      title: "NIFTY ATM Short Straddle",
      thesis: "Sell the ATM call and put and let theta decay work if NIFTY stays range-bound.",
      index: "NIFTY",
      category: "premium-selling",
      tags: ["premium-selling", "neutral", "theta", "intraday"],
      teaches:
        "How a delta-neutral premium-selling position behaves intraday — credit collected vs the cost of a trending day.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "beginner",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [leg("CE", "sell", atm(0)), leg("PE", "sell", atm(0))],
  },
  // 2 — Short strangle (premium-selling, NIFTY, RUNNABLE)
  {
    meta: {
      id: "nifty-short-strangle",
      title: "NIFTY Short Strangle",
      thesis: "Sell an OTM call and put for wider breakevens at the cost of a smaller credit.",
      index: "NIFTY",
      category: "premium-selling",
      tags: ["premium-selling", "neutral", "theta"],
      teaches:
        "The trade-off between credit size and breakeven width versus a straddle, and how OTM strikes change the risk shape.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "beginner",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [leg("CE", "sell", atm(2)), leg("PE", "sell", atm(-2))],
  },
  // 3 — Iron condor (hedged, NIFTY, RUNNABLE)
  {
    meta: {
      id: "nifty-iron-condor",
      title: "NIFTY Iron Condor",
      thesis: "Sell an OTM strangle and buy further wings so the maximum loss is capped.",
      index: "NIFTY",
      category: "hedged",
      tags: ["hedged", "neutral", "defined-risk", "premium-selling"],
      teaches:
        "How buying protective wings converts an unlimited-risk strangle into a defined-risk position, and what that costs in credit.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "intermediate",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [
      leg("CE", "sell", atm(2)),
      leg("CE", "buy", atm(4)),
      leg("PE", "sell", atm(-2)),
      leg("PE", "buy", atm(-4)),
    ],
  },
  // 4 — Iron fly (hedged, NIFTY, RUNNABLE)
  {
    meta: {
      id: "nifty-iron-fly",
      title: "NIFTY Iron Fly",
      thesis:
        "Sell an ATM straddle and buy wings — a higher-credit, narrower-range defined-risk play.",
      index: "NIFTY",
      category: "hedged",
      tags: ["hedged", "neutral", "defined-risk"],
      teaches:
        "How an iron fly differs from an iron condor: bigger credit, tighter profit zone, and the same capped tails.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "intermediate",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [
      leg("CE", "sell", atm(0)),
      leg("CE", "buy", atm(3)),
      leg("PE", "sell", atm(0)),
      leg("PE", "buy", atm(-3)),
    ],
  },
  // 5 — Bull call (debit) spread (directional, NIFTY, RUNNABLE)
  {
    meta: {
      id: "nifty-bull-call-spread",
      title: "NIFTY Bull Call Spread",
      thesis: "Buy a near call and sell a higher call for a defined-risk bullish exposure.",
      index: "NIFTY",
      category: "directional",
      tags: ["directional", "bullish", "defined-risk", "debit"],
      teaches:
        "How a debit spread caps both cost and reward versus a naked long call, and how the short leg pays for part of the long.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "beginner",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [leg("CE", "buy", atm(0)), leg("CE", "sell", atm(3))],
  },
  // 6 — Bear put (debit) spread (directional, NIFTY, RUNNABLE)
  {
    meta: {
      id: "nifty-bear-put-spread",
      title: "NIFTY Bear Put Spread",
      thesis: "Buy a near put and sell a lower put for a defined-risk bearish exposure.",
      index: "NIFTY",
      category: "directional",
      tags: ["directional", "bearish", "defined-risk", "debit"],
      teaches:
        "The mirror image of a bull call spread on the downside — how a debit put spread defines risk and reward.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "beginner",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [leg("PE", "buy", atm(0)), leg("PE", "sell", atm(-3))],
  },
  // 7 — Long straddle (volatility, NIFTY, RUNNABLE)
  {
    meta: {
      id: "nifty-long-straddle",
      title: "NIFTY Long Straddle",
      thesis: "Buy the ATM call and put to express a view that a large move is coming either way.",
      index: "NIFTY",
      category: "volatility",
      tags: ["volatility", "long-options", "non-directional", "debit"],
      teaches:
        "The cost of being long volatility intraday — how theta decay erodes a long straddle when the expected move does not arrive.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "beginner",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [leg("CE", "buy", atm(0)), leg("PE", "buy", atm(0))],
  },
  // 8 — Simple long call (directional, NIFTY, RUNNABLE) — with a stop to teach risk
  {
    meta: {
      id: "nifty-long-call",
      title: "NIFTY Long Call",
      thesis: "Buy a single ATM call as the simplest directional, defined-cost bullish position.",
      index: "NIFTY",
      category: "directional",
      tags: ["directional", "bullish", "long-options", "beginner"],
      teaches:
        "The most basic options building block — premium paid is the maximum loss, and a stop-loss on premium limits it further.",
      periodLabel: "Jul–Sep 2024 · weekly expiries",
      difficulty: "beginner",
      notes: "Includes a 50% premium stop-loss to show how per-leg risk rules attach.",
      coverageExpiries: NIFTY_H2_2024,
    },
    legs: () => [
      leg("CE", "buy", atm(0), {
        stopLoss: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" },
      }),
    ],
  },
  // 9 — Short straddle with stop + target (income, NIFTY Q1'25, RUNNABLE-when-data)
  {
    meta: {
      id: "nifty-managed-straddle",
      title: "NIFTY Managed Short Straddle",
      thesis:
        "An ATM short straddle with a stop-loss and target to show active intraday management.",
      index: "NIFTY",
      category: "income",
      tags: ["premium-selling", "neutral", "risk-managed", "theta"],
      teaches:
        "How adding a strategy-level stop-loss and profit target changes the distribution of outcomes versus an unmanaged straddle.",
      periodLabel: "Q1 2025 · weekly expiries",
      difficulty: "intermediate",
      notes: "Strategy-level SL 30% / target 60% of collected premium on net MTM.",
      coverageExpiries: NIFTY_Q1_2025,
    },
    legs: () => [leg("CE", "sell", atm(0)), leg("PE", "sell", atm(0))],
    opts: {
      risk: {
        reEntryOnOverall: false,
        stopLoss: { unit: "pct", value: 30 },
        target: { unit: "pct", value: 60 },
      },
    },
  },
  // 10 — BANKNIFTY short strangle (premium-selling, LOCKED — no local data)
  {
    meta: {
      id: "banknifty-short-strangle",
      title: "BANK NIFTY Short Strangle",
      thesis: "Sell an OTM call and put on a higher-volatility index with wider strike spacing.",
      index: "BANKNIFTY",
      category: "premium-selling",
      tags: ["premium-selling", "neutral", "high-vol", "theta"],
      teaches:
        "How a more volatile index with ₹100 strike steps and a 35-lot size changes credit, breakevens and per-trade exposure.",
      periodLabel: "H2 2024 · monthly expiries",
      difficulty: "intermediate",
      coverageExpiries: BANKNIFTY_H2_2024,
    },
    legs: () => [leg("CE", "sell", atm(2)), leg("PE", "sell", atm(-2))],
  },
  // 11 — BANKNIFTY bull call spread (directional, LOCKED — no local data)
  {
    meta: {
      id: "banknifty-bull-call-spread",
      title: "BANK NIFTY Bull Call Spread",
      thesis: "A defined-risk bullish call spread on BANK NIFTY's wider strike grid.",
      index: "BANKNIFTY",
      category: "directional",
      tags: ["directional", "bullish", "defined-risk", "debit"],
      teaches:
        "How the same debit-spread structure scales onto a higher-priced, more volatile index.",
      periodLabel: "H2 2024 · monthly expiries",
      difficulty: "intermediate",
      coverageExpiries: BANKNIFTY_H2_2024,
    },
    legs: () => [leg("CE", "buy", atm(0)), leg("CE", "sell", atm(2))],
  },
  // 12 — SENSEX iron condor (hedged, LOCKED — worst coverage, honesty showcase)
  {
    meta: {
      id: "sensex-iron-condor",
      title: "SENSEX Iron Condor",
      thesis:
        "A defined-risk neutral condor on SENSEX, the index with the patchiest option history.",
      index: "SENSEX",
      category: "hedged",
      tags: ["hedged", "neutral", "defined-risk", "low-coverage"],
      teaches:
        "Why the coverage layer matters most on SENSEX — large gaps mean any backtest here is the most partial of the three indices.",
      periodLabel: "Q1 2025 · weekly expiries",
      difficulty: "advanced",
      notes: "SENSEX has the lowest option-data coverage — read the CoverageBadge carefully.",
      coverageExpiries: SENSEX_Q1_2025,
    },
    legs: () => [
      leg("CE", "sell", atm(2)),
      leg("CE", "buy", atm(4)),
      leg("PE", "sell", atm(-2)),
      leg("PE", "buy", atm(-4)),
    ],
  },
];

/** The full catalogue — frozen metadata + a fresh-StrategyDef factory each. */
export const PRESETS: Preset[] = SPECS.map((spec) => ({
  meta: spec.meta,
  build: () => strategy(spec.meta, spec.legs(), spec.opts),
}));

/** O(1) lookup by id. */
export const PRESETS_BY_ID: Record<string, Preset> = Object.fromEntries(
  PRESETS.map((p) => [p.meta.id, p])
);

/** All distinct indices represented (display order from INDEX_META). */
export const PRESET_INDICES: IndexSymbol[] = (Object.keys(INDEX_META) as IndexSymbol[]).filter(
  (sym) => PRESETS.some((p) => p.meta.index === sym)
);

/** All distinct categories represented, in a stable display order. */
export const PRESET_CATEGORY_ORDER: PresetCategory[] = [
  "premium-selling",
  "directional",
  "hedged",
  "volatility",
  "income",
  "calendar",
];

export const PRESET_CATEGORY_LABEL: Record<PresetCategory, string> = {
  "premium-selling": "Premium selling",
  directional: "Directional",
  hedged: "Hedged",
  volatility: "Volatility",
  income: "Income",
  calendar: "Calendar",
};

export function presetById(id: string): Preset | undefined {
  return PRESETS_BY_ID[id];
}
