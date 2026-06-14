import { computeCharges } from "@/lib/charges/charges";
import { getChargeProfile, type ChargeProfile } from "@/config/brokers";
import { parseContractName } from "./instrument-parse";
import type { DbStatement, DbValue } from "@/lib/db/types";
import type { Product, Segment, TradeLegRow, TradeRow } from "./types";

/**
 * SEG-04 — recompute charges for existing trades.
 *
 * Trades logged before SEG-01 (the segment×product model) had their charges
 * computed by the OLD engine, which applied the intraday STT branch to ALL
 * equity. Delivery / swing equity (CNC / BTST / STBT) therefore carries
 * OVERSTATED charges and an understated net P&L. This module re-runs the
 * current per-(segment, product) engine over a user's CLOSED trades and
 * produces the corrected `charges` + `net_pnl`, paise-precise.
 *
 * It is PURE (no DbClient) so it is unit-testable and identical across the
 * hosted / BYOD / local storage modes. Charges are recomputed leg-by-leg,
 * matching {@link deriveTradeNumbers} exactly:
 *   • multi-leg trades carry explicit `trade_legs` rows → sum over those legs
 *   • single-leg trades have no leg rows → the trade row's own fields are leg 1
 * `gross_pnl` is never touched (entry/exit are unchanged); only `charges` and
 * `net_pnl = gross_pnl − newCharges` are corrected.
 *
 * Idempotent: a trade already carrying the engine's charge value produces no
 * change, so running the recompute twice is a no-op on the second pass.
 */

/** A single leg's executable fields (a single-leg trade's leg 1 = its trade row). */
interface ChargeLeg {
  qty: number;
  entryPrice: number;
  exitPrice: number;
  direction: "long" | "short";
}

/** Money is paise-precise; round only at the boundary, exactly like the engine. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The legs to charge for a trade. A multi-leg trade carries one `trade_legs`
 * row per leg; a single-leg trade carries none, so its own row is leg 1.
 * Legs without an exit price (a still-open leg) are skipped — they contribute
 * no round-trip charge, matching the form's open-trade handling.
 */
export function chargeLegsForTrade(trade: TradeRow, legs: TradeLegRow[] | undefined): ChargeLeg[] {
  if (legs && legs.length > 0) {
    return legs
      .filter((l) => l.avg_exit != null)
      .map((l) => ({
        qty: l.qty,
        entryPrice: l.avg_entry,
        exitPrice: l.avg_exit!,
        direction: l.direction,
      }));
  }
  if (trade.avg_exit == null) return [];
  return [
    {
      qty: trade.qty,
      entryPrice: trade.avg_entry,
      exitPrice: trade.avg_exit,
      direction: trade.direction,
    },
  ];
}

/**
 * Recomputes total charges for a trade with the current engine. `product` falls
 * back to MIS for legacy NULL-product rows — exactly the engine's own default —
 * so a row whose product is genuinely unknown keeps its pre-v4 (intraday)
 * charge and never regresses.
 */
export function recomputeTradeCharges(
  profile: ChargeProfile,
  trade: Pick<TradeRow, "segment" | "product" | "symbol" | "option_type">,
  legs: ChargeLeg[]
): number {
  // Commodity CTT flags (SEG-09): a COMM option carries CTT on the sell
  // premium, an agri commodity is exempt. Derived from the stored symbol so
  // recompute matches the form/CSV charge engine exactly.
  const commodityOption = trade.segment === "COMM" && trade.option_type != null;
  const agriCommodity = trade.segment === "COMM" && parseContractName(trade.symbol).agri;
  let charges = 0;
  for (const leg of legs) {
    charges += computeCharges(profile, {
      segment: trade.segment as Segment,
      product: trade.product ?? null,
      qty: leg.qty,
      entryPrice: leg.entryPrice,
      exitPrice: leg.exitPrice,
      direction: leg.direction,
      commodityOption,
      agriCommodity,
    }).total;
  }
  return r2(charges);
}

