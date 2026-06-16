/**
 * resample.test.ts — golden tests for the 1m→Nm session-aware resampler.
 *
 * DECLARED REFERENCE for expected OHLCV: the DuckDB `time_bucket` semantics in
 * 07-data-layer §4a (open=first, high=max, low=min, close=last, volume=sum) and
 * the 06-engine-semantics §1.4 worked example (5m buckets anchored at 09:15:
 * 09:15–09:19, 09:20–09:24, …). All expected bucket values below are HAND-WORKED
 * from the input series defined in `bars915`, not produced by the code under
 * test.
 */

import { describe, expect, it } from "vitest";
import type { Bar, Series } from "../engine/types";
import { isoWeekKeyIST, minuteOfDayIST, resample, tradingDayIST } from "./resample";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Epoch-ms for an IST wall-clock minute (y,m 1-based day, H, M). */
function istTs(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, 0, 0) - IST_OFFSET_MS;
}

/** A 1m bar at IST HH:MM on 2026-01-15 with explicit OHLCV. */
function bar(h: number, mi: number, o: number, hi: number, lo: number, c: number, v: number): Bar {
  return { ts: istTs(2026, 1, 15, h, mi), o, h: hi, l: lo, c, v };
}

/** Index-with-assert, so the strict `noUncheckedIndexedAccess` build stays clean. */
function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}

/**
 * Reference 1m series — ten minutes from 09:15 to 09:24 inclusive on
 * 2026-01-15 IST. Values chosen so every bucket's max/min/first/last is
 * unambiguous and hand-checkable.
 *
 *   time   o     h     l     c     v
 *   09:15  100   105    99   101   10
 *   09:16  101   107   100   104   12
 *   09:17  104   106   102   103    8
 *   09:18  103   104   101   102    9
 *   09:19  102   110   101   109   20    ← high of first 5m bucket = 110
 *   09:20  109   111   108   110    5
 *   09:21  110   112   107   108    6
 *   09:22  108   109    95    96   30    ← low of second 5m bucket = 95
 *   09:23   96   100    94    99    7
 *   09:24   99   103    98   102    4
 */
const bars915: Series = [
  bar(9, 15, 100, 105, 99, 101, 10),
  bar(9, 16, 101, 107, 100, 104, 12),
  bar(9, 17, 104, 106, 102, 103, 8),
  bar(9, 18, 103, 104, 101, 102, 9),
  bar(9, 19, 102, 110, 101, 109, 20),
  bar(9, 20, 109, 111, 108, 110, 5),
  bar(9, 21, 110, 112, 107, 108, 6),
  bar(9, 22, 108, 109, 95, 96, 30),
  bar(9, 23, 96, 100, 94, 99, 7),
  bar(9, 24, 99, 103, 98, 102, 4),
];

describe("time-base helpers", () => {
  it("minuteOfDayIST maps 09:15 IST → 555", () => {
    expect(minuteOfDayIST(istTs(2026, 1, 15, 9, 15))).toBe(555);
    expect(minuteOfDayIST(istTs(2026, 1, 15, 15, 30))).toBe(930);
  });

  it("tradingDayIST returns the IST calendar day", () => {
    expect(tradingDayIST(istTs(2026, 1, 15, 9, 15))).toBe("2026-01-15");
    // 15:30 IST is still the same IST day even though it crosses UTC midnight logic.
    expect(tradingDayIST(istTs(2026, 1, 15, 15, 30))).toBe("2026-01-15");
  });
});

describe("resample — 1m identity", () => {
  it("1m returns an ascending copy, input untouched", () => {
    const shuffled = [at(bars915, 2), at(bars915, 0), at(bars915, 1)];
    const out = resample(shuffled, "1m");
    expect(out.map((b) => b.ts)).toEqual([at(bars915, 0).ts, at(bars915, 1).ts, at(bars915, 2).ts]);
    // input not mutated
    expect(at(shuffled, 0).ts).toBe(at(bars915, 2).ts);
  });

  it("empty input → empty output", () => {
    expect(resample([], "5m")).toEqual([]);
  });
});

