import { describe, it, expect } from "vitest";
import {
  parsePrompts,
  serializePrompts,
  hasPromptsBlock,
  EMPTY_PROMPTS,
  type DailyPrompts,
} from "./daily-prompts";

const sample: DailyPrompts = {
  bestTrade: "BANKNIFTY short — waited for the retest.",
  biggestMistake: "Sized up after a loss.",
  emotionalState: "Calm until the last hour.",
  watchlist: "NIFTY 24500, RELIANCE breakout.",
};

describe("serializePrompts / parsePrompts round-trip", () => {
  it("round-trips all four answers", () => {
    const text = serializePrompts(sample, "");
    expect(hasPromptsBlock(text)).toBe(true);
    const { prompts, freeText } = parsePrompts(text);
    expect(prompts).toEqual(sample);
    expect(freeText).toBe("");
  });

  it("preserves free-form review text below the block", () => {
    const text = serializePrompts(sample, "Some extra free notes.");
    const { prompts, freeText } = parsePrompts(text);
    expect(prompts.bestTrade).toBe(sample.bestTrade);
    expect(freeText).toBe("Some extra free notes.");
  });

  it("escapes newlines inside an answer", () => {
    const multi: DailyPrompts = { ...EMPTY_PROMPTS, watchlist: "line1\nline2" };
    const { prompts } = parsePrompts(serializePrompts(multi, ""));
    expect(prompts.watchlist).toBe("line1\nline2");
  });

  it("escapes backslashes inside an answer", () => {
    const tricky: DailyPrompts = { ...EMPTY_PROMPTS, bestTrade: "a\\b" };
    const { prompts } = parsePrompts(serializePrompts(tricky, ""));
    expect(prompts.bestTrade).toBe("a\\b");
  });

  it("drops the block entirely when every answer is blank", () => {
    const text = serializePrompts(EMPTY_PROMPTS, "free only");
    expect(hasPromptsBlock(text)).toBe(false);
    expect(text).toBe("free only");
  });

  it("returns empty prompts when there is no block", () => {
    const { prompts, freeText } = parsePrompts("just a normal review");
    expect(prompts).toEqual(EMPTY_PROMPTS);
    expect(freeText).toBe("just a normal review");
  });

  it("handles null/undefined review", () => {
    expect(parsePrompts(null).prompts).toEqual(EMPTY_PROMPTS);
    expect(parsePrompts(undefined).freeText).toBe("");
  });

  it("ignores a malformed block (treats whole text as free)", () => {
    const broken = "<!-- tm:daily-prompts BEST: x"; // no end marker
    const { prompts, freeText } = parsePrompts(broken);
    expect(prompts).toEqual(EMPTY_PROMPTS);
    expect(freeText).toBe(broken);
  });
});

describe("hasPromptsBlock", () => {
  it("is false for plain text and non-strings", () => {
    expect(hasPromptsBlock("hi")).toBe(false);
    expect(hasPromptsBlock(null)).toBe(false);
    expect(hasPromptsBlock(undefined)).toBe(false);
  });
});
