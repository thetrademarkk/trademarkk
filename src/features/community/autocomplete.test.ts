import { describe, expect, it } from "vitest";
import { completeToken, detectActiveToken, matchSymbols, normalizeCashtag } from "./autocomplete";
import { COMMON_SYMBOLS, isKnownSymbol } from "./symbols";

describe("detectActiveToken — caret at end of text", () => {
  it("detects a mention being typed", () => {
    const t = "hey @as";
    expect(detectActiveToken(t, t.length)).toEqual({
      kind: "user",
      query: "as",
      start: 4,
      end: 7,
    });
  });

  it("detects a bare trigger with an empty query", () => {
    const t = "hello @";
    expect(detectActiveToken(t, t.length)).toEqual({ kind: "user", query: "", start: 6, end: 7 });
  });

  it("detects a hashtag", () => {
    const t = "great #set";
    expect(detectActiveToken(t, t.length)).toMatchObject({ kind: "tag", query: "set" });
  });

  it("detects a cashtag and preserves its case (uppercased only on insert)", () => {
    const t = "watch $ni";
    expect(detectActiveToken(t, t.length)).toMatchObject({ kind: "cashtag", query: "ni" });
  });

  it("triggers at the very start of the text", () => {
    expect(detectActiveToken("@bob", 4)).toMatchObject({ kind: "user", query: "bob", start: 0 });
  });
});

describe("detectActiveToken — mid-text caret", () => {
  it("detects the token the caret sits inside, not later tokens", () => {
    const t = "see $rel and @bob";
    // caret right after "$rel"
    const caret = t.indexOf("$rel") + 4;
    expect(detectActiveToken(t, caret)).toMatchObject({ kind: "cashtag", query: "rel", start: 4 });
  });

  it("detects a token while the caret is partway through it", () => {
    const t = "ping @alice now";
    // caret after "@al"
    const caret = 8;
    const tok = detectActiveToken(t, caret);
    // only the text before the caret matters
    expect(tok).toMatchObject({ kind: "user", query: "al", start: 5, end: 8 });
  });
});

describe("detectActiveToken — non-triggers", () => {
  it("returns null in plain prose", () => {
    expect(detectActiveToken("just some words", 15)).toBeNull();
  });

  it("does not trigger on an email-like a@b (trigger not word-initial)", () => {
    const t = "mail me at john@gmail";
    expect(detectActiveToken(t, t.length)).toBeNull();
  });

  it("does not trigger mid-word (c$h)", () => {
    const t = "ca$h money";
    expect(detectActiveToken(t, "ca$h".length)).toBeNull();
  });

  it("ends the token at a space", () => {
    const t = "@bob ";
    expect(detectActiveToken(t, t.length)).toBeNull();
  });

  it("rejects an over-long runaway query", () => {
    const t = "@" + "a".repeat(25);
    expect(detectActiveToken(t, t.length)).toBeNull();
  });

  it("rejects an illegal body char for the kind (# disallows _)", () => {
    const t = "#has_tag";
    expect(detectActiveToken(t, t.length)).toBeNull();
  });
});

describe("completeToken — insertion at caret", () => {
  it("replaces the typed token with @handle + trailing space", () => {
    const t = "hey @as";
    const tok = detectActiveToken(t, t.length)!;
    expect(completeToken(t, tok, "ashok_t")).toEqual({ text: "hey @ashok_t ", caret: 13 });
  });

  it("inserts mid-text without disturbing the trailing words", () => {
    const t = "see $ni and done";
    const caret = t.indexOf("$ni") + 3;
    const tok = detectActiveToken(t, caret)!;
    const { text, caret: c } = completeToken(t, tok, "NIFTY");
    expect(text).toBe("see $NIFTY and done");
    expect(text[c - 1]).toBe(" "); // caret lands after the inserted trailing space
    expect(text.slice(c)).toBe("and done");
  });

  it("completes a hashtag", () => {
    const t = "love #op";
    const tok = detectActiveToken(t, t.length)!;
    expect(completeToken(t, tok, "options")).toEqual({ text: "love #options ", caret: 14 });
  });
});

describe("normalizeCashtag", () => {
  it("uppercases and trims", () => {
    expect(normalizeCashtag(" nifty ")).toBe("NIFTY");
    expect(normalizeCashtag("bajaj-auto")).toBe("BAJAJ-AUTO");
  });
});

describe("matchSymbols — prefix match", () => {
  it("matches indices by prefix", () => {
    const out = matchSymbols("ni").map((s) => s.symbol);
    expect(out).toContain("NIFTY");
  });

  it("is case-insensitive", () => {
    expect(matchSymbols("BANK").map((s) => s.symbol)).toContain("BANKNIFTY");
    expect(matchSymbols("bank").map((s) => s.symbol)).toContain("BANKNIFTY");
  });

  it("respects the cap", () => {
    expect(matchSymbols("", 3)).toHaveLength(3);
    expect(matchSymbols("a", 100).length).toBeGreaterThan(0);
  });

  it("returns a starter set for an empty query (indices first)", () => {
    expect(matchSymbols("")[0]!.symbol).toBe("NIFTY");
  });

  it("returns nothing for a non-matching prefix", () => {
    expect(matchSymbols("ZZZZZQQ")).toHaveLength(0);
  });
});

describe("symbols list", () => {
  it("is uppercase and de-duplicated", () => {
    expect(COMMON_SYMBOLS.length).toBe(new Set(COMMON_SYMBOLS).size);
    for (const s of COMMON_SYMBOLS) expect(s).toBe(s.toUpperCase());
  });

  it("contains the core indices", () => {
    for (const idx of ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"]) {
      expect(isKnownSymbol(idx)).toBe(true);
    }
  });

  it("isKnownSymbol is case-insensitive and false for unknowns", () => {
    expect(isKnownSymbol("reliance")).toBe(true);
    expect(isKnownSymbol("NOTASYMBOL")).toBe(false);
  });
});