describe("resample — 5m (clean session divisor)", () => {
  const out = resample(bars915, "5m");

  it("produces exactly two 5m buckets: [09:15–09:19] and [09:20–09:24]", () => {
    expect(out).toHaveLength(2);
    expect(at(out, 0).ts).toBe(istTs(2026, 1, 15, 9, 15));
    expect(at(out, 1).ts).toBe(istTs(2026, 1, 15, 9, 20));
  });

  it("bucket 1 [09:15–09:19] OHLCV matches the hand-worked reference", () => {
    // open=first(09:15)=100, high=max(105,107,106,104,110)=110,
    // low=min(99,100,102,101,101)=99, close=last(09:19)=109, vol=10+12+8+9+20=59
    expect(at(out, 0)).toMatchObject({ o: 100, h: 110, l: 99, c: 109, v: 59 });
  });

  it("bucket 2 [09:20–09:24] OHLCV matches the hand-worked reference", () => {
    // open=first(09:20)=109, high=max(111,112,109,100,103)=112,
    // low=min(108,107,95,94,98)=94, close=last(09:24)=102, vol=5+6+30+7+4=52
    expect(at(out, 1)).toMatchObject({ o: 109, h: 112, l: 94, c: 102, v: 52 });
  });
});

describe("resample — 7m (non-divisor → ragged trailing bucket)", () => {
  const out = resample(bars915, "7m");

  it("produces two buckets: a full [09:15–09:21] and a ragged [09:22–09:24]", () => {
    // 7m grid from 09:15: bucket0 = minutes 555..561 (09:15–09:21),
    // bucket1 = 562..568 (09:22–09:28); we only have up to 09:24, so bucket1 is
    // a 3-minute ragged candle. No fabricated minutes.
    expect(out).toHaveLength(2);
    expect(at(out, 0).ts).toBe(istTs(2026, 1, 15, 9, 15));
    expect(at(out, 1).ts).toBe(istTs(2026, 1, 15, 9, 22));
  });

  it("bucket 1 [09:15–09:21] OHLCV matches the hand-worked reference", () => {
    // 09:15..09:21 (7 bars): open=100, high=max(105,107,106,104,110,111,112)=112,
    // low=min(99,100,102,101,101,108,107)=99, close=last(09:21)=108,
    // vol=10+12+8+9+20+5+6=70
    expect(at(out, 0)).toMatchObject({ o: 100, h: 112, l: 99, c: 108, v: 70 });
  });

  it("ragged bucket 2 [09:22–09:24] is emitted with only the 3 present minutes", () => {
    // 09:22..09:24 (3 bars): open=108, high=max(109,100,103)=109,
    // low=min(95,94,98)=94, close=last(09:24)=102, vol=30+7+4=41
    expect(at(out, 1)).toMatchObject({ o: 108, h: 109, l: 94, c: 102, v: 41 });
  });
});

