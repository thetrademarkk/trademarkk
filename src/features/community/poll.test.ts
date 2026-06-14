import { describe, expect, it } from "vitest";
import { backgroundAwarePoll } from "./poll";

describe("backgroundAwarePoll", () => {
  it("pauses on a hidden tab and refetches on focus", () => {
    const opts = backgroundAwarePoll(30_000);
    expect(opts.refetchInterval).toBe(30_000);
    // The whole point of the polish pass: backgrounded tabs must go quiet.
    expect(opts.refetchIntervalInBackground).toBe(false);
    // ...and catch up the instant the trader returns.
    expect(opts.refetchOnWindowFocus).toBe(true);
  });

  it("preserves whatever cadence the caller asks for", () => {
    expect(backgroundAwarePoll(5_000).refetchInterval).toBe(5_000);
    expect(backgroundAwarePoll(60_000).refetchInterval).toBe(60_000);
    expect(backgroundAwarePoll(25_000).refetchInterval).toBe(25_000);
  });

  it("rejects a non-positive or non-finite interval rather than busy-looping", () => {
    expect(() => backgroundAwarePoll(0)).toThrow();
    expect(() => backgroundAwarePoll(-1)).toThrow();
    expect(() => backgroundAwarePoll(Number.NaN)).toThrow();
    expect(() => backgroundAwarePoll(Number.POSITIVE_INFINITY)).toThrow();
  });
});
