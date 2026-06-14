/**
 * Pure options payoff-at-expiry math + strategy auto-labelling + DTE bucketing.
 *
 * Zero live data, zero implied-vol, zero LLM — everything here is closed-form
 * intrinsic-value math over the leg rows the user already entered. Premiums are
 * the entered `avgEntry` per leg. Shared by the trade-detail payoff diagram and
 * the analytics strategy-grouping / DTE tabs, and unit-tested in isolation.
 *
 * Sign convention: a LONG option pays its premium (cash out, negative now) and
 * collects intrinsic value at expiry; a SHORT option collects the premium (cash
 * in, positive now) and pays out intrinsic value at expiry. P&L is expressed in
 * rupees, scaled by each leg's quantity (qty already includes the lot size in
 * this app — e.g. one NIFTY lot is stored as qty 75).
 */

export type OptionType = "CE" | "PE";
export type LegDirection = "long" | "short";

/** A single option leg, normalised for payoff math. */
export interface PayoffLeg {
  strike: number;
  optionType: OptionType;
  direction: LegDirection;
  /** Total contracts (already lot-scaled in this codebase). */
  qty: number;
  /** Entered premium per unit (avg_entry). */
  premium: number;
}

/**
 * Intrinsic value at expiry of ONE option contract (per unit), given the
 * underlying settle price. Calls: max(S − K, 0); puts: max(K − S, 0).
 */
export function intrinsicValue(optionType: OptionType, strike: number, underlying: number): number {
  if (optionType === "CE") return Math.max(underlying - strike, 0);
  return Math.max(strike - underlying, 0);
}

/**
 * Net P&L of a single leg at the given underlying settle price, scaled by qty.
 *
 * Long  → qty · (intrinsic − premium)   (paid premium, collects intrinsic)
 * Short → qty · (premium − intrinsic)   (collected premium, pays intrinsic)
 */
export function legPayoffAt(leg: PayoffLeg, underlying: number): number {
  const intrinsic = intrinsicValue(leg.optionType, leg.strike, underlying);
  const perUnit = leg.direction === "long" ? intrinsic - leg.premium : leg.premium - intrinsic;
  return perUnit * leg.qty;
}

/** Total strategy P&L at one underlying price = sum of every leg. */
export function strategyPayoffAt(legs: PayoffLeg[], underlying: number): number {
  let total = 0;
  for (const leg of legs) total += legPayoffAt(leg, underlying);
  return total;
}

export interface PayoffPoint {
  underlying: number;
  pnl: number;
}

export interface PayoffCurve {
  /** Sampled (underlying, pnl) points across the price range, ascending. */
  points: PayoffPoint[];
  /** Min/max of the sampled underlying axis. */
  minUnderlying: number;
  maxUnderlying: number;
  /** Maximum profit over the range; Infinity when an open long tail runs. */
  maxProfit: number;
  /** Maximum loss over the range (a negative number, or 0); -Infinity if unbounded. */
  maxLoss: number;
  /** Underlying prices where P&L crosses zero (breakevens), ascending. */
  breakevens: number[];
  /** P&L is unbounded above — only net long CALLs (the put side is floored at S=0). */
  profitUnbounded: boolean;
  /** P&L is unbounded below (net short calls). */
  lossUnbounded: boolean;
}

/** Net per-unit call/put exposure of the book, used to detect open tails. */
function tailExposure(legs: PayoffLeg[]): { calls: number; puts: number } {
  let calls = 0;
  let puts = 0;
  for (const leg of legs) {
    const signed = (leg.direction === "long" ? 1 : -1) * leg.qty;
    if (leg.optionType === "CE") calls += signed;
    else puts += signed;
  }
  return { calls, puts };
}

/**
 * Choose a sensible underlying price range to plot. Centred on the strikes,
 * padded so the kinks and both breakevens are visible. Falls back gracefully
 * when there is a single strike.
 *
 * When the book carries ANY net PUT exposure the range is extended all the way
 * down to S=0, because a put's payoff keeps changing until the underlying hits
 * zero (a net-short put's max loss and a net-long put's max profit both occur at
 * S=0). The default ~20%-of-centre floor would otherwise never sample that leg
 * and understate the bounded put-side extreme (CORR-06).
 */