/** A trade whose recomputed charges differ from what is stored. */
export interface RecomputeItem {
  id: string;
  symbol: string;
  segment: Segment;
  product: Product | null;
  oldCharges: number;
  newCharges: number;
  /** Stored gross — preserved; net is re-derived from it. */
  gross: number;
  oldNet: number;
  newNet: number;
  /** newCharges − oldCharges (negative = charges corrected downward). */
  chargeDelta: number;
}

export interface RecomputePreview {
  /** Closed trades considered (open trades are never recomputed). */
  considered: number;
  /** Trades whose charges (and therefore net) would change. */
  changedCount: number;
  /** Σ old charges over the changed trades. */
  oldChargesTotal: number;
  /** Σ new charges over the changed trades. */
  newChargesTotal: number;
  /** newChargesTotal − oldChargesTotal (negative = total charges drop). */
  chargesDelta: number;
  /** Σ net delta over the changed trades (= −chargesDelta). */
  netDelta: number;
  /**
   * Closed equity trades that still carry a NULL product — ambiguous rows the
   * v4 backfill could not classify (e.g. an open-then-closed EQ with no clear
   * holding pattern). They are charged as MIS (no change) until the user sets a
   * product; surfaced so the UI can prompt rather than silently guess delivery.
   */
  nullProductEqCount: number;
  /** The changed trades (for an optional detail list). */
  items: RecomputeItem[];
}

/** A closed trade plus its leg rows (empty for single-leg trades). */
export interface TradeForRecompute {
  trade: TradeRow;
  legs: TradeLegRow[];
}

/**
 * Diffs every CLOSED trade's stored charges against a fresh engine computation
 * using the account's charge profile, returning the delta totals + the list of
 * trades that would change. Pure — feed it the rows + a profile id.
 */
export function previewRecompute(profileId: string, trades: TradeForRecompute[]): RecomputePreview {
  const profile = getChargeProfile(profileId);
  const items: RecomputeItem[] = [];
  let considered = 0;
  let nullProductEqCount = 0;

  for (const { trade, legs } of trades) {
    if (trade.status !== "closed") continue;
    considered++;
    if (trade.segment === "EQ" && trade.product == null) nullProductEqCount++;

    const newCharges = recomputeTradeCharges(profile, trade, chargeLegsForTrade(trade, legs));
    const oldCharges = r2(trade.charges);
    if (newCharges === oldCharges) continue;

    const gross = r2(trade.gross_pnl);
    const newNet = r2(gross - newCharges);
    items.push({
      id: trade.id,
      symbol: trade.symbol,
      segment: trade.segment,
      product: trade.product,
      oldCharges,
      newCharges,
      gross,
      oldNet: r2(trade.net_pnl),
      newNet,
      chargeDelta: r2(newCharges - oldCharges),
    });
  }

  const oldChargesTotal = r2(items.reduce((s, i) => s + i.oldCharges, 0));
  const newChargesTotal = r2(items.reduce((s, i) => s + i.newCharges, 0));
  const chargesDelta = r2(newChargesTotal - oldChargesTotal);

  return {
    considered,
    changedCount: items.length,
    oldChargesTotal,
    newChargesTotal,
    chargesDelta,
    netDelta: r2(-chargesDelta),
    nullProductEqCount,
    items,
  };
}

/**
 * The UPDATE statements that apply a preview's changes. One statement per
 * changed trade; only `charges`, `net_pnl` and `updated_at` are written
 * (entry/exit/gross are never touched). Returns [] when nothing changed, so an
 * idempotent second run issues no writes.
 */
export function buildRecomputeStatements(
  items: RecomputeItem[],
  updatedAt: string = new Date().toISOString()
): DbStatement[] {
  return items.map((i) => ({
    sql: `UPDATE trades SET charges = ?, net_pnl = ?, updated_at = ? WHERE id = ?`,
    args: [i.newCharges, i.newNet, updatedAt, i.id] as DbValue[],
  }));
}
