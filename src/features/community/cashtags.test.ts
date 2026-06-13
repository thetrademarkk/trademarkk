import { describe, expect, it } from "vitest";
import { diffCashtags, extractCashtags, MAX_POST_CASHTAGS, planSymbolSync } from "./cashtags";
import { isKnownSymbol, lookupSymbol, normalizeSymbol, SYMBOL_MASTER } from "./symbols";

describe("extractCashtags", () => {
  it("extracts a simple cashtag, uppercased", () => {
    expect(extractCashtags("watching $nifty today")).toEqual(["NIFTY"]);
  });

  it("extracts multiple distinct cashtags in first-seen order", () => {
    expect(extractCashtags("$RELIANCE vs $tcs — both green")).toEqual(["RELIANCE", "TCS"]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(extractCashtags("$nifty $NIFTY $Nifty")).toEqual(["NIFTY"]);
  });

  it("triggers only word-initially (mid-word ca$h never matches)", () => {
    expect(extractCashtags("got ca$h money")).toEqual([]);
  });

  it("matches a cashtag at the very start of the text", () => {
    expect(extractCashtags("$banknifty ripped")).toEqual(["BANKNIFTY"]);
  });

  it("allows & and - in the body (M&M, BAJAJ-AUTO)", () => {
    expect(extractCashtags("long $m&m and $bajaj-auto")).toEqual(["M&M", "BAJAJ-AUTO"]);
  });

  it("keeps free-entered (unknown) tickers", () => {
    const out = extractCashtags("$ZZZNEWCO is a punt");
    expect(out).toEqual(["ZZZNEWCO"]);
    expect(isKnownSymbol("ZZZNEWCO")).toBe(false);
  });

  it("ignores a lone $ and an over-long token", () => {
    expect(extractCashtags("just $ and $" + "A".repeat(25))).toEqual([]);
  });

  it("caps at MAX_POST_CASHTAGS distinct symbols", () => {
    const body = Array.from({ length: MAX_POST_CASHTAGS + 5 }, (_, i) => `$SYM${i}`).join(" ");
    expect(extractCashtags(body)).toHaveLength(MAX_POST_CASHTAGS);
  });

  it("returns [] for plain prose", () => {
    expect(extractCashtags("no tickers here, just words")).toEqual([]);
  });
});

describe("diffCashtags — edit add/remove", () => {
  it("reports an added symbol on edit", () => {
    const d = diffCashtags("$nifty", "$nifty $reliance");
    expect(d.added).toEqual(["RELIANCE"]);
    expect(d.removed).toEqual([]);
    expect(d.next).toEqual(["NIFTY", "RELIANCE"]);
  });

  it("reports a removed symbol on edit", () => {
    const d = diffCashtags("$nifty $reliance", "$nifty");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual(["RELIANCE"]);
    expect(d.next).toEqual(["NIFTY"]);
  });

  it("reports both an add and a remove", () => {
    const d = diffCashtags("$nifty $reliance", "$nifty $tcs");
    expect(d.added).toEqual(["TCS"]);
    expect(d.removed).toEqual(["RELIANCE"]);
  });

  it("no change → empty add/remove", () => {
    const d = diffCashtags("$nifty $tcs", "$NIFTY $TCS still");
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});

describe("planSymbolSync — post_symbols upsert plan", () => {
  it("on create (no existing rows) adds every cashtag, removes none", () => {
    const p = planSymbolSync([], "long $nifty and $reliance");
    expect(p.toAdd).toEqual(["NIFTY", "RELIANCE"]);
    expect(p.toRemove).toEqual([]);
  });

  it("edit-add: only the newly-introduced symbol is inserted", () => {
    const p = planSymbolSync(["NIFTY"], "$nifty plus $reliance");
    expect(p.toAdd).toEqual(["RELIANCE"]);
    expect(p.toRemove).toEqual([]);
  });

  it("edit-remove: a dropped symbol is deleted, kept ones untouched", () => {
    const p = planSymbolSync(["NIFTY", "RELIANCE"], "just $nifty now");
    expect(p.toAdd).toEqual([]);
    expect(p.toRemove).toEqual(["RELIANCE"]);
  });

  it("edit add+remove together", () => {
    const p = planSymbolSync(["NIFTY", "RELIANCE"], "$nifty and $tcs");
    expect(p.toAdd).toEqual(["TCS"]);
    expect(p.toRemove).toEqual(["RELIANCE"]);
  });

  it("no-op when the body is unchanged (case/whitespace aside)", () => {
    const p = planSymbolSync(["NIFTY", "TCS"], "  $NIFTY  $tcs  ");
    expect(p.toAdd).toEqual([]);
    expect(p.toRemove).toEqual([]);
  });

  it("removing the last cashtag clears the join", () => {
    const p = planSymbolSync(["NIFTY"], "no tickers anymore");
    expect(p.toAdd).toEqual([]);
    expect(p.toRemove).toEqual(["NIFTY"]);
  });

  it("normalizes existing rows to uppercase before diffing", () => {
    const p = planSymbolSync(["nifty"], "$NIFTY");
    expect(p.toAdd).toEqual([]);
    expect(p.toRemove).toEqual([]);
  });
});

describe("symbol master — normalize / lookup", () => {
  it("normalizeSymbol strips $, trims and uppercases", () => {
    expect(normalizeSymbol(" $nifty ")).toBe("NIFTY");
    expect(normalizeSymbol("bajaj-auto")).toBe("BAJAJ-AUTO");
    expect(normalizeSymbol("$$tcs")).toBe("TCS");
    expect(normalizeSymbol("   ")).toBe("");
  });

  it("lookupSymbol returns enriched info for a known index", () => {
    const info = lookupSymbol("nifty");
    expect(info).toMatchObject({ symbol: "NIFTY", exchange: "NSE" });
    expect(info?.name).toBeTruthy();
  });

  it("lookupSymbol resolves a known BSE index with its exchange", () => {
    expect(lookupSymbol("$sensex")?.exchange).toBe("BSE");
  });

  it("lookupSymbol returns null for an unknown ticker", () => {
    expect(lookupSymbol("ZZZNOTREAL")).toBeNull();
  });

  it("master is non-trivial, uppercase and de-duplicated", () => {
    expect(SYMBOL_MASTER.length).toBeGreaterThan(200);
    const symbols = SYMBOL_MASTER.map((s) => s.symbol);
    expect(symbols.length).toBe(new Set(symbols).size);
    for (const s of SYMBOL_MASTER) {
      expect(s.symbol).toBe(s.symbol.toUpperCase());
      expect(s.name.length).toBeGreaterThan(0);
      expect(["NSE", "BSE"]).toContain(s.exchange);
    }
  });

  it("indices come first in the master", () => {
    expect(SYMBOL_MASTER[0]?.symbol).toBe("NIFTY");
  });
});
