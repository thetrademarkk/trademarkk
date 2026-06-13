import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DbClient } from "@/lib/db/types";
import type { TradeFormValues } from "@/features/trades/schemas";
import { buildTradeSaveStatements } from "@/features/trades/save-statements";
import { computeStreak } from "@/lib/stats/streak";
import { newId } from "@/lib/id";
import { todayKey } from "@/lib/utils";
import { istDayKey, pushBadgeSnapshot } from "./badge-sync";

/**
 * Panel-side journal access: the SAME SQL the web client runs, against the
 * same DbClient abstraction — rule check-offs and trades sync instantly with
 * the web app because they are literally the same rows.
 */

/** react-query key for the rules-nudge badge counts (kept fresh by mutations). */
const BADGE_QUERY_KEY = ["badge"] as const;

const DbContext = React.createContext<DbClient | null>(null);
export const DbProvider = DbContext.Provider;

export function useDb(): DbClient {
  const db = React.useContext(DbContext);
  if (!db) throw new Error("useDb outside DbProvider");
  return db;
}

export interface AccountRow {
  id: string;
  name: string;
  charge_profile: string;
}

export function useAccounts() {
  const db = useDb();
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () =>
      (await db.execute(`SELECT id, name, charge_profile FROM accounts ORDER BY created_at`))
        .rows as unknown as AccountRow[],
  });
}

export interface PlaybookRow {
  id: string;
  name: string;
}

export function usePlaybooks() {
  const db = useDb();
  return useQuery({
    queryKey: ["playbooks"],
    queryFn: async () =>
      (await db.execute(`SELECT id, name FROM playbooks ORDER BY created_at`))
        .rows as unknown as PlaybookRow[],
  });
}

export interface RuleRow {
  id: string;
  text: string;
}

export type RuleStatus = "followed" | "broken" | "na";

export function useRules() {
  const db = useDb();
  return useQuery({
    queryKey: ["rules"],
    queryFn: async () =>
      (
        await db.execute(
          `SELECT id, text FROM rules WHERE active = 1 ORDER BY sort_order, created_at`
        )
      ).rows as unknown as RuleRow[],
  });
}

export function useRuleChecks(date: string) {
  const db = useDb();
  return useQuery({
    queryKey: ["rule-checks", date],
    queryFn: async () => {
      const res = await db.execute(`SELECT rule_id, status FROM rule_checks WHERE date = ?`, [
        date,
      ]);
      return new Map(res.rows.map((r) => [String(r.rule_id), String(r.status) as RuleStatus]));
    },
  });
}

export function useSetRuleCheck(date: string) {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ruleId: string; status: RuleStatus }) => {
      await db.execute(
        `INSERT INTO rule_checks (id, date, rule_id, status, trade_id, note) VALUES (?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(date, rule_id) DO UPDATE SET status = excluded.status`,
        [newId(), date, input.ruleId, input.status]
      );
    },
    // Optimistic flip — the panel must feel instant while trading.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ["rule-checks", date] });
      const prev = qc.getQueryData<Map<string, RuleStatus>>(["rule-checks", date]);
      const next = new Map(prev ?? []);
      next.set(input.ruleId, input.status);
      qc.setQueryData(["rule-checks", date], next);
      return { prev };
    },
    onError: (_e, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(["rule-checks", date], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["rule-checks", date] });
      // Refresh the rules-nudge toolbar badge — a check-off may zero the count.
      void qc.invalidateQueries({ queryKey: BADGE_QUERY_KEY });
    },
  });
}

export interface Glance {
  todayPnl: number;
  streak: number;
  todayLogged: boolean;
}

