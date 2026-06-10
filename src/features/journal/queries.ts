"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { newId } from "@/lib/id";
import type { TradeWithMeta } from "@/features/trades";

export interface JournalEntry {
  id: string;
  date: string;
  premarket_plan: string | null;
  market_notes: string | null;
  postmarket_review: string | null;
  mood: number | null;
  followed_plan: number | null;
}

export function useJournalEntry(date: string) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["journal", date],
    queryFn: async () => {
      const res = await db.execute(`SELECT * FROM journal_entries WHERE date = ?`, [date]);
      return (res.rows[0] as unknown as JournalEntry | undefined) ?? null;
    },
  });
}

export interface SaveJournalInput {
  date: string;
  premarket_plan: string;
  market_notes: string;
  postmarket_review: string;
  mood: number | null;
  followed_plan: boolean | null;
}

export function useSaveJournal() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveJournalInput) => {
      const ts = new Date().toISOString();
      await db.execute(
        `INSERT INTO journal_entries (id, date, premarket_plan, market_notes, postmarket_review, mood, followed_plan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
           premarket_plan = excluded.premarket_plan,
           market_notes = excluded.market_notes,
           postmarket_review = excluded.postmarket_review,
           mood = excluded.mood,
           followed_plan = excluded.followed_plan,
           updated_at = excluded.updated_at`,
        [
          newId(),
          input.date,
          input.premarket_plan || null,
          input.market_notes || null,
          input.postmarket_review || null,
          input.mood,
          input.followed_plan == null ? null : input.followed_plan ? 1 : 0,
          ts,
          ts,
        ]
      );
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["journal", vars.date] });
      void qc.invalidateQueries({ queryKey: ["journal-dates"] });
    },
  });
}

/** All journaled dates — powers the streak indicator and calendar dots. */
export function useJournalDates() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["journal-dates"],
    queryFn: async () => {
      const res = await db.execute(`SELECT date FROM journal_entries ORDER BY date DESC`);
      return res.rows.map((r) => String(r.date));
    },
  });
}

/** Consecutive-weekday journaling streak ending today/yesterday. */
export function journalStreak(dates: string[]): number {
  const set = new Set(dates);
  let streak = 0;
  const cursor = new Date();
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Allow today to be un-journaled (market may still be open).
  if (!set.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (set.has(key(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else break;
  }
  return streak;
}

export function useDayTrades(date: string) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["day-trades", date],
    queryFn: async () => {
      const res = await db.execute(
        `SELECT t.*, p.name AS playbook_name FROM trades t
         LEFT JOIN playbooks p ON p.id = t.playbook_id
         WHERE date(t.opened_at) = ? ORDER BY t.opened_at`,
        [date]
      );
      return res.rows.map((r) => ({ ...r, tags: [] })) as unknown as TradeWithMeta[];
    },
  });
}
