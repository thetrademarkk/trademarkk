/**
 * Options-analytics aggregations: DTE-bucket performance and strategy-level
 * grouping. Pure functions over the user's own closed trades + leg rows; no
 * live/market data. Used by the analytics "Options" tab.
 */

import {
  classifyStrategy,
  daysToExpiry,
  dteBucketKey,
  DTE_BUCKETS,
  type DteBucket,
  type LegShape,
  type StrategyLabel,
} from "./payoff";

/** Minimum trades behind a bucket before it counts as signal, not noise. */
export const MIN_SAMPLE = 5;

/** The slice of a trade row the options aggregations need. */
export interface OptionTradeLike {
  id: string;
  segment: string;
  status: string;
  net_pnl: number;
  opened_at: string;
  expiry: string | null;
  strike: number | null;
  option_type: "CE" | "PE" | null;
  direction: "long" | "short";
  qty: number;
}

export interface DteBucketStat {
  bucket: DteBucket;
  trades: number;
  netPnl: number;
  winRate: number;
  /** Average net P&L per trade in the bucket. */
  avgPnl: number;
  /** True once the bucket clears MIN_SAMPLE; the UI suppresses the rest. */
  enough: boolean;
}

const winRateOf = (ts: { net_pnl: number }[]) =>
  ts.length === 0 ? 0 : ts.filter((t) => t.net_pnl > 0).length / ts.length;
const sumPnl = (ts: { net_pnl: number }[]) => ts.reduce((s, t) => s + t.net_pnl, 0);

/**
 * Win rate + net P&L by days-to-expiry bucket (0DTE / 1–2 / 3–7 / 8–30 / >30),
 * over closed OPT trades that carry an expiry. Reveals theta / expiry-day bias.
 * Returns one row per bucket that has any trades; `enough` gates n≥MIN_SAMPLE.
 */
export function dteBuckets(trades: OptionTradeLike[]): DteBucketStat[] {
  const groups = new Map<DteBucket, OptionTradeLike[]>();
  for (const t of trades) {
    if (t.segment !== "OPT" || t.status !== "closed") continue;
    const days = daysToExpiry(t.opened_at, t.expiry);
    if (days == null) continue;
    const key = dteBucketKey(days);
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }
  return DTE_BUCKETS.filter((b) => groups.has(b)).map((bucket) => {
    const ts = groups.get(bucket)!;
    return {
      bucket,
      trades: ts.length,
      netPnl: sumPnl(ts),
      winRate: winRateOf(ts),
      avgPnl: sumPnl(ts) / ts.length,
      enough: ts.length >= MIN_SAMPLE,
    };
  });
}

export interface StrategyGroupStat {
  label: StrategyLabel;
  trades: number;
  /** How many of those trades had more than one leg. */
  multiLeg: number;
  netPnl: number;
  winRate: number;
  avgPnl: number;
}

/**
 * Derive the leg shapes of a single trade. Multi-leg trades carry explicit
 * `trade_legs` rows; single-leg OPT trades live entirely in the trade row's
 * top-level strike/option_type/direction/qty fields (no leg row is stored).
 */
export function legShapesForTrade(
  trade: OptionTradeLike,
  legs: LegShape[] | undefined
): LegShape[] {
  if (legs && legs.length > 0) return legs.filter((l) => Number.isFinite(l.strike) && l.qty > 0);
  if (trade.strike != null && trade.option_type != null) {
    return [
      {
        strike: trade.strike,
        optionType: trade.option_type,
        direction: trade.direction,
        qty: trade.qty,
      },
    ];
  }
  return [];
}

/**
 * Collapse every closed OPT trade into a named strategy and aggregate
 * performance per structure. `legsByTrade` maps trade id → its leg rows (for
 * multi-leg trades); single-leg trades fall back to the trade's own fields.
 * Rows are sorted by net P&L descending so winners surface first.
 */
export function strategyGroups(
  trades: OptionTradeLike[],
  legsByTrade: Map<string, LegShape[]>
): StrategyGroupStat[] {
  const groups = new Map<StrategyLabel, { trades: OptionTradeLike[]; multiLeg: number }>();
  for (const t of trades) {
    if (t.segment !== "OPT" || t.status !== "closed") continue;
    const shapes = legShapesForTrade(t, legsByTrade.get(t.id));
    if (shapes.length === 0) continue;
    const label = classifyStrategy(shapes);
    const g = groups.get(label) ?? { trades: [], multiLeg: 0 };
    g.trades.push(t);
    if (shapes.length > 1) g.multiLeg += 1;
    groups.set(label, g);
  }
  return [...groups.entries()]
    .map(([label, g]) => ({
      label,
      trades: g.trades.length,
      multiLeg: g.multiLeg,
      netPnl: sumPnl(g.trades),
      winRate: winRateOf(g.trades),
      avgPnl: sumPnl(g.trades) / g.trades.length,
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}
