/**
 * The deterministic bar-replay backtest ENGINE (06-engine-semantics §1–§12).
 * Pure: `runBacktest(config, source)` consumes a BT-02 StrategyDef + a DataSource
 * and produces a BT-02 RunResult. engineVersion 1.0.0.
 *
 * HARD INVARIANTS (each pinned by a test in engine.test.ts):
 *  1. Next-bar-open fills for time entries/exits (decision bar's own open for a
 *     time entry; the open is the legitimately-tradeable price at the left edge).
 *  2. Point-in-time: a signal reads ONLY closed prior bars — no look-ahead.
 *  3. MTM from the option's OWN OHLC, never BS-implied from spot.
 *  4. Expiry settles at the LAST TRADED price (square-off bar), not intrinsic.
 *  5. SL/target tie-break = SL FIRST (worst-case).
 *  6. Fixed within-bar order: per-leg SL/target → overall MTM SL/target →
 *     trailing → re-entry.
 *  7. Risk checks ALWAYS at native 1-min, regardless of `interval`.
 *  8. Square-off at min(exitMinute, 15:29); nothing held overnight (intraday v1).
 *  9. Gap day: fill at the bar's open (can't fill better than the market printed).
 * 10. Missing-bar/illiquid: carry-forward marks (staleMarks), liquidity-scaled
 *     slippage, MISSING_LEG when a required leg has no prints all day.
 *
 * Determinism: seed → mulberry32; round ONLY at booking via r2; no Date.now /
 * Math.random in the hot path. computeCharges is called exactly once per leg
 * round-trip (OPT premium-sell branch).
 */

import { getChargeProfile } from "../../../config/brokers";
import { computeCharges, computeGrossPnl } from "../../charges/charges";
import {
  LOT_SIZE,
  OPTION_TICK as SHARED_OPTION_TICK,
  type IndexSymbol,
} from "../../../features/backtest/shared/instruments";
import {
  deriveQualityChips,
  type BlotterRow,
  type BookedLeg,
  type CoverageReport,
  type EquityPoint,
  type HeadlineStats,
  type MonthlyReturn,
  type PerLegStat,
  type RunResult,
  RUN_RESULT_VERSION,
  type StrikeResolution as RRStrikeResolution,
  type TradeReturn,
} from "../../../features/backtest/shared/run-result";
import type {
  ExpiryRuleKind,
  LegDef,
  StrategyDef,
} from "../../../features/backtest/shared/strategy-def";
import {
  earlyCloseMin,
  expiryFor,
  tradingDays,
  tradingDaysToExpiry,
} from "../calendar/market-calendar";
import { mulberry32 } from "../../montecarlo/simulate";
import { computeMetrics, type DailyReturn } from "../metrics";
import type { DataSource, DayData } from "./data-source";
import { applySlippage, exitSide as fillExitSide, type SlippageConfig } from "./fill-model";
import { resolvePremiumStrike, resolveStrike } from "./resolve-strike";
import {
  EOD_SQUAREOFF_MIN,
  ENGINE_VERSION,
  EPS,
  MAX_TRADING_DAYS,
  SESSION_MINUTES,
  type Bar,
  type Direction,
  type OptionType,
  type Series,
  type StrikeIntent,
  type StrikeResolution,
} from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST minute-of-day (0..1439) from an epoch-ms bar timestamp. */
export function minuteOfDayIST(ts: number): number {
  const istMs = ts + IST_OFFSET_MS;
  const dayMs = ((istMs % 86_400_000) + 86_400_000) % 86_400_000;
  return Math.floor(dayMs / 60_000);
}

/** Parse "HH:mm" → minute-of-day. */
function hhmmToMin(hhmm: string): number {
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  return h * 60 + m;
}

type RunFlag = "COVERAGE" | "LOW_LIQUIDITY" | "MISSING_LEG";
/** Blotter-row flags = the run flags plus the per-day EXERCISED marker. */
type BlotterFlag = RunFlag | "EXERCISED";

/** Normalize a BT-02 StrikeSelector → the engine's StrikeIntent vocabulary. */
function toIntent(leg: LegDef): StrikeIntent {
  const s = leg.strike;
  switch (s.mode) {
    case "ATM_OFFSET":
      return { kind: "atm", offset: s.steps };
    case "PERCENT":
      return { kind: "pct", pct: s.pct };
    case "PREMIUM":
      return { kind: "premium", target: s.target, band: s.band };
    case "EXACT":
      return { kind: "exact", strike: s.strike };
  }
}

/** BT-02 side ("buy"/"sell") → engine/charges direction ("long"/"short"). */
function toDirection(side: "buy" | "sell"): Direction {
  return side === "buy" ? "long" : "short";
}

/**
 * The favourable extreme of a bar for a direction (for trailing / target scans):
 * long favours the HIGH, short favours the LOW.
 */
function favourableExtreme(bar: Bar, dir: Direction): number {
  return dir === "long" ? bar.h : bar.l;
}
/** The adverse extreme (for SL scans): long → LOW, short → HIGH. */
function adverseExtreme(bar: Bar, dir: Direction): number {
  return dir === "long" ? bar.l : bar.h;
}

/** Bar lookup by minute-of-day for a series (sparse-aware). */
function indexByMinute(series: Series): Map<number, Bar> {
  const m = new Map<number, Bar>();
  for (const b of series) m.set(minuteOfDayIST(b.ts), b);
  return m;
}

interface OpenLeg {
  leg: LegDef;
  direction: Direction;
  optionType: OptionType;
  qty: number;
  strike: number;
  resolution: StrikeResolution;
  entryFill: number;
  /** Last known option close (for carry-forward marks). */
  lastMark: number;
  staleMarks: number;
  /** Resting SL / target premium levels (option-price space), or null. */
  slLevel: number | null;
  targetLevel: number | null;
  /** Trail anchor (favourable price since last ratchet), or null. */
  trailAnchor: number | null;
  /** Per-leg series + minute index for the day. */
  bars: Map<number, Bar>;
  /** Realized round-trips already booked for this leg today (re-entries). */
  reentries: number;
  /** Accumulated booked legs for THIS leg id this day (entry+reentries). */
  booked: BookedLeg[];
  /** Exit ts of the most recent booking for this leg (for re-entry gating). */
  lastExitTs: number;
  /** True once this cycle is booked AND eligible to re-enter on a later bar. */
  pendingReentry: boolean;
  /** Minute-of-day this leg actually opened (entryMin + leg.entryOffsetMin). */
  enteredAt: number;
  /** Per-leg forced square-off cap (effectiveExitMin − leg.exitOffsetMin). */
  legExitMin: number;
}

