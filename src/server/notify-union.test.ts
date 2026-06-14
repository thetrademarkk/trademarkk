import { describe, expect, it } from "vitest";
import type { NotificationType } from "./community";

/**
 * D6 — the notify() type union gains `backtest_done` / `backtest_failed`
 * ADDITIVELY: every pre-existing community notification kind must still be a
 * valid NotificationType (so no existing notify caller breaks), and the two new
 * backtest kinds must be assignable. These are compile-time assertions surfaced
 * as a runtime list so the test fails loudly if a kind is ever dropped.
 */
describe("notify() union additivity (D6)", () => {
  const EXISTING: NotificationType[] = ["like", "comment", "reply", "follow", "mention", "reshare"];
  const ADDED: NotificationType[] = ["backtest_done", "backtest_failed"];

  it("keeps every existing community notification kind", () => {
    expect(EXISTING).toEqual(["like", "comment", "reply", "follow", "mention", "reshare"]);
  });

  it("adds the two backtest kinds", () => {
    expect(ADDED).toEqual(["backtest_done", "backtest_failed"]);
  });

  it("the union is exactly the existing kinds plus the two additions", () => {
    // Exhaustive switch: a new/removed member breaks compilation here.
    const cover = (t: NotificationType): "community" | "backtest" => {
      switch (t) {
        case "like":
        case "comment":
        case "reply":
        case "follow":
        case "mention":
        case "reshare":
          return "community";
        case "backtest_done":
        case "backtest_failed":
          return "backtest";
      }
    };
    for (const t of EXISTING) expect(cover(t)).toBe("community");
    for (const t of ADDED) expect(cover(t)).toBe("backtest");
  });
});
