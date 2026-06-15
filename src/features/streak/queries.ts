"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { todayKey } from "@/lib/utils";
import { computeStreak, type StreakResult } from "@/lib/stats/streak";

export interface StreakData extends StreakResult {
  /** Today is explicitly marked as a deliberate no-trade day. */
  noTradeToday: boolean;
  /** Today already has at least one trade logged. */
  tradedToday: boolean;
  /** Sat/Sun: markets closed — counts as covered without any action. */
  isWeekendToday: boolean;
}

/** Streak = trades ∪ journal entries ∪ explicit no-trade marks, per day. */
export function useStreak() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["streak"],
    queryFn: async (): Promise<StreakData> => {
      const [trades, journal, noTrade] = await Promise.all([
        // opened_at is stored UTC; the streak (and todayKey) key days by IST, so
        // shift +5:30 BEFORE slicing the date — otherwise a trade logged in the
        // IST morning/late-night can fall on the wrong day and not count today.
        db.execute(
          `SELECT DISTINCT substr(datetime(opened_at, '+330 minutes'), 1, 10) AS d FROM trades`
        ),
        db.execute(`SELECT date AS d FROM journal_entries`),
        db.execute(`SELECT date AS d FROM no_trade_days`),
      ]);
      const logged = new Set<string>();
      for (const rows of [trades.rows, journal.rows, noTrade.rows]) {
        for (const r of rows) logged.add(String(r.d));
      }
      const today = todayKey();
      const noTradeDates = new Set(noTrade.rows.map((r) => String(r.d)));
      const tradeDates = new Set(trades.rows.map((r) => String(r.d)));
      const dow = new Date().getDay();
      return {
        ...computeStreak(logged, today),
        noTradeToday: noTradeDates.has(today),
        tradedToday: tradeDates.has(today),
        isWeekendToday: dow === 0 || dow === 6,
      };
    },
  });
}

/** Marks/unmarks today as a deliberate no-trade day. */
export function useToggleNoTradeDay() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mark: boolean) => {
      const today = todayKey();
      if (mark) {
        await db.execute(`INSERT OR IGNORE INTO no_trade_days (date, created_at) VALUES (?, ?)`, [
          today,
          new Date().toISOString(),
        ]);
      } else {
        await db.execute(`DELETE FROM no_trade_days WHERE date = ?`, [today]);
      }
      return mark;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["streak"] }),
  });
}