/**
 * A leg whose entryOffsetMin defers it past the strategy entry bar — it is
 * resolved + opened at its OWN later entry minute (legged entry), not the shared
 * entry bar. Holds only what's needed to open it when its minute is reached.
 */
interface PendingLeg {
  leg: LegDef;
  direction: Direction;
  qty: number;
  /** First minute-of-day this leg may open: entryMin + (leg.entryOffsetMin ?? 0). */
  entryMinute: number;
  /** Per-leg forced square-off cap (effectiveExitMin − leg.exitOffsetMin). */
  legExitMin: number;
}

interface DayState {
  open: boolean;
  legs: OpenLeg[];
  /** Legs already fully closed today (no longer running), kept for booking. */
  closed: OpenLeg[];
  entryTs: number;
  exitTs: number;
  inPositionMinutes: number;
  turnover: number;
  /** Strategy-MTM trail floor (rupees), or null. */
  mtmTrailFloor: number | null;
  /** Peak strategy MTM seen today (for trailing). */
  mtmPeak: number;
  exitReason: BlotterRow["flags"] extends unknown ? string : string;
}

export interface RunBacktestOptions {
  /** Override runId (else derived deterministically from config + snapshot). */
  runId?: string;
  /** Override ranAt (tests pin this to keep results byte-identical). */
  ranAt?: number;
}

/**
 * Run a full backtest. Pure & deterministic: identical (config, source) ⇒
 * identical RunResult (modulo meta.ranAt). Throws a typed error on a config that
 * violates the hard caps.
 */
export function runBacktest(
  config: StrategyDef,
  source: DataSource,
  opts: RunBacktestOptions = {}
): RunResult {
  const index = config.market.symbol;
  const seed = config.execution.seed;
  // Seed the PRNG even though v1 has no stochastic fills — keeps the determinism
  // contract explicit and ready for any future randomized tie-break.
  const rng = mulberry32(seed);
  void rng;

  const profile = getChargeProfile(
    config.execution.broker === "custom" ? "zerodha" : config.execution.broker
  );
  const slip: SlippageConfig = {
    mode: config.execution.slippage.unit === "pct" ? "percent" : "ticks",
    value: config.execution.slippage.value,
    tickSize: SHARED_OPTION_TICK,
  };

  const entryMin = hhmmToMin(config.timing.entryTime);
  const exitMin = Math.min(hhmmToMin(config.timing.exitTime), EOD_SQUAREOFF_MIN);

  // Trading-day spine (clamped to data + cap).
  const days = tradingDaySpine(config, index);
  if (days.length > MAX_TRADING_DAYS) {
    throw new Error(`backtest: ${days.length} trading days exceeds cap ${MAX_TRADING_DAYS}`);
  }

  const blotter: BlotterRow[] = [];
  const daily: DailyReturn[] = [];
  const perLegAgg = new Map<
    string,
    { net: number; trades: number; covSum: number; covN: number }
  >();
  let substitutions = 0;
  let illiquidDays = 0;
  let excludedDays = 0;
  const flags = new Set<RunFlag>();
  let barsPresent = 0;
  let barsExpected = 0;
  const legCoverage = new Map<string, { sum: number; n: number }>();

  // SINGLE expiry source for BOTH the data fetch/spine and the daysFromExpiry
  // gate in replayDay: the FIRST ENABLED leg's rule (disabled legs must not drive
  // which expiry's chain is loaded). Falls back to legs[0] only when no leg is
  // enabled (such days are filtered out by replayDay anyway).
  const expiryRule = (config.legs.find((l) => l.enabled) ?? config.legs[0]!)
    .expiry as ExpiryRuleKind;

  for (const day of days) {
    const expiry = expiryFor(index, day, expiryRule);
    const dd = source.dayData(index, expiry, day);

    // Day filters (daysOfWeek / daysFromExpiry handled in spine for DOW; expiry
    // filter handled here so it can use the resolved expiry).
    const dayResult = replayDay(config, index, expiry, expiryRule, dd, {
      entryMin,
      exitMin,
      profile,
      slip,
    });
    if (dayResult === null) continue; // filtered out (no qualifying day)

    if (dayResult.excluded) {
      excludedDays++;
      flags.add("MISSING_LEG");
      continue;
    }

    // Coverage accounting (finding 42): accumulate ONLY for days that actually
    // book a row. Days filtered out (no qualifying entry / daysFromExpiry) or
    // excluded (MISSING_LEG) above must not inflate the numerator OR denominator,
    // so filledBarFraction describes the TRADED sample, not the whole spine.
    barsExpected += SESSION_MINUTES;
    barsPresent += dd.index.length;

    const row = dayResult.row;
    blotter.push(row);
    if (row.substituted) substitutions++;
    if (row.flags.includes("LOW_LIQUIDITY")) illiquidDays++;
    // EXERCISED is a per-day blotter marker, not a run-level honesty flag — keep
    // it off the top-level flags set (which is the 3-value coverage enum).
    for (const f of row.flags) if (f !== "EXERCISED") flags.add(f as RunFlag);

    daily.push({
      day,
      net: row.net,
      inPositionMinutes: dayResult.inPositionMinutes,
      turnover: dayResult.turnover,
    });

    for (const bl of row.legs) {
      const agg = perLegAgg.get(bl.legId) ?? { net: 0, trades: 0, covSum: 0, covN: 0 };
      agg.net = r2(agg.net + bl.net);
      agg.trades += 1;
      agg.covSum += bl.resolution.coverage;
      agg.covN += 1;
      perLegAgg.set(bl.legId, agg);

      const lc = legCoverage.get(bl.legId) ?? { sum: 0, n: 0 };
      lc.sum += bl.resolution.coverage;
      lc.n += 1;
      legCoverage.set(bl.legId, lc);
    }
  }

  // ── Aggregate into the RunResult ──────────────────────────────────────────
  const metrics = computeMetrics(daily, SESSION_MINUTES);

  // Equity curve (cumulative net by day).
  let equity = 0;
  const equityCurve: EquityPoint[] = daily.map((d) => {
    equity = r2(equity + d.net);
    return { ts: dayKeyToEpochMs(d.day), equity };
  });

  // Monthly returns.
  const monthlyMap = new Map<string, number>();
  for (const d of daily) {
    const ym = d.day.slice(0, 7);
    monthlyMap.set(ym, r2((monthlyMap.get(ym) ?? 0) + d.net));
  }
  const monthlyReturns: MonthlyReturn[] = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, pnl]) => ({ month, pnl }));

  const tradeReturns: TradeReturn[] = daily.map((d) => ({ day: d.day, net: d.net }));

  const byLeg: Record<string, number> = {};
  for (const [legId, lc] of legCoverage) byLeg[legId] = lc.n > 0 ? r2v(lc.sum / lc.n) : 0;

  const overallCoverage =
    legCoverage.size > 0
      ? r2v(
          [...legCoverage.values()].reduce((s, lc) => s + (lc.n ? lc.sum / lc.n : 0), 0) /
            legCoverage.size
        )
      : 0;

  const filledBarFraction = barsExpected > 0 ? r2v(Math.min(1, barsPresent / barsExpected)) : 0;

  const coverage: CoverageReport = {
    overall: overallCoverage,
    byLeg,
    substitutions,
    illiquidDays,
    excludedDays,
    filledBarFraction,
  };

  const stats: HeadlineStats = {
    netPnl: metrics.totalNet,
    winRate: metrics.winRate,
    maxDrawdown: metrics.maxDrawdown,
    expectancy: metrics.expectancy,
    profitFactor: metrics.profitFactor,
    sharpe: metrics.sharpe,
  };

  const perLeg: PerLegStat[] = [...perLegAgg.entries()].map(([legId, a]) => {
    const leg = config.legs.find((l) => l.id === legId)!;
    return {
      legId,
      optionType: leg.optionType,
      side: leg.side,
      net: a.net,
      trades: a.trades,
      meanCoverage: a.covN > 0 ? r2v(a.covSum / a.covN) : 0,
    };
  });

  const qualityChips = deriveQualityChips(coverage, blotter.length);

  const dataSnapshotId = source.snapshotId;
  const ranAt = opts.ranAt ?? 0; // deterministic default; UI/worker stamps real time
  const runId = opts.runId ?? deterministicRunId(config, dataSnapshotId);

  return {
    resultVersion: RUN_RESULT_VERSION,
    runId,
    config,
    engineVersion: ENGINE_VERSION,
    dataSnapshotId,
    ranAt,
    coverage,
    stats,
    qualityChips,
    equityCurve,
    monthlyReturns,
    tradeReturns,
    blotter,
    perLeg,
    flags: [...flags],
  };
}