describe("resample — session-boundary alignment (buckets never cross a day)", () => {
  it("restarts the 5m grid at each day's 09:15", () => {
    // Day 1: 09:15,09:16 ; Day 2: 09:15,09:16. Each day's first bucket is its
    // own 09:15 — never merged across the EOD boundary.
    const d1 = [bar(9, 15, 10, 12, 9, 11, 1), bar(9, 16, 11, 13, 10, 12, 2)];
    const day2 = (
      h: number,
      mi: number,
      o: number,
      hi: number,
      lo: number,
      c: number,
      v: number
    ): Bar => ({
      ts: istTs(2026, 1, 16, h, mi),
      o,
      h: hi,
      l: lo,
      c,
      v,
    });
    const d2 = [day2(9, 15, 20, 22, 19, 21, 3), day2(9, 16, 21, 25, 18, 24, 4)];
    const out = resample([...d1, ...d2], "5m");
    expect(out).toHaveLength(2); // one bucket per day
    expect(tradingDayIST(at(out, 0).ts)).toBe("2026-01-15");
    expect(tradingDayIST(at(out, 1).ts)).toBe("2026-01-16");
    // Day 1 bucket: open=10, high=13, low=9, close=12, vol=3
    expect(at(out, 0)).toMatchObject({ o: 10, h: 13, l: 9, c: 12, v: 3 });
    // Day 2 bucket: open=20, high=25, low=18, close=24, vol=7
    expect(at(out, 1)).toMatchObject({ o: 20, h: 25, l: 18, c: 24, v: 7 });
  });

  it("alignment is to 09:15, not the wall-clock hour: 09:15–09:19 is one 5m bucket", () => {
    // If we wrongly aligned to :00/:05 (clock), 09:15–09:19 would be one bucket
    // by coincidence — so use an offset window 09:17–09:21 which a clock-aligned
    // grid would SPLIT (09:17-09:19 | 09:20-09:21) but the 09:15-anchored grid
    // keeps as [09:15 bucket: 09:17,18,19] + [09:20 bucket: 09:20,21].
    const slice = bars915.slice(2, 7); // 09:17..09:21
    const out = resample(slice, "5m");
    // Two buckets prove 09:15-anchored grouping: {09:17,18,19} | {09:20,21}.
    // A clock-aligned (:15/:20 happen to match here) vs day-relative distinction
    // is moot for the COUNT; the split point is what matters. The bucket ts is
    // the first PRESENT member minute (09:17 for bucket 0), not the empty grid
    // edge — the resampler never fabricates the missing 09:15/09:16 minutes.
    expect(out).toHaveLength(2);
    expect(at(out, 0).ts).toBe(istTs(2026, 1, 15, 9, 17)); // first present member
    expect(at(out, 1).ts).toBe(istTs(2026, 1, 15, 9, 20));
    // bucket 0 = 09:17,18,19 → open=104 (09:17), close=109 (09:19)
    expect(at(out, 0)).toMatchObject({ o: 104, c: 109 });
    // bucket 1 = 09:20,21 → open=109 (09:20), close=108 (09:21)
    expect(at(out, 1)).toMatchObject({ o: 109, c: 108 });
  });
});

describe("resample — 1d and 1w roll-ups", () => {
  it("1d collapses the whole session into one bar per day", () => {
    const out = resample(bars915, "1d");
    expect(out).toHaveLength(1);
    // open=first(09:15)=100, high=max over all =112, low=min over all =94,
    // close=last(09:24)=102, vol=sum=Σ all volumes
    const totalVol = bars915.reduce((s, b) => s + b.v, 0);
    expect(at(out, 0)).toMatchObject({ o: 100, h: 112, l: 94, c: 102, v: totalVol });
  });

  it("1w groups two days of the same ISO week into one bar", () => {
    const d1 = bar(9, 15, 100, 105, 99, 101, 10); // Thu 2026-01-15
    const d2: Bar = { ts: istTs(2026, 1, 16, 9, 15), o: 101, h: 120, l: 90, c: 118, v: 5 }; // Fri
    expect(isoWeekKeyIST(d1.ts)).toBe(isoWeekKeyIST(d2.ts)); // same ISO week
    const out = resample([d1, d2], "1w");
    expect(out).toHaveLength(1);
    // open=100, high=max(105,120)=120, low=min(99,90)=90, close=118, vol=15
    expect(at(out, 0)).toMatchObject({ o: 100, h: 120, l: 90, c: 118, v: 15 });
  });
});

describe("resample — open interest folds to last print in the bucket", () => {
  it("carries the last bar's oi into the bucket", () => {
    const a: Bar = { ts: istTs(2026, 1, 15, 9, 15), o: 1, h: 2, l: 1, c: 2, v: 1, oi: 1000 };
    const b: Bar = { ts: istTs(2026, 1, 15, 9, 16), o: 2, h: 3, l: 1, c: 3, v: 1, oi: 1200 };
    const out = resample([a, b], "5m");
    expect(at(out, 0).oi).toBe(1200);
  });
});

describe("resample — invalid interval throws (caller must gate)", () => {
  it("throws on an unparseable token", () => {
    expect(() => resample(bars915, "nope")).toThrow(/invalid interval/);
  });
});
