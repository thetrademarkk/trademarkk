import { describe, expect, it } from "vitest";
import { INDEX_SYMBOLS } from "../shared/instruments";
import { safeParseStrategyDef, validateExactStrike } from "../shared/strategy-def";
import { canAdvance } from "../builder/validation";
import { restoreDraft } from "../builder/draft";
import { buildPayoffSummary } from "../builder/payoff-rail";
import { makeEstimateChain } from "../builder/estimate-chain";
import {
  PRESETS,
  PRESETS_BY_ID,
  PRESET_CATEGORY_ORDER,
  PRESET_INDICES,
  presetById,
} from "./catalogue";
import type { WizardStep } from "../builder/types";

describe("preset catalogue — shape & spread", () => {
  it("ships ~12 founder-vetted presets with unique ids", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(PRESETS.length).toBeLessThanOrEqual(14);
    const ids = PRESETS.map((p) => p.meta.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("spans all three indices", () => {
    const indices = new Set(PRESETS.map((p) => p.meta.index));
    for (const sym of INDEX_SYMBOLS) expect(indices.has(sym)).toBe(true);
    expect(PRESET_INDICES).toEqual([...INDEX_SYMBOLS]);
  });

  it("spans multiple strategy categories", () => {
    const cats = new Set(PRESETS.map((p) => p.meta.category));
    // premium-selling, directional, hedged, volatility, income at minimum
    expect(cats.size).toBeGreaterThanOrEqual(4);
    for (const c of cats) expect(PRESET_CATEGORY_ORDER).toContain(c);
  });

  it("indexes by id and resolves via presetById", () => {
    for (const p of PRESETS) {
      expect(PRESETS_BY_ID[p.meta.id]).toBe(p);
      expect(presetById(p.meta.id)).toBe(p);
    }
    expect(presetById("does-not-exist")).toBeUndefined();
  });
});

describe("every preset is schema-valid (BT-02 zod)", () => {
  for (const preset of PRESETS) {
    it(`${preset.meta.id} → valid StrategyDef`, () => {
      const def = preset.build();
      const parsed = safeParseStrategyDef(def);
      expect(parsed.success).toBe(true);
      // legs in [1,8]; EXACT-strike grid (none used, but assert the guard passes)
      expect(def.legs.length).toBeGreaterThanOrEqual(1);
      expect(def.legs.length).toBeLessThanOrEqual(8);
      for (const leg of def.legs) {
        expect(validateExactStrike(def.market.symbol, leg)).toBeNull();
      }
      // market matches the preset's declared index + a real period span
      expect(def.market.symbol).toBe(preset.meta.index);
      expect(def.market.dateRange.start <= def.market.dateRange.end).toBe(true);
    });
  }
});

describe("every preset hydrates cleanly into the BT-06 builder shape", () => {
  const order: WizardStep[] = ["setup", "legs", "timing", "risk"];
  for (const preset of PRESETS) {
    it(`${preset.meta.id} → restoreDraft round-trips + every wizard step advances`, () => {
      const def = preset.build();
      // restoreDraft is exactly what builder-store.merge uses on load.
      const restored = restoreDraft(JSON.parse(JSON.stringify(def)));
      expect(restored.id).toBe(def.id);
      expect(restored.legs.length).toBe(def.legs.length);
      // The hydrated draft must pass every per-step gate (i.e. it is runnable).
      for (const step of order) expect(canAdvance(step, restored)).toBe(true);
      // And it builds a payoff summary (used by the live rail) without throwing.
      const chain = makeEstimateChain(restored.market.symbol);
      expect(() => buildPayoffSummary(restored, chain)).not.toThrow();
    });
  }
});

describe("presets are EDUCATIONAL examples (no recommendation framing)", () => {
  const banned = ["recommend", "guaranteed", "best trade", "buy now", "you should", "sure profit"];
  for (const preset of PRESETS) {
    it(`${preset.meta.id} copy is descriptive only`, () => {
      const text = [
        preset.meta.title,
        preset.meta.thesis,
        preset.meta.teaches,
        preset.meta.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      for (const phrase of banned) expect(text).not.toContain(phrase);
      // notes embed the "Not a trade recommendation." disclaimer in the def
      const def = preset.build();
      expect((def.notes ?? "").toLowerCase()).toContain("educational example");
    });
  }
});

describe("build() returns a FRESH object each call (no shared refs)", () => {
  it("two builds differ by id and leg ids", () => {
    const a = PRESETS[0]!.build();
    const b = PRESETS[0]!.build();
    expect(a.id).not.toBe(b.id);
    expect(a.legs[0]!.id).not.toBe(b.legs[0]!.id);
    a.legs[0]!.lots = 99;
    expect(b.legs[0]!.lots).not.toBe(99);
  });
});