/** Round a 0..1 ratio to 4dp without breaching the [0,1] schema bound. */
function r2v(n: number): number {
  const v = Math.round(n * 10000) / 10000;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Deterministic run id from config + snapshot (FNV-1a over the JSON). */
function deterministicRunId(config: StrategyDef, snapshotId: string): string {
  const json = JSON.stringify(config) + "|" + snapshotId + "|" + ENGINE_VERSION;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "run_" + (h >>> 0).toString(16).padStart(8, "0");
}

/** Epoch-ms of 09:15 IST on a "YYYY-MM-DD" day key (stable). */
function dayKeyToEpochMs(day: string): number {
  // 09:15 IST = 03:45 UTC.
  return Date.parse(`${day}T03:45:00.000Z`);
}

/** Build the clamped trading-day spine honoring daysOfWeek. */
function tradingDaySpine(config: StrategyDef, index: IndexSymbol): string[] {
  const all: string[] = tradingDays(
    config.market.dateRange.start,
    config.market.dateRange.end,
    index
  );
  const dow = config.timing.daysOfWeek;
  if (!dow || dow.length === 0) return all;
  // BT-02 daysOfWeek: 1..5 = Mon..Fri.
  return all.filter((d) => {
    const js = new Date(`${d}T12:00:00.000Z`).getUTCDay(); // Sun=0..Sat=6
    return dow.includes(js as 1 | 2 | 3 | 4 | 5);
  });
}

interface ReplayCtx {
  entryMin: number;
  exitMin: number;
  profile: ReturnType<typeof getChargeProfile>;
  slip: SlippageConfig;
}

interface ReplayDayResult {
  excluded: boolean;
  row: BlotterRow;
  inPositionMinutes: number;
  turnover: number;
}

/**
 * Replay ONE trading day. Returns null when the day is filtered out (no
 * qualifying entry), { excluded:true } when a required leg has no data
 * (MISSING_LEG), else a booked blotter row.
 */
function replayDay(
  config: StrategyDef,
  index: IndexSymbol,
  expiry: string,
  expiryRule: ExpiryRuleKind,
  dd: DayData,
  ctx: ReplayCtx
): ReplayDayResult | null {
  const enabledLegs = config.legs.filter((l) => l.enabled);
  if (enabledLegs.length === 0) return null;

  // daysFromExpiry filter (uses the resolved expiry vs the trade day). MUST use
  // the SAME expiryRule the caller resolved the loaded chain with (first enabled
  // leg), so the gate evaluates the expiry whose data we actually fetched.
  const dfe = config.timing.daysFromExpiry;
  if (dfe && dfe.length > 0) {
    const n = tradingDaysToExpiry(index, dd.day, expiryRule);
    if (!dfe.includes(n)) return null;
  }

  const idxByMin = indexByMinute(dd.index);
  if (idxByMin.size === 0) return null; // no index bars → no decision possible

  // Find the entry bar: first index bar with minuteOfDay ≥ entryMin (§4).
  let entryBar: Bar | null = null;
  for (const b of dd.index) {
    if (minuteOfDayIST(b.ts) >= ctx.entryMin) {
      entryBar = b;
      break;
    }
  }
  if (entryBar === null) return null; // entry minute never reached → no trade
  const entryMinute = minuteOfDayIST(entryBar.ts);

  // EARLY-CLOSE (half-day) cap (BT fix #4): never trade or mark a bar past an
  // abbreviated session's real close. effectiveExitMin = min(exitMin, close−1).
  const earlyClose = earlyCloseMin(dd.day);
  const effectiveExitMin =
    earlyClose !== null ? Math.min(ctx.exitMin, earlyClose - 1) : ctx.exitMin;

  // Expiry-day flag (BT fix #1): the resolved contract expiry IS this trade day,
  // so a still-open LONG ITM leg is settled at intrinsic via exercise (the "STT
  // trap"), not carried at a stale LTP, when forced off at the day's EOD.
  const isExpiryDay = expiry === dd.day;
  // v1 settlement reference = the day's LAST index close (upgrade to last-30-min
  // spot VWAP behind this helper later). Used for intrinsic at exercise.
  const settlementSpot = settlementSpotOf(dd.index);

  // ── Per-leg staggered entry (BT fix #3) ───────────────────────────────────
  // Each leg opens at its OWN minute = entryMin + (leg.entryOffsetMin ?? 0),
  // resolved against THAT bar's spot, and is force-squared no later than its own
  // legExitMin = min(effectiveExitMin, exitMin − (leg.exitOffsetMin ?? 0)).
  // Legs with offset 0 open immediately at the entry bar (the common case →
  // byte-identical to before).
  const open: OpenLeg[] = [];
  const pending: PendingLeg[] = [];
  let substituted = false;
  let dayLowLiquidity = false;
  let turnover = 0;
  let excluded = false;

  for (const leg of enabledLegs) {
    const direction = toDirection(leg.side);
    const qty = leg.lots * LOT_SIZE[index];
    const legEntryMin = entryMinute + (leg.entryOffsetMin ?? 0);
    const legExitMin = Math.min(effectiveExitMin, ctx.exitMin - (leg.exitOffsetMin ?? 0));
    if (legEntryMin <= entryMinute) {
      // Immediate leg — resolve + open at the entry bar's open spot.
      const res = openLegAt(
        leg,
        direction,
        qty,
        index,
        dd,
        entryBar.o,
        entryMinute,
        legExitMin,
        ctx
      );
      if (res.excluded) {
        excluded = true;
        break;
      }
      if (res.substituted) substituted = true;
      if (res.lowLiquidity) dayLowLiquidity = true;
      turnover = r2(turnover + res.ol!.entryFill * qty);
      open.push(res.ol!);
    } else {
      pending.push({ leg, direction, qty, entryMinute: legEntryMin, legExitMin });
    }
  }

  if (excluded) {
    return { excluded: true, row: emptyRow(dd.day), inPositionMinutes: 0, turnover: 0 };
  }

  // ── Bar-by-bar replay from entry to square-off (native 1-min) ─────────────
  const state: DayState = {
    open: true,
    legs: open,
    closed: [],
    entryTs: entryBar.ts,
    exitTs: entryBar.ts,
    inPositionMinutes: 0,
    turnover,
    mtmTrailFloor: null,
    mtmPeak: 0,
    exitReason: "time",
  };

  const overall = config.risk;

  for (const b of dd.index) {
    const mod = minuteOfDayIST(b.ts);
    if (mod < entryMinute) continue;
    // Never process a bar past the early-close cap (BT fix #4): force off + stop.
    if (mod > effectiveExitMin) break;

    // Open any deferred leg whose own entry minute has arrived (BT fix #3),
    // resolved against this bar's open spot. A deferred required leg that cannot
    // resolve excludes the whole day (atomic entry).
    if (pending.length > 0) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i]!;
        if (mod < p.entryMinute) continue;
        const res = openLegAt(p.leg, p.direction, p.qty, index, dd, b.o, mod, p.legExitMin, ctx);
        pending.splice(i, 1);
        if (res.excluded) {
          return { excluded: true, row: emptyRow(dd.day), inPositionMinutes: 0, turnover: 0 };
        }
        if (res.substituted) substituted = true;
        if (res.lowLiquidity) dayLowLiquidity = true;
        state.turnover = r2(state.turnover + res.ol!.entryFill * p.qty);
        state.legs.push(res.ol!);
      }
    }

    // Stop only when no legs are open AND no pending entry AND no re-entry budget.
    if (state.legs.length === 0 && pending.length === 0 && !hasReentryBudget(state)) break;

    if (state.legs.length > 0) {
      state.inPositionMinutes += 1;
      state.exitTs = b.ts;
    }

    // (0) Mark every open leg from its OWN option close (§2/§3 invariant), with
    // carry-forward for holes.
    markLegs(state.legs, mod);

    // Per-leg forced square-off at each leg's own exit cap (BT fix #3/#4): a leg
    // whose legExitMin is reached squares now (exercise-settled only if held to
    // the expiry-day EOD), independent of the strategy-wide exit. Survivors continue.
    forceSquareOffDueLegs(state, ctx, mod, effectiveExitMin, isExpiryDay, settlementSpot);

    // Strategy-wide forced square-off at effectiveExitMin (§7.1) — supersedes
    // risk. All remaining legs settle here (exercise-aware on expiry day).
    if (mod >= effectiveExitMin) {
      forceSquareOff(state, ctx, mod, "time", isExpiryDay, settlementSpot);
      break;
    }

    // FIXED within-bar order (§5.3), pinned by tests:
    // (1) Per-leg SL / target (intrabar, SL-first tie-break §5.1). The
    //     partial-vs-complete decision is made PER HITTING LEG (BT fix #2).
    applyPerLegRisk(state, ctx, b, mod);

    // (2) Overall MTM SL / target (§5.2). Skipped once everything is closed.
    if (state.legs.length > 0) {
      const breached = applyOverallMtmRisk(state, ctx, b, mod, overall);
      if (breached) {
        // After a complete-strategy MTM exit, re-entry on overall is opt-in.
        if (!config.risk.reEntryOnOverall) break;
      }
    }

    // (3) Trailing updates (per-leg, after risk so a same-bar SL fires at the
    //     pre-ratchet level — conservative).
    updateTrailing(state.legs);

    // (4) Re-entry (§6) — only for legs squared this bar; v1 supports RE_ASAP /
    //     RE_COST / RE_MOMENTUM at the leg level.
    maybeReenter(state, ctx, b, mod);
  }

  // A deferred leg that never reached its entry minute before the day's
  // effective close (entryOffsetMin pushed it past exit, or no bar arrived)
  // breaks atomic entry — exclude the whole day rather than book a partial
  // structure the user never asked for.
  if (pending.length > 0) {
    return { excluded: true, row: emptyRow(dd.day), inPositionMinutes: 0, turnover: 0 };
  }

  // Any leg still open at end (e.g. exit bar reached via break above already
  // squared; this catches the all-bars-consumed case) → settle (exercise-aware).
  if (state.legs.length > 0) {
    forceSquareOff(state, ctx, effectiveExitMin, "eod", isExpiryDay, settlementSpot);
  }

  // ── Book the day ──────────────────────────────────────────────────────────
  const allBooked: BookedLeg[] = [];
  for (const ol of [...state.closed]) allBooked.push(...ol.booked);

  const gross = r2(allBooked.reduce((s, bl) => s + bl.gross, 0));
  const charges = r2(allBooked.reduce((s, bl) => s + bl.charges, 0));
  const net = r2(allBooked.reduce((s, bl) => s + bl.net, 0));

  const rowFlags: BlotterFlag[] = [];
  if (substituted) rowFlags.push("COVERAGE");
  if (dayLowLiquidity || allBooked.some((bl) => bl.resolution.confidence === "low")) {
    rowFlags.push("LOW_LIQUIDITY");
  }
  // EXERCISED marker (BT fix #1): any leg settled at intrinsic via exercise.
  if (allBooked.some((bl) => bl.settlement === "exercise")) rowFlags.push("EXERCISED");

  const row: BlotterRow = {
    day: dd.day,
    entryTs: state.entryTs,
    exitTs: state.exitTs,
    legs: allBooked,
    gross,
    charges,
    net,
    substituted,
    flags: rowFlags,
  };

  return {
    excluded: false,
    row,
    inPositionMinutes: state.inPositionMinutes,
    turnover: state.turnover,
  };
}