/** Today's net P&L + journaling streak — same math as the web dashboard. */
export function useGlance() {
  const db = useDb();
  return useQuery({
    queryKey: ["glance"],
    queryFn: async (): Promise<Glance> => {
      const today = todayKey();
      const [pnlRes, trades, journal, noTrade] = await Promise.all([
        db.execute(
          `SELECT COALESCE(SUM(net_pnl), 0) AS pnl FROM trades
           WHERE status = 'closed' AND substr(closed_at, 1, 10) = ?`,
          [today]
        ),
        db.execute(`SELECT DISTINCT substr(opened_at, 1, 10) AS d FROM trades`),
        db.execute(`SELECT date AS d FROM journal_entries`),
        db.execute(`SELECT date AS d FROM no_trade_days`),
      ]);
      const logged = new Set<string>();
      for (const rows of [trades.rows, journal.rows, noTrade.rows]) {
        for (const r of rows) logged.add(String(r.d));
      }
      const streak = computeStreak(logged, today);
      return {
        todayPnl: Number(pnlRes.rows[0]?.pnl ?? 0),
        streak: streak.current,
        todayLogged: streak.todayLogged,
      };
    },
  });
}

export function useSaveTrade() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: TradeFormValues) => {
      const profileId = await chargeProfileFor(db, values.accountId);
      const { id, statements } = buildTradeSaveStatements(values, profileId);
      await db.batch(statements);
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["glance"] });
      // The first trade of the day flips the badge on — refresh its count.
      void qc.invalidateQueries({ queryKey: BADGE_QUERY_KEY });
    },
  });
}

/**
 * Attaches an image (a captured chart screenshot) to a trade — byte-identical
 * to the web app's `useAddAttachment`: same `attachments` columns, same insert,
 * so the row renders on the web trade-detail's Screenshots view. Trade
 * screenshots are linked to the trade id, never a journal date.
 */
export function useAddAttachment() {
  const db = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (att: {
      tradeId?: string;
      journalDate?: string;
      data: string;
      caption?: string;
    }) => {
      await db.execute(
        `INSERT INTO attachments (id, trade_id, journal_date, data, caption, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          att.tradeId ?? null,
          att.journalDate ?? null,
          att.data,
          att.caption ?? null,
          new Date().toISOString(),
        ]
      );
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["glance"] }),
  });
}

/** Count of trades opened or closed on `day` — the badge's "has traded today". */
function useTradesTodayCount(day: string) {
  const db = useDb();
  return useQuery({
    queryKey: [...BADGE_QUERY_KEY, day],
    queryFn: async () => {
      const res = await db.execute(
        `SELECT COUNT(*) AS c FROM trades
         WHERE substr(opened_at, 1, 10) = ? OR substr(closed_at, 1, 10) = ?`,
        [day, day]
      );
      return Number(res.rows[0]?.c ?? 0);
    },
  });
}

/**
 * Keeps the rules-nudge toolbar badge in sync while the panel is open, then
 * hands the snapshot to the service worker (which owns the actual badge text).
 *
 * The unticked-rule count is derived from the SAME cached `useRules` +
 * `useRuleChecks` queries the RulesCard renders, so a tri-state flip updates the
 * badge INSTANTLY (optimistic, no extra DB read, no read-after-write race). Only
 * the "has traded today" check needs its own cheap COUNT(*), invalidated on
 * trade-save / import. Renders nothing.
 */
export function useBadgeSync(mode: "hosted" | "byod"): void {
  const day = istDayKey();
  const { data: rules } = useRules();
  const { data: checks } = useRuleChecks(day);
  const { data: tradesToday } = useTradesTodayCount(day);

  React.useEffect(() => {
    // Wait until all three inputs have loaded so we never push a spurious zero.
    if (rules === undefined || checks === undefined || tradesToday === undefined) return;
    // Unticked = active rule with no tri-state recorded for the day.
    const untickedRules = rules.filter((r) => !checks.has(r.id)).length;
    void pushBadgeSnapshot({ tradesToday, untickedRules, signedIn: true, mode, day });
  }, [rules, checks, tradesToday, mode, day]);
}

/** The charge profile configured for an account (defaults to zerodha). */
export async function chargeProfileFor(db: DbClient, accountId: string): Promise<string> {
  const res = await db.execute(`SELECT charge_profile FROM accounts WHERE id = ?`, [accountId]);
  return String(res.rows[0]?.charge_profile ?? "zerodha");
}
