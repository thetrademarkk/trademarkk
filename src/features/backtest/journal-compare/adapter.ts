/**
 * BT-12 journal-compare — TRADE-SHAPE ADAPTER (pure).
 *
 * Maps a REAL journaled trade (the journal `TradeRow` shape, optionally with its
 * multi-leg `trade_legs` rows) into a single normalized `JournalTrade` the
 * comparison engine can reason about side-by-side with a backtest RunResult.
 *
 * This is READ-ONLY over the journal: it consumes the shape the existing query
 * layer already returns (`useTrades` / `useAllLegs`). It NEVER writes, and it
 * never duplicates the journal's P&L math — it trusts the journal's stored
 * `net_pnl` / `gross_pnl` / `charges` (already net-of-charges exactly as the
 * journal computes them) so the two sides are honestly comparable.
 *
 * Robust to ALL trader types, never FnO-only:
 *   - segment ∈ EQ | FUT | OPT | COMM | CDS  (the journal's widened v4 set)
 *   - product ∈ MIS | CNC | NRML | BTST | STBT | null (legacy → MIS)
 *   - single-leg trades (shape on the trade row) AND multi-leg strategies
 *     (straddles/spreads — qty totalled across legs)
 *
 * Money is in rupees with paise (2-dp) precision, carried through verbatim.
 */

/** Minimal journal-trade shape this module needs (a subset of TradeRow). */
export interface JournalTradeInput {
  id: string;
  symbol: string;
  segment: "EQ" | "FUT" | "OPT" | "COMM" | "CDS";
  product?: "MIS" | "CNC" | "NRML" | "BTST" | "STBT" | null;
  direction: "long" | "short";
  status: "open" | "closed";
  qty: number;
  avg_entry: number;
  avg_exit: number | null;
  opened_at: string;
  closed_at: string | null;
  gross_pnl: number;
  charges: number;
  net_pnl: number;
}

/** One multi-leg row (a subset of TradeLegRow) — qty is summed across legs. */
export interface JournalLegInput {
  trade_id: string;
  qty: number;
}

/** The three indices the backtester can model — the rest is "not comparable". */
export type CompareIndex = "NIFTY" | "BANKNIFTY" | "SENSEX";

/** Position horizon, derived from open→close spanning more than one IST day. */
export type Horizon = "intraday" | "swing";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** Calendar date (YYYY-MM-DD) of an ISO instant, in IST. */
export function istDayKey(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch-ms of an ISO instant, or null if unparseable. */
function epoch(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Resolve the backtestable index a journal trade maps to, or null when it does
 * not correspond to any modelled index (→ honest "no comparable backtest data").
 *
 * We match on the underlying in the `symbol`, tolerating the many shapes a
 * symbol can take across brokers/segments: a bare "NIFTY", a contract name like
 * "NIFTY 24500 CE", an exchange prefix ("NSE:BANKNIFTY"), "BANKNIFTY24JUN" etc.
 * BANKNIFTY is checked before NIFTY (it contains "NIFTY" as a substring).
 * SENSEX/BANKEX map to SENSEX (BSE index family). Plain stocks, commodities and
 * currencies have no index backtest → null.
 */
export function resolveCompareIndex(symbol: string): CompareIndex | null {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  // Distinct indices with no modelled backtest data → not comparable.
  if (s.includes("FINNIFTY") || s.includes("MIDCPNIFTY") || s.includes("NIFTYNXT")) {
    return null;
  }
  // Order matters: BANKNIFTY must win over NIFTY (it contains "NIFTY").
  if (s.includes("BANKNIFTY") || s.includes("NIFTYBANK")) return "BANKNIFTY";
  if (s.includes("NIFTY")) return "NIFTY";
  if (s.includes("SENSEX") || s.includes("BANKEX")) return "SENSEX";
  return null;
}

/** The normalized, segment-agnostic shape the comparison engine consumes. */
export interface JournalTrade {
  id: string;
  symbol: string;
  segment: JournalTradeInput["segment"];
  /** product, defaulting null (legacy) → MIS to mirror the journal's charge path. */
  product: NonNullable<JournalTradeInput["product"]>;
  side: "long" | "short";
  /** Total contracts/shares, summed across legs for multi-leg strategies. */
  qty: number;
  /** Entry instant (epoch-ms) and its IST day. */
  entryTs: number;
  entryDay: string;
  /** Exit instant (epoch-ms) and IST day — null while the leg is still open. */
  exitTs: number | null;
  exitDay: string | null;
  /** Minutes held (exit − entry), null when open or times are missing. */
  holdMinutes: number | null;
  /** intraday when opened & closed the same IST day; swing otherwise. */
  horizon: Horizon | null;
  /** Realized P&L exactly as the journal stored it (net of charges). */
  grossPnl: number;
  charges: number;
  netPnl: number;
  /** The backtestable index this trade maps to, or null (not comparable). */
  index: CompareIndex | null;
}

/**
 * Normalize ONE journal trade. `legs` (if present) are this trade's multi-leg
 * rows; the total qty is summed across them (a 2-leg straddle's "size" is both
 * legs). The realized P&L is taken verbatim from the journal row totals.
 */
export function normalizeJournalTrade(
  t: JournalTradeInput,
  legs: JournalLegInput[] = []
): JournalTrade {
  const entryTs = epoch(t.opened_at) ?? 0;
  const exitTs = epoch(t.closed_at);
  const entryDay = istDayKey(t.opened_at);
  const exitDay = t.closed_at ? istDayKey(t.closed_at) : null;

  const holdMinutes =
    exitTs !== null && entryTs > 0 ? Math.max(0, Math.round((exitTs - entryTs) / 60_000)) : null;

  const horizon: Horizon | null =
    exitDay === null ? null : exitDay === entryDay ? "intraday" : "swing";

  // Multi-leg size = Σ leg qty; single-leg size = the trade row qty.
  const legQty = legs.reduce((s, l) => s + (Number.isFinite(l.qty) ? l.qty : 0), 0);
  const qty = legs.length > 0 ? legQty : t.qty;

  return {
    id: t.id,
    symbol: t.symbol,
    segment: t.segment,
    product: t.product ?? "MIS",
    side: t.direction,
    qty,
    entryTs,
    entryDay,
    exitTs,
    exitDay,
    holdMinutes,
    horizon,
    grossPnl: t.gross_pnl,
    charges: t.charges,
    netPnl: t.net_pnl,
    index: resolveCompareIndex(t.symbol),
  };
}

/**
 * Normalize a whole set of journal trades. `legsByTrade` mirrors the journal's
 * `useAllLegs()` result (a Map of trade_id → leg rows). Open trades are kept
 * (the engine reports them as a low-sample / partial-overlap consideration but
 * never invents an exit); callers filter to `closed` when computing realized
 * comparisons.
 */
export function normalizeJournalTrades(
  trades: JournalTradeInput[],
  legsByTrade?: Map<string, JournalLegInput[]>
): JournalTrade[] {
  return trades.map((t) => normalizeJournalTrade(t, legsByTrade?.get(t.id) ?? []));
}

/** Closed, realized trades only — the comparable set. Sorted by exit instant. */
export function realizedTrades(trades: JournalTrade[]): JournalTrade[] {
  return trades
    .filter((t) => t.exitTs !== null)
    .sort((a, b) => a.exitTs! - b.exitTs! || a.entryTs - b.entryTs);
}
