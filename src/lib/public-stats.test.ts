import { describe, expect, it } from "vitest";
import { shapePublicStats } from "./public-stats";

const NOW = new Date("2026-06-12T10:00:00.000Z");

describe("shapePublicStats", () => {
  it("passes through sane aggregates", () => {
    const s = shapePublicStats({ traders: 42, active30d: 17, posts: 128, longestStreak: 21 }, NOW);
    expect(s).toEqual({
      traders: 42,
      active30d: 17,
      posts: 128,
      longestStreak: 21,
      generatedAt: "2026-06-12T10:00:00.000Z",
    });
  });

  it("coerces numeric strings (driver row values)", () => {
    const s = shapePublicStats(
      { traders: "7", active30d: "3", posts: "0", longestStreak: "9" },
      NOW
    );
    expect(s.traders).toBe(7);
    expect(s.active30d).toBe(3);
    expect(s.longestStreak).toBe(9);
  });

  it("zeroes negatives, NaN, null and missing fields", () => {
    const s = shapePublicStats({ traders: -5, active30d: NaN, posts: null }, NOW);
    expect(s).toMatchObject({ traders: 0, active30d: 0, posts: 0, longestStreak: 0 });
  });

  it("floors fractional values", () => {
    expect(shapePublicStats({ posts: 3.9 }, NOW).posts).toBe(3);
  });

  it("never reports more active users than registered users", () => {
    const s = shapePublicStats({ traders: 5, active30d: 12 }, NOW);
    expect(s.active30d).toBe(5);
  });

  it("empty platform yields all zeros (never fabricates numbers)", () => {
    const s = shapePublicStats({}, NOW);
    expect(s.traders + s.active30d + s.posts + s.longestStreak).toBe(0);
  });
});
