/**
 * Calendar-tab bucketing: per-weekday P&L and the expiry-day vs non-expiry-day
 * split — high-signal for Indian index-options sellers (Thursday/Tuesday expiry
 * effects). Pure & deterministic.
 *
 * A trading day counts as an "expiry day" when it equals the expiry the strategy
 * would have traded that day, resolved from the strategy's dominant leg expiry
 * rule via the BT-03 market calendar (expiryFor). We use the FIRST enabled leg's
 * expiry rule as the strategy's expiry kind (multi-expiry strategies are rare in
 * the no-code builder; this is the honest dominant-rule approximation and the
 * `n` per bucket is always shown so low samples are visible).
 */

import { expiryFor } from "@/lib/backtest/calendar/market-calendar";
import { weekdayOf } from "@/lib/backtest/calendar/market-calendar";
import type { RunResult } from "@/features/backtest/shared/run-result";
import type { ExpiryRuleKind } from "@/features/backtest/shared/strategy-def";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

export interface WeekdayBucket {
  /** 1..5 Mon..Fri. */
  weekday: number;
  label: string;
  net: number;
  /** Number of traded days landing on this weekday. */
  n: number;
}

export interface ExpirySplit {
  expiry: { net: number; n: number };
  nonExpiry: { net: number; n: number };
}

export interface CalendarBuckets {
  weekdays: WeekdayBucket[];
  expirySplit: ExpirySplit;
}

/** The strategy's dominant expiry kind (first enabled leg, else WEEKLY). */
export function dominantExpiryKind(run: RunResult): ExpiryRuleKind {
  const enabled = run.config.legs.find((l) => l.enabled) ?? run.config.legs[0];
  return enabled?.expiry ?? "WEEKLY";
}

/**
 * Bucket the run's TRADED days (legs.length > 0) by weekday and by expiry/non.
 * Skipped days (no legs) are excluded — they booked nothing.
 */
export function buildCalendarBuckets(run: RunResult): CalendarBuckets {
  const kind = dominantExpiryKind(run);
  const index = run.config.market.symbol;

  const wmap = new Map<number, { net: number; n: number }>();
  for (let w = 1; w <= 5; w++) wmap.set(w, { net: 0, n: 0 });

  const split: ExpirySplit = {
    expiry: { net: 0, n: 0 },
    nonExpiry: { net: 0, n: 0 },
  };

  for (const row of run.blotter) {
    if (row.legs.length === 0) continue;
    const wd = weekdayOf(row.day); // 0=Sun..6=Sat
    if (wd >= 1 && wd <= 5) {
      const b = wmap.get(wd)!;
      b.net = r2(b.net + row.net);
      b.n += 1;
    }
    const exp = expiryFor(index, row.day, kind);
    const bucket = row.day === exp ? split.expiry : split.nonExpiry;
    bucket.net = r2(bucket.net + row.net);
    bucket.n += 1;
  }

  const weekdays: WeekdayBucket[] = WEEKDAY_LABELS.map((label, i) => {
    const w = i + 1;
    const b = wmap.get(w)!;
    return { weekday: w, label, net: b.net, n: b.n };
  });

  return { weekdays, expirySplit: split };
}