/**
 * The settlement spot reference for expiry-day intrinsic settlement (BT fix #1).
 * v1 = the day's LAST index close (the carried-forward close of the final bar).
 * Upgrade to the last-30-min spot VWAP behind this helper later; the call sites
 * never change. Returns null when the index has no bars (no settlement possible).
 */
function settlementSpotOf(index: Series): number | null {
  if (index.length === 0) return null;
  return index[index.length - 1]!.c;
}

/**
 * Intrinsic value (per contract, in option-price units) of an option at a spot.
 * CE = max(0, spot − strike); PE = max(0, strike − spot). Cash-settled index
 * options settle at exactly this on expiry.
 */
function intrinsicAt(optionType: OptionType, strike: number, spot: number): number {
  const v = optionType === "CE" ? spot - strike : strike - spot;
  return v > 0 ? v : 0;
}

/**
 * True when a still-open leg held to its expiry-day EOD must be EXERCISE-settled
 * at intrinsic (the "STT trap"): a LONG (buy) leg that is ITM at the settlement
 * spot. SHORT legs are assigned (their premium-sell STT already covers them) and
 * OTM legs (intrinsic 0) stay on the ordinary LTP path — settling them at 0
 * intrinsic equals their worthless expiry anyway, but only the LONG-ITM case
 * carries the distinct exercise-STT cost, so that is the case we branch on.
 */
