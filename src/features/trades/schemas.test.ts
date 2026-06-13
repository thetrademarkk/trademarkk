import { describe, expect, it } from "vitest";
import {
  isDerivativeSegment,
  productsForSegment,
  tradeFormSchema,
  type TradeFormValues,
} from "./schemas";

const base: TradeFormValues = {
  accountId: "acc1",
  symbol: "RELIANCE",
  segment: "EQ",
  product: "MIS",
  direction: "long",
  qty: 10,
  avgEntry: 2500,
  openedAt: "2026-06-12T10:15",
  tagIds: [],
};

describe("productsForSegment", () => {
  it("EQ offers MIS / CNC / BTST / STBT", () => {
    expect(productsForSegment("EQ")).toEqual(["MIS", "CNC", "BTST", "STBT"]);
  });
  it("derivatives offer MIS / NRML", () => {
    for (const s of ["FUT", "OPT", "COMM", "CDS"]) {
      expect(productsForSegment(s)).toEqual(["MIS", "NRML"]);
    }
  });
});

describe("isDerivativeSegment", () => {
  it("FUT/OPT/COMM/CDS are derivatives; EQ is not", () => {
    expect(isDerivativeSegment("FUT")).toBe(true);
    expect(isDerivativeSegment("OPT")).toBe(true);
    expect(isDerivativeSegment("COMM")).toBe(true);
    expect(isDerivativeSegment("CDS")).toBe(true);
    expect(isDerivativeSegment("EQ")).toBe(false);
  });
});

describe("tradeFormSchema — segment validation", () => {
  it("accepts the widened segments", () => {
    for (const segment of ["EQ", "FUT", "OPT", "COMM", "CDS"] as const) {
      const v = { ...base, segment, product: segment === "EQ" ? "MIS" : "NRML" } as TradeFormValues;
      // OPT needs strike + type, so add them for that case.
      const candidate = segment === "OPT" ? { ...v, strike: 24500, optionType: "CE" as const } : v;
      expect(tradeFormSchema.safeParse(candidate).success).toBe(true);
    }
  });

  it("rejects an unknown segment", () => {
    expect(tradeFormSchema.safeParse({ ...base, segment: "XYZ" }).success).toBe(false);
  });

  it("OPT requires both strike and CE/PE", () => {
    const noStrike = tradeFormSchema.safeParse({
      ...base,
      segment: "OPT",
      product: "NRML",
      optionType: "CE",
    });
    expect(noStrike.success).toBe(false);
    const ok = tradeFormSchema.safeParse({
      ...base,
      segment: "OPT",
      product: "NRML",
      strike: 24500,
      optionType: "PE",
    });
    expect(ok.success).toBe(true);
  });

  it("EQ allows delivery products (CNC/BTST/STBT)", () => {
    for (const product of ["MIS", "CNC", "BTST", "STBT"] as const) {
      expect(tradeFormSchema.safeParse({ ...base, segment: "EQ", product }).success).toBe(true);
    }
  });

  it("derivatives reject equity-only products (CNC/BTST/STBT)", () => {
    expect(tradeFormSchema.safeParse({ ...base, segment: "FUT", product: "CNC" }).success).toBe(
      false
    );
    expect(tradeFormSchema.safeParse({ ...base, segment: "FUT", product: "NRML" }).success).toBe(
      true
    );
  });

  it("EQ rejects a derivative-only product (NRML)", () => {
    expect(tradeFormSchema.safeParse({ ...base, segment: "EQ", product: "NRML" }).success).toBe(
      false
    );
  });

  it("an absent product is allowed (defaults applied downstream)", () => {
    const { product: _drop, ...noProduct } = base;
    void _drop;
    expect(tradeFormSchema.safeParse(noProduct).success).toBe(true);
  });
});
