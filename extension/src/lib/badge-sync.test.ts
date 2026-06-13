import { describe, expect, it, vi } from "vitest";
import type { DbClient, DbResult } from "@/lib/db/types";
import {
  clearedSnapshot,
  computeBadgeData,
  decideBadge,
  isBadgeSnapshot,
  istDayKey,
  type BadgeMode,
  type BadgeSnapshot,
} from "./badge-sync";

const DAY = "2026-06-13";

const snap = (over: Partial<BadgeSnapshot> = {}): BadgeSnapshot => ({
  tradesToday: 2,
  untickedRules: 2,
  signedIn: true,
  mode: "hosted",
  day: DAY,
  ...over,
});

describe("decideBadge", () => {
  it("shows the unticked-rule count when the day has trades and unticked rules", () => {
    expect(decideBadge(snap({ tradesToday: 1, untickedRules: 2 }), DAY)).toEqual({
      text: "2",
      color: "#dc2626",
    });
    // The count tracks the number of unticked rules, not the trade count.
    expect(decideBadge(snap({ tradesToday: 5, untickedRules: 1 }), DAY).text).toBe("1");
    expect(decideBadge(snap({ tradesToday: 3, untickedRules: 7 }), DAY).text).toBe("7");
  });

  it("clears when there are no trades yet, even with unticked rules", () => {
    expect(decideBadge(snap({ tradesToday: 0, untickedRules: 4 }), DAY).text).toBe("");
  });

  it("clears when every rule is addressed, even with trades", () => {
    expect(decideBadge(snap({ tradesToday: 3, untickedRules: 0 }), DAY).text).toBe("");
  });

  it("clears when signed out", () => {
    expect(decideBadge(snap({ signedIn: false }), DAY).text).toBe("");
  });

  it("clears for local / unsupported / null modes", () => {
    for (const mode of ["local", null] as BadgeMode[]) {
      expect(decideBadge(snap({ mode }), DAY).text).toBe("");
    }
  });

  it("shows for both hosted and byod modes", () => {
    expect(decideBadge(snap({ mode: "hosted" }), DAY).text).toBe("2");
    expect(decideBadge(snap({ mode: "byod" }), DAY).text).toBe("2");
  });

  it("clears a stale snapshot from a previous IST day (rollover)", () => {
    // A snapshot computed yesterday must not bleed its count into today.
    expect(decideBadge(snap({ day: "2026-06-12" }), DAY).text).toBe("");
  });

  it("treats a cleared snapshot as no badge", () => {
    expect(decideBadge(clearedSnapshot("hosted", DAY), DAY).text).toBe("");
    expect(decideBadge(clearedSnapshot(null, DAY), DAY).text).toBe("");
  });
});

describe("istDayKey", () => {
  it("rolls the day at IST midnight regardless of the host clock", () => {
    // 2026-06-12 18:45 UTC = 2026-06-13 00:15 IST → already the 13th in IST.
    expect(istDayKey(new Date("2026-06-12T18:45:00Z"))).toBe("2026-06-13");
    // 2026-06-12 18:15 UTC = 2026-06-12 23:45 IST → still the 12th in IST.
    expect(istDayKey(new Date("2026-06-12T18:15:00Z"))).toBe("2026-06-12");
  });

  it("is exactly UTC+05:30 (no DST)", () => {
    expect(istDayKey(new Date("2026-01-15T18:31:00Z"))).toBe("2026-01-16");
    expect(istDayKey(new Date("2026-07-15T18:31:00Z"))).toBe("2026-07-16");
  });
});

describe("isBadgeSnapshot", () => {
  it("accepts a well-formed snapshot", () => {
    expect(isBadgeSnapshot(snap())).toBe(true);
    expect(isBadgeSnapshot(clearedSnapshot("byod", DAY))).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isBadgeSnapshot(null)).toBe(false);
    expect(isBadgeSnapshot({})).toBe(false);
    expect(isBadgeSnapshot({ ...snap(), tradesToday: "2" })).toBe(false);
    expect(isBadgeSnapshot({ ...snap(), signedIn: "yes" })).toBe(false);
    expect(isBadgeSnapshot({ ...snap(), day: 20260613 })).toBe(false);
  });
});

/** Minimal DbClient stub that returns a COUNT for each query in order. */
function countDb(trades: number, unticked: number): DbClient {
  const execute = vi.fn(async (sql: string): Promise<DbResult> => {
    const c = /FROM trades/.test(sql) ? trades : unticked;
    return { rows: [{ c }], rowsAffected: 0 };
  });
  return { execute, batch: vi.fn() } as unknown as DbClient;
}

describe("computeBadgeData", () => {
  it("returns the trade + unticked-rule counts for the day", async () => {
    const data = await computeBadgeData(countDb(3, 2), DAY);
    expect(data).toEqual({ tradesToday: 3, untickedRules: 2 });
  });

  it("queries trades by open OR close day and the day's rule checks", async () => {
    const db = countDb(1, 1);
    await computeBadgeData(db, DAY);
    const calls = (db.execute as ReturnType<typeof vi.fn>).mock.calls;
    const tradesCall = calls.find((c) => /FROM trades/.test(c[0] as string));
    const rulesCall = calls.find((c) => /FROM rules/.test(c[0] as string));
    expect(tradesCall?.[0]).toMatch(/opened_at.*=.*OR.*closed_at/s);
    expect(tradesCall?.[1]).toEqual([DAY, DAY]);
    expect(rulesCall?.[0]).toMatch(/active = 1[\s\S]*NOT EXISTS/);
    expect(rulesCall?.[1]).toEqual([DAY]);
  });

  it("defaults missing counts to zero", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })), batch: vi.fn() };
    const data = await computeBadgeData(db as unknown as DbClient, DAY);
    expect(data).toEqual({ tradesToday: 0, untickedRules: 0 });
  });
});