function isExerciseSettled(
  ol: OpenLeg,
  isExpiryDay: boolean,
  settlementSpot: number | null
): boolean {
  if (!isExpiryDay || settlementSpot === null) return false;
  if (ol.direction !== "long") return false;
  return intrinsicAt(ol.optionType, ol.strike, settlementSpot) > EPS;
}

/** Result of opening a single leg at a given bar/spot. */
interface OpenLegResult {
  ol: OpenLeg | null;
  excluded: boolean;
  substituted: boolean;
  lowLiquidity: boolean;
}

/**
 * Resolve + open ONE leg at `mod` against `spot` (the bar's open). Pure factory
 * shared by the immediate-entry, deferred-entry (offset) and bar paths so every
 * entry resolves identically. Returns excluded=true when the leg cannot resolve
 * or has no prints (atomic-entry → whole day excluded by the caller).
 */
function openLegAt(
  leg: LegDef,
  direction: Direction,
  qty: number,
  index: IndexSymbol,
  dd: DayData,
  spot: number,
  mod: number,
  legExitMin: number,
  ctx: ReplayCtx
): OpenLegResult {
  const intent = toIntent(leg);
  let resolution: StrikeResolution | null;
  if (intent.kind === "premium") {
    const prices = new Map<number, number>();
    for (const c of dd.chain) {
      if (c.optionType !== leg.optionType) continue;
      const s = dd.option(c.strike, leg.optionType);
      const b = s.find((bb) => minuteOfDayIST(bb.ts) === mod) ?? s[0];
      if (b) prices.set(c.strike, b.o);
    }
    resolution = resolvePremiumStrike(
      index,
      dd.chain,
      leg.optionType,
      intent.target,
      intent.band,
      prices,
      spot
    );
  } else {
    resolution = resolveStrike(index, dd.chain, leg.optionType, intent, spot);
  }
  if (resolution === null) {
    return { ol: null, excluded: true, substituted: false, lowLiquidity: false };
  }
  const substituted = resolution.served !== resolution.requested;

  const legBars = indexByMinute(dd.option(resolution.served, leg.optionType));
  if (legBars.size === 0) {
    return { ol: null, excluded: true, substituted, lowLiquidity: false };
  }

  const entryOptBar = legBars.get(mod);
  const cleanEntry = entryOptBar ? entryOptBar.o : nearestPriorMark(legBars, mod);
  const entryVol = entryOptBar ? entryOptBar.v : 0;
  const { fill: entryFill, illiquid } = applySlippage(cleanEntry, ctx.slip, {
    side: direction === "long" ? "buy" : "sell",
    coverage: resolution.coverage,
    barVolume: entryVol,
  });

  const ol: OpenLeg = {
    leg,
    direction,
    optionType: leg.optionType,
    qty,
    strike: resolution.served,
    resolution,
    entryFill,
    lastMark: cleanEntry,
    staleMarks: 0,
    slLevel: computeRiskLevel(leg.stopLoss, direction, "sl", entryFill),
    targetLevel: computeRiskLevel(leg.target, direction, "target", entryFill),
    trailAnchor: leg.trailingStop ? entryFill : null,
    bars: legBars,
    reentries: 0,
    booked: [],
    lastExitTs: -1,
    pendingReentry: false,
    enteredAt: mod,
    legExitMin,
  };
  return { ol, excluded: false, substituted, lowLiquidity: illiquid };
}

/**
 * Force-square any open leg whose per-leg exit cap (legExitMin) is reached at
 * `mod` (BT fix #3/#4). A leg is EXERCISE-settled (BT fix #1) ONLY when it is
 * held to the expiry-day EOD — i.e. `mod >= effectiveExitMin`. A leg squared
 * EARLY by its own exitOffsetMin (legExitMin < effectiveExitMin) is a market
 * exit and settles at LTP even on expiry day. Survivors stay open.
 */
function forceSquareOffDueLegs(
  state: DayState,
  ctx: ReplayCtx,
  mod: number,
  effectiveExitMin: number,
  isExpiryDay: boolean,
  settlementSpot: number | null
): void {
  if (state.legs.length === 0) return;
  const atEod = mod >= effectiveExitMin;
  const survivors: OpenLeg[] = [];
  for (const ol of state.legs) {
    if (mod >= ol.legExitMin) {
      // Exercise only at the true EOD; an early per-leg exit is an LTP market exit.
      settleLegAt(state, ctx, ol, mod, "time", isExpiryDay && atEod, settlementSpot);
    } else {
      survivors.push(ol);
    }
  }
  state.legs = survivors;
}

