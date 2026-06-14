import { describe, expect, it } from "vitest";
import {
  STRATEGY_SCHEMA_VERSION,
  makeDefaultStrategy,
  parseStrategyDef,
  safeParseStrategyDef,
  strikeSelectorSchema,
  validateExactStrike,
  type StrategyDef,
} from "./strategy-def";

describe("makeDefaultStrategy + round-trip", () => {
  it("produces a valid, parseable strategy", () => {
    const s = makeDefaultStrategy("s1", "NIFTY");
    expect(s.schemaVersion).toBe(STRATEGY_SCHEMA_VERSION);
    const parsed = parseStrategyDef(s);
    // Full zod round-trip: parse(serialize(parse(x))) is stable.
    expect(parseStrategyDef(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("defaults a single ATM sell-put leg", () => {
    const s = makeDefaultStrategy("s1");
    expect(s.legs).toHaveLength(1);
    expect(s.legs[0]!.strike).toEqual({ mode: "ATM_OFFSET", steps: 0 });
    expect(s.legs[0]!.side).toBe("sell");
  });
});

describe("StrikeSelector discriminated union", () => {
  it("accepts each valid mode", () => {
    expect(strikeSelectorSchema.parse({ mode: "ATM_OFFSET", steps: 2 }).mode).toBe("ATM_OFFSET");
    expect(strikeSelectorSchema.parse({ mode: "PERCENT", pct: -1.5 }).mode).toBe("PERCENT");
    expect(strikeSelectorSchema.parse({ mode: "PREMIUM", target: 40 }).mode).toBe("PREMIUM");
    expect(strikeSelectorSchema.parse({ mode: "EXACT", strike: 24800 }).mode).toBe("EXACT");
  });

  it("DELTA is deferred (D7) — rejected by the union", () => {
    expect(strikeSelectorSchema.safeParse({ mode: "DELTA", target: 0.2 }).success).toBe(false);
  });

  it("enforces per-mode ranges", () => {
    expect(strikeSelectorSchema.safeParse({ mode: "ATM_OFFSET", steps: 21 }).success).toBe(false);
    expect(strikeSelectorSchema.safeParse({ mode: "ATM_OFFSET", steps: 1.5 }).success).toBe(false);
    expect(strikeSelectorSchema.safeParse({ mode: "PERCENT", pct: 20 }).success).toBe(false);
    expect(strikeSelectorSchema.safeParse({ mode: "PREMIUM", target: -1 }).success).toBe(false);
  });

  it("rejects a premium band where min > max", () => {
    const bad = { mode: "PREMIUM", target: 40, band: { min: 60, max: 30 } };
    expect(strikeSelectorSchema.safeParse(bad).success).toBe(false);
    const ok = { mode: "PREMIUM", target: 40, band: { min: 30, max: 60 } };
    expect(strikeSelectorSchema.safeParse(ok).success).toBe(true);
  });
});

describe("leg-level validation refinements", () => {
  const base = makeDefaultStrategy("s1");
  function withLeg(patch: Record<string, unknown>): unknown {
    return { ...base, legs: [{ ...base.legs[0]!, ...patch }] };
  }

  it("trailingStop requires a stopLoss", () => {
    const bad = withLeg({
      trailingStop: { unit: "pct", trailEvery: 10, trailBy: 5, toBreakeven: false },
    });
    expect(safeParseStrategyDef(bad).success).toBe(false);

    const ok = withLeg({
      stopLoss: { unit: "pct", basis: "premium", value: 40, refPrice: "traded" },
      trailingStop: { unit: "pct", trailEvery: 10, trailBy: 5, toBreakeven: false },
    });
    expect(safeParseStrategyDef(ok).success).toBe(true);
  });

  it("RE_MOMENTUM requires a momentum threshold", () => {
    const bad = withLeg({ reEntry: { mode: "RE_MOMENTUM", maxCount: 2 } });
    expect(safeParseStrategyDef(bad).success).toBe(false);

    const ok = withLeg({
      reEntry: { mode: "RE_MOMENTUM", maxCount: 2, momentum: { unit: "pts", value: 20 } },
    });
    expect(safeParseStrategyDef(ok).success).toBe(true);
  });

  it("rejects underlying-basis triggers (engine marks off premium only)", () => {
    // The engine's computeRiskLevel never branches on basis — an underlying-basis
    // SL/Target would be silently computed in premium space, so we reject it until
    // spot-referenced stops are implemented (the enum value stays for forward-compat).
    const badSl = withLeg({
      stopLoss: { unit: "pts", basis: "underlying", value: 50, refPrice: "traded" },
    });
    const slRes = safeParseStrategyDef(badSl);
    expect(slRes.success).toBe(false);
    if (!slRes.success) {
      expect(slRes.error.issues.some((i) => /Underlying-basis/.test(i.message))).toBe(true);
    }

    const badTarget = withLeg({
      target: { unit: "pct", basis: "underlying", value: 30, refPrice: "traded" },
    });
    expect(safeParseStrategyDef(badTarget).success).toBe(false);

    // Premium basis still passes for both SL and target.
    const ok = withLeg({
      stopLoss: { unit: "pct", basis: "premium", value: 40, refPrice: "traded" },
      target: { unit: "pct", basis: "premium", value: 30, refPrice: "traded" },
    });
    expect(safeParseStrategyDef(ok).success).toBe(true);
  });
});

describe("strategy-level constraints", () => {
  it("requires 1..8 legs", () => {
    const s = makeDefaultStrategy("s1");
    expect(safeParseStrategyDef({ ...s, legs: [] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ ...s.legs[0]!, id: `l${i}` }));
    expect(safeParseStrategyDef({ ...s, legs: nine }).success).toBe(false);
  });

  it("requires entryTime < exitTime", () => {
    const s = makeDefaultStrategy("s1");
    const bad = { ...s, timing: { ...s.timing, entryTime: "15:20", exitTime: "09:20" } };
    expect(safeParseStrategyDef(bad).success).toBe(false);
  });

  it("requires dateRange start <= end", () => {
    const s = makeDefaultStrategy("s1");
    const bad = {
      ...s,
      market: { ...s.market, dateRange: { start: "2024-06-10", end: "2024-06-01" } },
    };
    expect(safeParseStrategyDef(bad).success).toBe(false);
  });

  it("rejects a bad HH:mm time format", () => {
    const s = makeDefaultStrategy("s1");
    const bad = { ...s, timing: { ...s.timing, entryTime: "9:20" } };
    expect(safeParseStrategyDef(bad).success).toBe(false);
  });

  it("applies zod defaults for optional fields", () => {
    const s = makeDefaultStrategy("s1");
    const parsed: StrategyDef = parseStrategyDef(s);
    expect(parsed.legs[0]!.squareOff).toBe("partial");
    expect(parsed.execution.fillModel).toBe("candle_close");
    expect(parsed.risk.reEntryOnOverall).toBe(false);
  });
});

describe("validateExactStrike", () => {
  it("rejects an off-grid exact strike for the index", () => {
    const s = makeDefaultStrategy("s1", "NIFTY");
    const leg = { ...s.legs[0]!, strike: { mode: "EXACT" as const, strike: 24825 } };
    expect(validateExactStrike("NIFTY", leg)).toMatch(/multiple of 50/);
    const ok = { ...s.legs[0]!, strike: { mode: "EXACT" as const, strike: 24800 } };
    expect(validateExactStrike("NIFTY", ok)).toBeNull();
  });

  it("is null for non-exact strikes", () => {
    const s = makeDefaultStrategy("s1");
    expect(validateExactStrike("NIFTY", s.legs[0]!)).toBeNull();
  });
});
