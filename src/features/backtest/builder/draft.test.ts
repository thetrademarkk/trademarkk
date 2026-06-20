import { describe, expect, it } from "vitest";
import { INDEX_META } from "../shared/instruments";
import { safeParseStrategyDef } from "../shared/strategy-def";
import {
  addLeg,
  applyTemplate,
  defaultRange,
  duplicateLeg,
  makeInitialDraft,
  removeLeg,
  restoreDraft,
  setIndex,
  updateLeg,
} from "./draft";

const today = new Date("2026-06-14T00:00:00Z");

describe("makeInitialDraft", () => {
  it("is a valid, runnable strategy (two at-spot short legs, %-of-spot default)", () => {
    const d = makeInitialDraft(today);
    expect(safeParseStrategyDef(d).success).toBe(true);
    expect(d.legs).toHaveLength(2);
    // The builder defaults to %-of-spot strike selection (pct: 0 = at spot).
    expect(d.legs.every((l) => l.strike.mode === "PERCENT")).toBe(true);
  });

  it("defaults to a 3-month range clamped to the index data start", () => {
    const d = makeInitialDraft(today);
    expect(d.market.dateRange.end).toBe("2026-06-14");
    expect(d.market.dateRange.start).toBe("2026-03-14");
  });
});

describe("defaultRange clamps to per-index data start", () => {
  it("never starts before SENSEX data exists", () => {
    const early = new Date("2022-02-01T00:00:00Z");
    const r = defaultRange("SENSEX", early);
    expect(r.start >= INDEX_META.SENSEX.dataStart).toBe(true);
  });
});

describe("leg operations are pure (return new drafts)", () => {
  it("addLeg appends a blank leg (capped at 8)", () => {
    let d = makeInitialDraft(today);
    const before = d.legs.length;
    d = addLeg(d);
    expect(d.legs).toHaveLength(before + 1);
    // Fill to the cap and confirm it stops at 8.
    while (d.legs.length < 8) d = addLeg(d);
    const capped = addLeg(d);
    expect(capped.legs).toHaveLength(8);
  });

  it("duplicateLeg clones with a fresh id right after the source", () => {
    const d = makeInitialDraft(today);
    const srcId = d.legs[0]!.id;
    const dup = duplicateLeg(d, srcId);
    expect(dup.legs).toHaveLength(3);
    expect(dup.legs[1]!.id).not.toBe(srcId);
    expect(dup.legs[1]!.optionType).toBe(d.legs[0]!.optionType);
  });

  it("removeLeg keeps at least one leg", () => {
    let d = makeInitialDraft(today);
    d = removeLeg(d, d.legs[0]!.id);
    expect(d.legs).toHaveLength(1);
    const stillOne = removeLeg(d, d.legs[0]!.id);
    expect(stillOne.legs).toHaveLength(1);
  });

  it("updateLeg patches one leg only", () => {
    const d = makeInitialDraft(today);
    const id = d.legs[0]!.id;
    const next = updateLeg(d, id, { lots: 5 });
    expect(next.legs[0]!.lots).toBe(5);
    expect(next.legs[1]!.lots).toBe(d.legs[1]!.lots);
  });
});

describe("applyTemplate", () => {
  it("replaces legs with the iron condor's 4 legs and records the templateId", () => {
    const d = applyTemplate(makeInitialDraft(today), "iron-condor");
    expect(d.legs).toHaveLength(4);
    expect(d.name).toBe("Iron Condor");
    expect(d.meta?.templateId).toBe("iron-condor");
    expect(safeParseStrategyDef(d).success).toBe(true);
  });

  it("is a no-op for an unknown template", () => {
    const d = makeInitialDraft(today);
    expect(applyTemplate(d, "does-not-exist").legs).toEqual(d.legs);
  });
});

describe("setIndex re-clamps the range to the new index data start", () => {
  it("pulls a too-early start forward when switching to SENSEX", () => {
    let d = makeInitialDraft(today);
    d = { ...d, market: { ...d.market, dateRange: { start: "2021-01-01", end: "2026-06-14" } } };
    const next = setIndex(d, "SENSEX");
    expect(next.market.symbol).toBe("SENSEX");
    expect(next.market.dateRange.start >= INDEX_META.SENSEX.dataStart).toBe(true);
  });
});

describe("restoreDraft — autosave/restore safety net", () => {
  it("round-trips a valid persisted draft byte-for-byte", () => {
    const d = makeInitialDraft(today);
    const restored = restoreDraft(JSON.parse(JSON.stringify(d)), today);
    expect(restored).toEqual(d);
  });

  it("falls back to a fresh draft on garbage input (never crashes)", () => {
    const restored = restoreDraft({ totally: "broken" }, today);
    expect(safeParseStrategyDef(restored).success).toBe(true);
    expect(restored.legs.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back on null/undefined", () => {
    expect(safeParseStrategyDef(restoreDraft(undefined, today)).success).toBe(true);
    expect(safeParseStrategyDef(restoreDraft(null, today)).success).toBe(true);
  });
});