/**
 * Settle ONE leg at `mod`: exercise-at-intrinsic for an expiry-day ITM long (the
 * "STT trap"), else at the last traded price (LTP, invariant 4). Routes to
 * bookExit with the right settlement flag.
 */
function settleLegAt(
  state: DayState,
  ctx: ReplayCtx,
  ol: OpenLeg,
  mod: number,
  reason: string,
  isExpiryDay: boolean,
  settlementSpot: number | null
): void {
  if (isExerciseSettled(ol, isExpiryDay, settlementSpot)) {
    const intrinsic = intrinsicAt(ol.optionType, ol.strike, settlementSpot!);
    bookExit(state, ctx, ol, intrinsic, lastTs(ol, mod), mod, reason, "exercise");
  } else {
    const bar = ol.bars.get(mod);
    const clean = bar ? bar.c : ol.lastMark;
    bookExit(state, ctx, ol, clean, lastTs(ol, mod), mod, reason, "ltp");
  }
}

/** Compute an SL/target premium level (option-price space) from a leg trigger. */
function computeRiskLevel(
  trig: LegDef["stopLoss"] | LegDef["target"],
  direction: Direction,
  which: "sl" | "target",
  entryFill: number
): number | null {
  if (!trig) return null;
  // v1: support premium-basis triggers (the common case + what the fixture/golden
  // strategies use). underlying-basis is plumbed but treated as premium-equivalent
  // when no spot reference is provided per-bar (documented limitation; the engine
  // marks from option price so a premium SL is the faithful intraday stop).
  const isLoss = which === "sl";
  // For a SHORT leg, a loss is a price RISE; a gain is a price FALL. Long inverts.
  const adverseUp = direction === "short"; // short: adverse = up
  const moveUp = isLoss ? adverseUp : !adverseUp;

  let level: number;
  if (trig.unit === "pct") {
    const frac = trig.value / 100;
    level = moveUp ? entryFill * (1 + frac) : entryFill * (1 - frac);
  } else {
    level = moveUp ? entryFill + trig.value : entryFill - trig.value;
  }
  return level > 0 ? level : EPS;
}

/** Mark each open leg from its own option close at minute `mod` (carry-forward). */
function markLegs(legs: OpenLeg[], mod: number): void {
  for (const ol of legs) {
    const bar = ol.bars.get(mod);
    if (bar) {
      ol.lastMark = bar.c;
    } else {
      ol.staleMarks += 1; // carry-forward; lastMark unchanged
    }
  }
}

/** Nearest prior real mark in a sparse series before/at `mod`, else the first. */
function nearestPriorMark(bars: Map<number, Bar>, mod: number): number {
  for (let m = mod; m >= 0; m--) {
    const b = bars.get(m);
    if (b) return b.o;
  }
  // No prior — use the earliest bar.
  let earliest: Bar | null = null;
  for (const b of bars.values()) {
    if (!earliest || b.ts < earliest.ts) earliest = b;
  }
  return earliest ? earliest.o : EPS;
}

/**
 * Apply per-leg SL/target at minute `mod`, SL-first tie-break (§5.1). The
 * partial-vs-complete square-off is decided PER HITTING LEG (BT fix #2): a leg
 * whose OWN `squareOff === 'complete'` triggers squares EVERY survivor; a
 * `'partial'` leg squares only itself. The strategy-wide enabledLegs[0] mode is
 * gone — each leg's own setting is honoured. If any leg that hit this bar is
 * `complete`, all survivors are squared at the bar's close.
 */
function applyPerLegRisk(state: DayState, ctx: ReplayCtx, b: Bar, mod: number): void {
  const survivors: OpenLeg[] = [];
  let completeHit = false;
  for (const ol of state.legs) {
    const bar = ol.bars.get(mod);
    if (!bar) {
      survivors.push(ol);
      continue;
    }
    const adverse = adverseExtreme(bar, ol.direction);
    const favour = favourableExtreme(bar, ol.direction);

    // SL hit?
    const slHit =
      ol.slLevel !== null &&
      (ol.direction === "long" ? adverse <= ol.slLevel + EPS : adverse >= ol.slLevel - EPS);
    const tgtHit =
      ol.targetLevel !== null &&
      (ol.direction === "long" ? favour >= ol.targetLevel - EPS : favour <= ol.targetLevel + EPS);

    if (slHit) {
      // SL FIRST — even if target also inside the bar (§5.1, invariant 5).
      // Gap-aware fill (invariant 9): can't fill better than the bar's open.
      const fillClean = gapAwareLevelFill(bar, ol.slLevel!, ol.direction, "sl");
      bookExit(state, ctx, ol, fillClean, b.ts, mod, "leg-sl", "ltp");
      if (ol.leg.squareOff === "complete") completeHit = true;
      continue;
    }
    if (tgtHit) {
      const fillClean = gapAwareLevelFill(bar, ol.targetLevel!, ol.direction, "target");
      bookExit(state, ctx, ol, fillClean, b.ts, mod, "leg-target", "ltp");
      if (ol.leg.squareOff === "complete") completeHit = true;
      continue;
    }
    survivors.push(ol);
  }

  if (completeHit && survivors.length > 0) {
    // A `complete` hitting leg squares the whole strategy at the bar's close.
    for (const ol of survivors) {
      bookExit(state, ctx, ol, ol.lastMark, b.ts, mod, "leg-sl", "ltp");
    }
    state.legs = [];
  } else {
    state.legs = survivors;
  }
}

/**
 * Gap-aware fill at a resting SL/target level: a SHORT leg's SL is a buy at the
 * level, but if the bar GAPPED past it (open already beyond the level), the fill
 * is the open — you can't fill better than the market printed (invariant 9).
 */
function gapAwareLevelFill(
  bar: Bar,
  level: number,
  direction: Direction,
  which: "sl" | "target"
): number {
  // The exit side for a short leg is a buy; for a long leg a sell.
  const buying = direction === "short" ? true : false; // exit of a short = buy
  if (which === "sl") {
    if (buying) {
      // Buying to cover at SL (price rose). If open already above level, fill at open.
      return bar.o > level ? bar.o : level;
    } else {
      // Long SL: selling out as price fell. If open already below level, fill at open.
      return bar.o < level ? bar.o : level;
    }
  } else {
    // target: favourable. Fill at the level (limit). Gap in favour fills at open
    // if better is unrealistic — but a limit fills at the level at best, and a
    // gap THROUGH the limit fills at the level (you'd queue), so keep the level.
    return level;
  }
}