export function payoffRange(legs: PayoffLeg[]): { lo: number; hi: number } {
  const strikes = legs.map((l) => l.strike).filter((s) => Number.isFinite(s));
  const minK = Math.min(...strikes);
  const maxK = Math.max(...strikes);
  const center = (minK + maxK) / 2;
  // Pad by the wider of: the strike spread, or ~20% of the centre price.
  const spread = maxK - minK;
  const pad = Math.max(spread, center * 0.2, 1);
  // Any net put exposure means the S→0 leg is load-bearing for max loss/profit,
  // so floor the range at 0; otherwise keep the centred, padded window.
  const { puts } = tailExposure(legs);
  const lo = puts !== 0 ? 0 : Math.max(0, Math.min(minK, center - pad));
  const hi = Math.max(maxK, center + pad);
  return { lo, hi };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the full payoff-at-expiry curve for a set of legs.
 *
 * The P&L function is piecewise-linear with kinks only at the strikes, so we
 * evaluate exactly at every strike (plus the range ends and sample points) —
 * that captures max/min and breakevens precisely without dense sampling error.
 * `steps` controls how many extra points are sampled for a smooth SVG line.
 */
export function buildPayoffCurve(legs: PayoffLeg[], steps = 80): PayoffCurve {
  const usable = legs.filter(
    (l) => Number.isFinite(l.strike) && Number.isFinite(l.premium) && l.qty > 0
  );
  if (usable.length === 0) {
    return {
      points: [],
      minUnderlying: 0,
      maxUnderlying: 0,
      maxProfit: 0,
      maxLoss: 0,
      breakevens: [],
      profitUnbounded: false,
      lossUnbounded: false,
    };
  }

  const { lo, hi } = payoffRange(usable);
  // Sample points: range ends, every strike, and an even grid between.
  const xs = new Set<number>([lo, hi]);
  for (const l of usable) {
    if (l.strike > lo && l.strike < hi) xs.add(l.strike);
  }
  const span = hi - lo;
  for (let i = 0; i <= steps; i++) xs.add(lo + (span * i) / steps);

  const sorted = [...xs].sort((a, b) => a - b);
  const points: PayoffPoint[] = sorted.map((underlying) => ({
    underlying: round2(underlying),
    pnl: round2(strategyPayoffAt(usable, underlying)),
  }));

  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (const p of points) {
    if (p.pnl > maxProfit) maxProfit = p.pnl;
    if (p.pnl < maxLoss) maxLoss = p.pnl;
  }

  // Breakevens: zero-crossings of the piecewise-linear P&L between samples.
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (a.pnl === 0) {
      if (breakevens[breakevens.length - 1] !== a.underlying) breakevens.push(a.underlying);
    }
    if ((a.pnl < 0 && b.pnl > 0) || (a.pnl > 0 && b.pnl < 0)) {
      const t = a.pnl / (a.pnl - b.pnl);
      breakevens.push(round2(a.underlying + t * (b.underlying - a.underlying)));
    }
  }
  // Catch an exact zero on the final point.
  const last = points[points.length - 1]!;
  if (last.pnl === 0 && breakevens[breakevens.length - 1] !== last.underlying) {
    breakevens.push(last.underlying);
  }

  // Detect open tails so the UI can label "unlimited" rather than the sampled
  // edge value. As S → ∞ the P&L slope is the net call exposure; as S → 0 the
  // underlying is floored at zero, so the put side is ALWAYS bounded:
  //   • a net-LONG put peaks at S=0 (gain = (K − premium)·qty), not infinity;
  //   • a net-SHORT put's max loss also occurs at S=0 and is bounded.
  // Only net long CALLs give genuinely unbounded upside (CORR-01). With the
  // sample range now extended to S=0 for any put-bearing book (CORR-06), the
  // sampled maxProfit/maxLoss already capture the true put-side extreme.
  const { calls } = tailExposure(usable);
  const profitUnbounded = calls > 0; // net long calls → unbounded upside
  const lossUnbounded = calls < 0; // net short calls → unbounded downside

  return {
    points,
    minUnderlying: lo,
    maxUnderlying: hi,
    maxProfit: profitUnbounded ? Infinity : maxProfit,
    maxLoss: lossUnbounded ? -Infinity : maxLoss,
    breakevens: dedupeSorted(breakevens),
    profitUnbounded,
    lossUnbounded,
  };
}

