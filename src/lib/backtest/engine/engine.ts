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
import { expiryFor, tradingDays, tradingDaysToExpiry } from "../calendar/market-calendar";
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
    for (const f of row.flags) flags.add(f);

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
  // Spot for resolution = the entry bar's open (time entry, §8.2).
  const spot = entryBar.o;
  const entryMinute = minuteOfDayIST(entryBar.ts);

  // Resolve + open every enabled leg at the entry bar.
  const open: OpenLeg[] = [];
  let substituted = false;
  let dayLowLiquidity = false;
  let turnover = 0;

  for (const leg of enabledLegs) {
    const direction = toDirection(leg.side);
    const qty = leg.lots * LOT_SIZE[index];
    const intent = toIntent(leg);

    let resolution: StrikeResolution | null;
    if (intent.kind === "premium") {
      // Premium needs entry-bar option prices across the chain.
      const prices = new Map<number, number>();
      for (const c of dd.chain) {
        if (c.optionType !== leg.optionType) continue;
        const s = dd.option(c.strike, leg.optionType);
        const bar = s.find((b) => minuteOfDayIST(b.ts) === entryMinute) ?? s[0];
        if (bar) prices.set(c.strike, bar.o);
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
      // A required leg cannot resolve → the whole day is excluded (MISSING_LEG).
      return { excluded: true, row: emptyRow(dd.day), inPositionMinutes: 0, turnover: 0 };
    }
    if (resolution.served !== resolution.requested) substituted = true;

    const legBars = indexByMinute(dd.option(resolution.served, leg.optionType));
    // A leg with ZERO real prints all day cannot trade → MISSING_LEG (§7.4).
    if (legBars.size === 0) {
      return { excluded: true, row: emptyRow(dd.day), inPositionMinutes: 0, turnover: 0 };
    }

    // Entry fill = entry bar's open (time entry, §3.1), slipped adversely.
    const entryOptBar = legBars.get(entryMinute);
    const cleanEntry = entryOptBar ? entryOptBar.o : nearestPriorMark(legBars, entryMinute);
    const entryVol = entryOptBar ? entryOptBar.v : 0;
    const { fill: entryFill, illiquid } = applySlippage(cleanEntry, ctx.slip, {
      side: direction === "long" ? "buy" : "sell",
      coverage: resolution.coverage,
      barVolume: entryVol,
    });
    if (illiquid) dayLowLiquidity = true;
    turnover = r2(turnover + entryFill * qty);

    open.push({
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
    });
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
  const squareOffMode = enabledLegs[0]!.squareOff; // partial vs complete (leg-level)

  for (const b of dd.index) {
    const mod = minuteOfDayIST(b.ts);
    if (mod < entryMinute) continue;

    // Stop only when no legs are open AND no leg has re-entry budget left.
    if (state.legs.length === 0 && !hasReentryBudget(state)) break;

    if (state.legs.length > 0) {
      state.inPositionMinutes += 1;
      state.exitTs = b.ts;
    }

    // (0) Mark every open leg from its OWN option close (§2/§3 invariant), with
    // carry-forward for holes.
    markLegs(state.legs, mod);

    // Forced square-off at exit minute or 15:29 (§7.1) — supersedes risk.
    if (mod >= ctx.exitMin) {
      forceSquareOff(state, ctx, mod, "time");
      break;
    }

    // FIXED within-bar order (§5.3), pinned by tests:
    // (1) Per-leg SL / target (intrabar, SL-first tie-break §5.1).
    applyPerLegRisk(state, ctx, b, mod, squareOffMode);

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

  // Any leg still open at end (e.g. exit bar reached via break above already
  // squared; this catches the all-bars-consumed case) → settle at last mark.
  if (state.legs.length > 0) {
    forceSquareOff(state, ctx, EOD_SQUAREOFF_MIN, "eod");
  }

  // ── Book the day ──────────────────────────────────────────────────────────
  const allBooked: BookedLeg[] = [];
  for (const ol of [...state.closed]) allBooked.push(...ol.booked);

  const gross = r2(allBooked.reduce((s, bl) => s + bl.gross, 0));
  const charges = r2(allBooked.reduce((s, bl) => s + bl.charges, 0));
  const net = r2(allBooked.reduce((s, bl) => s + bl.net, 0));

  const rowFlags: RunFlag[] = [];
  if (substituted) rowFlags.push("COVERAGE");
  if (dayLowLiquidity || allBooked.some((bl) => bl.resolution.confidence === "low")) {
    rowFlags.push("LOW_LIQUIDITY");
  }

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

/** Apply per-leg SL/target at minute `mod`, SL-first tie-break (§5.1). */
function applyPerLegRisk(
  state: DayState,
  ctx: ReplayCtx,
  b: Bar,
  mod: number,
  squareOffMode: "partial" | "complete"
): void {
  const survivors: OpenLeg[] = [];
  let anyHit = false;
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
      bookExit(state, ctx, ol, fillClean, b.ts, mod, "leg-sl");
      anyHit = true;
      continue;
    }
    if (tgtHit) {
      const fillClean = gapAwareLevelFill(bar, ol.targetLevel!, ol.direction, "target");
      bookExit(state, ctx, ol, fillClean, b.ts, mod, "leg-target");
      anyHit = true;
      continue;
    }
    survivors.push(ol);
  }

  if (anyHit && squareOffMode === "complete" && survivors.length > 0) {
    // Any per-leg trigger squares the whole strategy at the current bar's close.
    for (const ol of survivors) {
      bookExit(state, ctx, ol, ol.lastMark, b.ts, mod, "leg-sl");
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
    // crossed intrabar so we don't wait for next-bar open here).
    for (const ol of [...state.legs]) {
      bookExit(state, ctx, ol, ol.lastMark, b.ts, mod, breach);
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
    });
    // Consume the prior cycle's re-entry; it stays in `closed` so its booked
    // round-trip is collected at EOD.
    ol.pendingReentry = false;
  }
}

/** Force-square every open leg at `mod` from its last mark (expiry/EOD settles at LTP §2). */
function forceSquareOff(state: DayState, ctx: ReplayCtx, mod: number, reason: string): void {
  for (const ol of [...state.legs]) {
    // Settle at the LAST TRADED price (the square-off bar close / lastMark),
    // NOT intrinsic value (invariant 4).
    const bar = ol.bars.get(mod);
    const clean = bar ? bar.c : ol.lastMark;
    bookExit(state, ctx, ol, clean, lastTs(ol, mod), mod, reason);
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
 * charge ONE computeCharges round-trip (OPT premium-sell branch), and push a
 * BookedLeg. Moves the leg into state.closed.
 */
function bookExit(
  state: DayState,
  ctx: ReplayCtx,
  ol: OpenLeg,
  cleanExit: number,
  exitTs: number,
  mod: number,
  reason: string
): void {
  void reason;
  void mod;
  const exitBar = ol.bars.get(mod);
  const { fill: exitFill } = applySlippage(cleanExit, ctx.slip, {
    side: fillExitSide(ol.direction),
    coverage: ol.resolution.coverage,
    barVolume: exitBar ? exitBar.v : 0,
  });
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