/** Apply overall MTM SL/target (§5.2). Returns true if it squared everything. */
function applyOverallMtmRisk(
  state: DayState,
  ctx: ReplayCtx,
  b: Bar,
  mod: number,
  overall: StrategyDef["risk"]
): boolean {
  if (state.legs.length === 0) return false;
  const mtm = strategyMtm(state);
  if (mtm > state.mtmPeak) state.mtmPeak = mtm;

  // lockAndTrail / trailing floor.
  if (overall.lockAndTrail) {
    const { lockMinProfitAt, trailMinProfitBy } = overall.lockAndTrail;
    if (state.mtmPeak >= lockMinProfitAt) {
      const steps = Math.floor((state.mtmPeak - lockMinProfitAt) / trailMinProfitBy);
      const floor = lockMinProfitAt + steps * trailMinProfitBy;
      state.mtmTrailFloor =
        state.mtmTrailFloor === null ? floor : Math.max(state.mtmTrailFloor, floor);
    }
  } else if (overall.trailing) {
    const { trailEvery, trailBy } = overall.trailing;
    if (state.mtmPeak > 0) {
      const steps = Math.floor(state.mtmPeak / trailEvery);
      const floor = steps * trailBy;
      state.mtmTrailFloor =
        state.mtmTrailFloor === null ? floor : Math.max(state.mtmTrailFloor, floor);
    }
  }

  let breach: "mtm-sl" | "mtm-target" | null = null;
  if (
    overall.stopLoss &&
    overall.stopLoss.unit === "rupees" &&
    mtm <= -Math.abs(overall.stopLoss.value) + EPS
  ) {
    breach = "mtm-sl";
  }
  if (overall.maxLossRupees && mtm <= -Math.abs(overall.maxLossRupees) + EPS) {
    breach = "mtm-sl"; // min(mtmSl, maxLoss) wins → either triggers an SL exit
  }
  if (
    overall.target &&
    overall.target.unit === "rupees" &&
    mtm >= Math.abs(overall.target.value) - EPS
  ) {
    breach = breach ?? "mtm-target";
  }
  if (
    state.mtmTrailFloor !== null &&
    mtm <= state.mtmTrailFloor + EPS &&
    state.mtmPeak > state.mtmTrailFloor
  ) {
    breach = breach ?? "mtm-sl";
  }

  if (breach) {
    // Square off ALL open legs at the current bar close (conservative; threshold
    // crossed intrabar so we don't wait for next-bar open here). An overall-MTM
    // breach is an intraday market exit → LTP settlement, never exercise.
    for (const ol of [...state.legs]) {
      bookExit(state, ctx, ol, ol.lastMark, b.ts, mod, breach, "ltp");
    }
    state.legs = [];
    state.exitReason = breach;
    return true;
  }
  return false;
}

/** Current strategy MTM (rupees) = Σ unrealized(open) + Σ realized(closed). */
function strategyMtm(state: DayState): number {
  let mtm = 0;
  for (const ol of state.legs) {
    mtm +=
      ol.direction === "long"
        ? ol.qty * (ol.lastMark - ol.entryFill)
        : ol.qty * (ol.entryFill - ol.lastMark);
  }
  for (const ol of state.closed) {
    for (const bl of ol.booked) mtm += bl.net;
  }
  return mtm;
}

/** Ratchet per-leg trailing SLs toward profit (never back) (§5.1). */
function updateTrailing(legs: OpenLeg[]): void {
  for (const ol of legs) {
    const ts = ol.leg.trailingStop;
    if (!ts || ol.slLevel === null || ol.trailAnchor === null) continue;
    // Favourable move = price moving toward profit. For a short, favour = price
    // FALLING below the anchor; for a long, price RISING above the anchor.
    const fav =
      ol.direction === "short" ? ol.trailAnchor - ol.lastMark : ol.lastMark - ol.trailAnchor;
    const everyAbs = ts.unit === "pct" ? ol.entryFill * (ts.trailEvery / 100) : ts.trailEvery;
    const byAbs = ts.unit === "pct" ? ol.entryFill * (ts.trailBy / 100) : ts.trailBy;
    if (everyAbs <= 0) continue;
    const steps = Math.floor(fav / everyAbs);
    if (steps >= 1) {
      // Move SL toward profit by steps×byAbs; reset anchor.
      const move = steps * byAbs;
      const newSl = ol.direction === "short" ? ol.slLevel - move : ol.slLevel + move;
      // SL only moves toward profit.
      ol.slLevel =
        ol.direction === "short" ? Math.min(ol.slLevel, newSl) : Math.max(ol.slLevel, newSl);
      ol.trailAnchor =
        ol.direction === "short"
          ? ol.trailAnchor - steps * everyAbs
          : ol.trailAnchor + steps * everyAbs;
    }
  }
}

/** True if any closed leg still has a pending re-entry (loop-continue guard). */
function hasReentryBudget(state: DayState): boolean {
  return state.closed.some((ol) => ol.pendingReentry);
}

/**
 * Re-entry (§6). A leg squared on a PRIOR bar (pendingReentry) re-enters at the
 * NEXT available bar's open (RE_ASAP), or when its trigger is met (RE_COST /
 * RE_MOMENTUM). Each re-entry is a distinct booked round-trip. Fills on a bar
 * strictly after the exit bar to honour next-bar-open semantics (§3.1).
 */