function dedupeSorted(nums: number[]): number[] {
  const out: number[] = [];
  for (const n of [...nums].sort((a, b) => a - b)) {
    if (out.length === 0 || Math.abs(out[out.length - 1]! - n) > 1e-6) out.push(n);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * Strategy auto-labelling — name the structure from the leg shape alone.
 * ──────────────────────────────────────────────────────────────────────── */

export type StrategyLabel =
  | "Long Call"
  | "Long Put"
  | "Short Call"
  | "Short Put"
  | "Straddle"
  | "Short Straddle"
  | "Strangle"
  | "Short Strangle"
  | "Bull Call Spread"
  | "Bear Call Spread"
  | "Bull Put Spread"
  | "Bear Put Spread"
  | "Call Spread"
  | "Put Spread"
  | "Iron Condor"
  | "Iron Butterfly"
  | "Call Ratio Spread"
  | "Put Ratio Spread"
  | "Custom";

export interface LegShape {
  strike: number;
  optionType: OptionType;
  direction: LegDirection;
  qty: number;
}

const isLong = (l: LegShape) => l.direction === "long";
const isShort = (l: LegShape) => l.direction === "short";

/**
 * Classify a set of option legs into a named strategy purely from the shape
 * (strikes, CE/PE mix, long/short, relative quantities). Returns "Custom" for
 * anything outside the catalogue. Single legs are named directly.
 */
export function classifyStrategy(rawLegs: LegShape[]): StrategyLabel {
  const legs = rawLegs.filter((l) => Number.isFinite(l.strike) && l.qty > 0);
  if (legs.length === 0) return "Custom";

  if (legs.length === 1) {
    const l = legs[0]!;
    if (l.optionType === "CE") return isLong(l) ? "Long Call" : "Short Call";
    return isLong(l) ? "Long Put" : "Short Put";
  }

  const calls = legs.filter((l) => l.optionType === "CE");
  const puts = legs.filter((l) => l.optionType === "PE");

  // ── 2-leg structures ─────────────────────────────────────────────────
  if (legs.length === 2) {
    const [a, b] = legs;
    // Straddle / Strangle: one call + one put, same direction on both.
    if (calls.length === 1 && puts.length === 1) {
      const c = calls[0]!;
      const p = puts[0]!;
      if (isLong(c) && isLong(p)) {
        return c.strike === p.strike ? "Straddle" : "Strangle";
      }
      if (isShort(c) && isShort(p)) {
        return c.strike === p.strike ? "Short Straddle" : "Short Strangle";
      }
      return "Custom"; // mixed long/short call+put → not a vanilla structure
    }
    // Vertical spread: two of the same type, opposite directions.
    if (calls.length === 2 && a!.direction !== b!.direction) {
      if (calls[0]!.qty !== calls[1]!.qty) return "Call Ratio Spread";
      const longLeg = calls.find(isLong)!;
      const shortLeg = calls.find(isShort)!;
      // Bull call spread = buy lower strike, sell higher strike.
      return longLeg.strike < shortLeg.strike ? "Bull Call Spread" : "Bear Call Spread";
    }
    if (puts.length === 2 && a!.direction !== b!.direction) {
      if (puts[0]!.qty !== puts[1]!.qty) return "Put Ratio Spread";
      const longLeg = puts.find(isLong)!;
      const shortLeg = puts.find(isShort)!;
      // Bull put spread (credit) = buy the lower strike, sell the higher strike.
      // Bear put spread (debit)  = buy the higher strike, sell the lower strike.
      return longLeg.strike < shortLeg.strike ? "Bull Put Spread" : "Bear Put Spread";
    }
    if (calls.length === 2 || puts.length === 2) {
      return calls.length === 2 ? "Call Spread" : "Put Spread";
    }
    return "Custom";
  }

  // ── 4-leg structures: iron condor / iron butterfly ───────────────────
  if (legs.length === 4 && calls.length === 2 && puts.length === 2) {
    const shorts = legs.filter(isShort);
    const longs = legs.filter(isLong);
    // Short the inner strikes, long the wings: the classic credit structure.
    if (shorts.length === 2 && longs.length === 2) {
      const shortCall = calls.find(isShort);
      const shortPut = puts.find(isShort);
      if (shortCall && shortPut) {
        const shortStrikes = shorts.map((l) => l.strike);
        const longStrikes = longs.map((l) => l.strike);
        // Iron butterfly = both shorts at the SAME strike; condor = different.
        const sameShortStrike = shortCall.strike === shortPut.strike;
        // Sanity: long wings must straddle the short body.
        const innerLo = Math.min(...shortStrikes);
        const innerHi = Math.max(...shortStrikes);
        const outerLo = Math.min(...longStrikes);
        const outerHi = Math.max(...longStrikes);
        if (outerLo <= innerLo && outerHi >= innerHi) {
          return sameShortStrike ? "Iron Butterfly" : "Iron Condor";
        }
      }
    }
  }

  return "Custom";
}

/* ────────────────────────────────────────────────────────────────────────
 * DTE (days-to-expiry) bucketing — expiry − entry date, in calendar days.
 * ──────────────────────────────────────────────────────────────────────── */

export const DTE_BUCKETS = ["0DTE", "1–2", "3–7", "8–30", ">30"] as const;
export type DteBucket = (typeof DTE_BUCKETS)[number];

/**
 * Calendar days between the entry date and the expiry date (both YYYY-MM-DD /
 * ISO). Returns null when either is missing or unparseable. Same-day = 0.
 */
export function daysToExpiry(openedAt: string, expiry: string | null): number | null {
  if (!expiry) return null;
  const open = new Date(openedAt.slice(0, 10) + "T00:00:00Z");
  const exp = new Date(expiry.slice(0, 10) + "T00:00:00Z");
  const a = open.getTime();
  const b = exp.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const days = Math.round((b - a) / 86_400_000);
  return days < 0 ? null : days; // negative = data error, drop it
}

/** Which DTE bucket a day-count lands in. Expiry-day (0) → "0DTE". */
export function dteBucketKey(days: number): DteBucket {
  if (days <= 0) return "0DTE";
  if (days <= 2) return "1–2";
  if (days <= 7) return "3–7";
  if (days <= 30) return "8–30";
  return ">30";
}
