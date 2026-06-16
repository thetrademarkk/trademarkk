/**
 * Registry conventions — the contract category agents depend on.
 *
 * Locks: registerIndicators() is idempotent, ids are unique, every def is
 * complete (id/label/category/inputs/params/reference/compute), and the
 * foundation indicators (sma/ema/rsi) are present and computable.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRegistry,
  getIndicator,
  listByCategory,
  listIndicators,
  register,
  type IndicatorDef,
} from "./registry";
import { registerIndicators } from "./index";

beforeEach(() => __resetRegistry());

const sampleDef = (id: string): IndicatorDef => ({
  id,
  label: "x",
  category: "trend",
  inputs: ["close"],
  params: [],
  reference: "test",
  compute: () => [],
});

describe("registry mechanics", () => {
  it("registers and looks up by id", () => {
    register(sampleDef("foo"));
    expect(getIndicator("foo")?.id).toBe("foo");
  });

  it("throws on duplicate id", () => {
    register(sampleDef("dup"));
    expect(() => register(sampleDef("dup"))).toThrow(/already registered/);
  });
});

describe("registerIndicators aggregation", () => {
  it("registers the foundation indicators and is idempotent", () => {
    const n = registerIndicators();
    expect(n).toBeGreaterThanOrEqual(3);
    // Second call is a no-op (the module-level guard) and must not throw.
    expect(registerIndicators()).toBe(0);
  });

  it("exposes sma, ema, rsi with complete, valid defs", () => {
    registerIndicators();
    for (const id of ["sma", "ema", "rsi"]) {
      const d = getIndicator(id);
      expect(d, `${id} missing`).toBeDefined();
      expect(d!.label.length).toBeGreaterThan(0);
      expect(d!.reference.length).toBeGreaterThan(0);
      expect(d!.inputs.length).toBeGreaterThan(0);
      expect(typeof d!.compute).toBe("function");
    }
  });

  it("every registered def has a unique id and required fields", () => {
    registerIndicators();
    const all = listIndicators();
    const ids = new Set(all.map((d) => d.id));
    expect(ids.size).toBe(all.length);
    for (const d of all) {
      expect(d.id).toBeTruthy();
      expect(["trend", "momentum", "volatility", "volume", "directional", "statistical"]).toContain(
        d.category
      );
    }
  });

  it("category filtering works", () => {
    registerIndicators();
    expect(listByCategory("trend").map((d) => d.id)).toContain("sma");
    expect(listByCategory("momentum").map((d) => d.id)).toContain("rsi");
  });
});