function maybeReenter(state: DayState, ctx: ReplayCtx, b: Bar, mod: number): void {
  const re = state.closed.filter((ol) => ol.pendingReentry && ol.lastExitTs < b.ts);
  for (const ol of re) {
    const cfg = ol.leg.reEntry!;
    if (ol.reentries >= cfg.maxCount) {
      ol.pendingReentry = false;
      continue;
    }
    if (cfg.stopAfter && mod >= hhmmToMin(cfg.stopAfter)) {
      ol.pendingReentry = false;
      continue;
    }

    const optBar = ol.bars.get(mod);
    if (!optBar) continue;

    let cleanEntry: number | null = null;
    if (cfg.mode === "RE_ASAP") {
      cleanEntry = optBar.o; // re-enter same resolved strike at next available open
    } else if (cfg.mode === "RE_COST") {
      // Re-enter once the price returns to the original entry fill.
      const touchesCost = optBar.l - EPS <= ol.entryFill && ol.entryFill <= optBar.h + EPS;
      if (touchesCost) cleanEntry = ol.entryFill;
    } else if (cfg.mode === "RE_MOMENTUM") {
      const m = cfg.momentum;
      if (m) {
        const thresh = m.unit === "pct" ? ol.entryFill * (m.value / 100) : m.value;
        const favMove =
          ol.direction === "short" ? ol.entryFill - optBar.c : optBar.c - ol.entryFill;
        if (favMove >= thresh) cleanEntry = optBar.c;
      }
    }
    if (cleanEntry === null) continue;

    const { fill: entryFill, illiquid } = applySlippage(cleanEntry, ctx.slip, {
      side: ol.direction === "long" ? "buy" : "sell",
      coverage: ol.resolution.coverage,
      barVolume: optBar.v,
    });
    void illiquid;
    state.turnover = r2(state.turnover + entryFill * ol.qty);

    state.legs.push({
      leg: ol.leg,
      direction: ol.direction,
      optionType: ol.optionType,
      qty: ol.qty,
      strike: ol.strike,
      resolution: ol.resolution,
      entryFill,
      lastMark: cleanEntry,
      staleMarks: 0,
      slLevel: computeRiskLevel(ol.leg.stopLoss, ol.direction, "sl", entryFill),
      targetLevel: computeRiskLevel(ol.leg.target, ol.direction, "target", entryFill),
      trailAnchor: ol.leg.trailingStop ? entryFill : null,
      bars: ol.bars,
      reentries: ol.reentries + 1,
      booked: [], // its own booking record; the prior round-trip stays in `closed`
      lastExitTs: -1,
      pendingReentry: false,
      enteredAt: mod,
      legExitMin: ol.legExitMin, // re-entry inherits the parent leg's exit cap
    });
    // Consume the prior cycle's re-entry; it stays in `closed` so its booked
    // round-trip is collected at EOD.
    ol.pendingReentry = false;
  }
}

/**
 * Force-square every open leg at `mod` (§7.1). NON-expiry / OTM legs settle at
 * the LAST TRADED price (invariant 4); an expiry-day ITM LONG is EXERCISE-settled
 * at intrinsic and carries the exercise STT (BT fix #1). The settlement decision
 * is per-leg via settleLegAt.
 */
function forceSquareOff(
  state: DayState,
  ctx: ReplayCtx,
  mod: number,
  reason: string,
  isExpiryDay: boolean,
  settlementSpot: number | null
): void {
  for (const ol of [...state.legs]) {
    settleLegAt(state, ctx, ol, mod, reason, isExpiryDay, settlementSpot);
  }
  state.legs = [];
  if (state.exitReason === "time" && reason !== "time") state.exitReason = reason;
}

function lastTs(ol: OpenLeg, mod: number): number {
  const bar = ol.bars.get(mod);
  return bar ? bar.ts : ol.bars.size ? [...ol.bars.values()][0]!.ts : 0;
}

/**
 * Book a leg exit: apply adverse exit slippage, compute gross via computeGrossPnl,
 * charge ONE computeCharges round-trip, and push a BookedLeg. Moves the leg into
 * state.closed.
 *
 * `settlement` selects the charge basis (BT fix #1): "ltp" is the ordinary OPT
 * premium round-trip (sell-side STT); "exercise" is an expiry-day intrinsic
 * settlement of a net-long ITM option — NO slippage on the settlement (it is a
 * mechanical settle, not a market trade), the 0.125% exercise STT replaces the
 * premium-sell STT, and exitPrice is the intrinsic settlement value so gross P&L
 * is correct.
 */
function bookExit(
  state: DayState,
  ctx: ReplayCtx,
  ol: OpenLeg,
  cleanExit: number,
  exitTs: number,
  mod: number,
  reason: string,
  settlement: "ltp" | "exercise"
): void {
  void reason;
  const isExercise = settlement === "exercise";
  // Exercise settlement is mechanical (no market fill) → no exit slippage. A
  // normal market square-off slips adversely.
  let exitFill: number;
  if (isExercise) {
    exitFill = r2(cleanExit);
  } else {
    const exitBar = ol.bars.get(mod);
    exitFill = applySlippage(cleanExit, ctx.slip, {
      side: fillExitSide(ol.direction),
      coverage: ol.resolution.coverage,
      barVolume: exitBar ? exitBar.v : 0,
    }).fill;
  }
  state.turnover = r2(state.turnover + exitFill * ol.qty);

  const gross = computeGrossPnl({
    direction: ol.direction,
    qty: ol.qty,
    entryPrice: ol.entryFill,
    exitPrice: exitFill,
  });
  const charges = computeCharges(ctx.profile, {
    segment: "OPT",
    product: "MIS",
    orders: 2,
    direction: ol.direction,
    entryPrice: ol.entryFill,
    exitPrice: exitFill,
    qty: ol.qty,
    // Exercise STT (the "STT trap"): 0.125% of the intrinsic settlement notional.
    ...(isExercise ? { exercise: { intrinsicNotional: exitFill * ol.qty } } : {}),
  }).total;
  const net = r2(gross - charges);

  const booked: BookedLeg = {
    legId: ol.leg.id,
    optionType: ol.optionType,
    side: ol.leg.side,
    qty: ol.qty,
    resolution: ol.resolution as RRStrikeResolution,
    entryPrice: ol.entryFill,
    exitPrice: exitFill,
    gross,
    charges,
    net,
    reentries: ol.reentries,
    settlement,
  };
  ol.booked.push(booked);
  ol.lastExitTs = exitTs;
  // Eligible to re-enter on a LATER bar if the leg has budget and this was not an
  // EOD/time square-off (those end the day).
  const re = ol.leg.reEntry;
  ol.pendingReentry =
    !!re &&
    re.mode !== "NONE" &&
    ol.reentries < re.maxCount &&
    reason !== "time" &&
    reason !== "eod";
  state.closed.push(ol);
  state.exitTs = Math.max(state.exitTs, exitTs);
}

/** A skipped/excluded day's empty blotter row. */
function emptyRow(day: string): BlotterRow {
  const ts = dayKeyToEpochMs(day);
  return {
    day,
    entryTs: ts,
    exitTs: ts,
    legs: [],
    gross: 0,
    charges: 0,
    net: 0,
    substituted: false,
    flags: ["MISSING_LEG"],
  };
}
