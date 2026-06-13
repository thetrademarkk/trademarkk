"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { newId } from "@/lib/id";

export interface Rule {
  id: string;
  text: string;
  category: string;
  active: number;
  sort_order: number;
}

export interface RuleCheck {
  id: string;
  date: string;
  rule_id: string;
  status: "followed" | "broken" | "na";
  trade_id: string | null;
  note: string | null;
}

export function useRules(includeInactive = false) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["rules", includeInactive],
    queryFn: async () => {
      const res = await db.execute(
        `SELECT * FROM rules ${includeInactive ? "" : "WHERE active = 1"} ORDER BY sort_order, created_at`
      );
      return res.rows as unknown as Rule[];
    },
  });
}

export function useSaveRule() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: { id?: string; text: string; category: string; active?: boolean }) => {
      if (rule.id) {
        await db.execute(`UPDATE rules SET text = ?, category = ?, active = ? WHERE id = ?`, [
          rule.text,
          rule.category,
          rule.active === false ? 0 : 1,
          rule.id,
        ]);
      } else {
        await db.execute(
          `INSERT INTO rules (id, text, category, active, sort_order, created_at) VALUES (?, ?, ?, 1, 99, ?)`,
          [newId(), rule.text, rule.category, new Date().toISOString()]
        );
      }
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteRule() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.batch([
        { sql: `DELETE FROM rule_checks WHERE rule_id = ?`, args: [id] },
        { sql: `DELETE FROM rules WHERE id = ?`, args: [id] },
      ]);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useRuleChecks(date: string) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["rule-checks", date],
    queryFn: async () => {
      const res = await db.execute(`SELECT * FROM rule_checks WHERE date = ?`, [date]);
      return res.rows as unknown as RuleCheck[];
    },
  });
}

export function useSetRuleCheck() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { date: string; ruleId: string; status: RuleCheck["status"] }) => {
      await db.execute(
        `INSERT INTO rule_checks (id, date, rule_id, status, trade_id, note) VALUES (?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(date, rule_id) DO UPDATE SET status = excluded.status`,
        [newId(), input.date, input.ruleId, input.status]
      );
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: ["rule-checks", vars.date] });
      void qc.invalidateQueries({ queryKey: ["adherence"] });
      void qc.invalidateQueries({ queryKey: ["rule-days"] });
    },
  });
}

export interface RuleDays {
  /** Dates (YYYY-MM-DD) with at least one broken rule check. */
  brokenDates: Set<string>;
  /** Dates with at least one rule check of any status. */
  checkedDates: Set<string>;
}

/** Day classification from rule_checks — powers the trades rule-adherence filter. */
export function useRuleDays() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["rule-days"],
    queryFn: async (): Promise<RuleDays> => {
      const res = await db.execute(`SELECT date, status FROM rule_checks`);
      const brokenDates = new Set<string>();
      const checkedDates = new Set<string>();
      for (const r of res.rows) {
        const d = String(r.date);
        checkedDates.add(d);
        if (r.status === "broken") brokenDates.add(d);
      }
      return { brokenDates, checkedDates };
    },
  });
}

/** Broken-rule-check counts keyed by day (YYYY-MM-DD) — powers discipline scoring. */
export function useRuleBreaksByDay() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["rule-breaks-by-day"],
    queryFn: async (): Promise<Map<string, number>> => {
      const res = await db.execute(
        `SELECT date, COUNT(*) AS n FROM rule_checks WHERE status = 'broken' GROUP BY date`
      );
      const map = new Map<string, number>();
      for (const r of res.rows) map.set(String(r.date), Number(r.n));
      return map;
    },
  });
}

export interface RuleAdherence {
  rule: Rule;
  followed: number;
  broken: number;
  adherencePct: number; // followed / (followed + broken)
  brokenDayCost: number; // sum of negative day P&L on days this rule was broken
}

/** Adherence per rule within a date range + the ₹ cost of broken-rule days. */
export function useAdherence(from: string | null, to: string | null) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["adherence", from, to],
    queryFn: async (): Promise<{ rules: RuleAdherence[]; overallPct: number }> => {
      let where = `WHERE 1=1`;
      const args: string[] = [];
      if (from) {
        where += ` AND rc.date >= ?`;
        args.push(from);
      }
      if (to) {
        where += ` AND rc.date <= ?`;
        args.push(to);
      }
      const checks = await db.execute(
        `SELECT rc.rule_id, rc.date, rc.status FROM rule_checks rc ${where}`,
        args
      );
      const dayPnlRes = await db.execute(
        `SELECT date(closed_at) AS d, SUM(net_pnl) AS pnl FROM trades WHERE status = 'closed' GROUP BY date(closed_at)`
      );
      const dayPnl = new Map(dayPnlRes.rows.map((r) => [String(r.d), Number(r.pnl)]));
      const rulesRes = await db.execute(`SELECT * FROM rules WHERE active = 1 ORDER BY sort_order`);
      const rules = rulesRes.rows as unknown as Rule[];

      let totalFollowed = 0;
      let totalBroken = 0;
      const result: RuleAdherence[] = rules.map((rule) => {
        const mine = checks.rows.filter((c) => c.rule_id === rule.id);
        const followed = mine.filter((c) => c.status === "followed").length;
        const brokenChecks = mine.filter((c) => c.status === "broken");
        const broken = brokenChecks.length;
        const brokenDayCost = brokenChecks.reduce((s, c) => {
          const pnl = dayPnl.get(String(c.date)) ?? 0;
          return s + Math.min(pnl, 0);
        }, 0);
        totalFollowed += followed;
        totalBroken += broken;
        return {
          rule,
          followed,
          broken,
          adherencePct: followed + broken > 0 ? followed / (followed + broken) : 1,
          brokenDayCost,
        };
      });
      return {
        rules: result.sort((a, b) => a.brokenDayCost - b.brokenDayCost),
        overallPct:
          totalFollowed + totalBroken > 0 ? totalFollowed / (totalFollowed + totalBroken) : 1,
      };
    },
  });
}

export interface MistakeStat {
  tagId: string;
  name: string;
  color: string;
  count: number;
  cost: number; // sum of net P&L of trades carrying this mistake tag
}

export function useTagStats(kind: "mistake" | "emotion", from: string | null, to: string | null) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["tag-stats", kind, from, to],
    queryFn: async (): Promise<MistakeStat[]> => {
      let sql = `SELECT g.id AS tag_id, g.name, g.color, COUNT(*) AS cnt, SUM(t.net_pnl) AS cost
                 FROM trade_tags tt
                 JOIN tags g ON g.id = tt.tag_id AND g.kind = ?
                 JOIN trades t ON t.id = tt.trade_id AND t.status = 'closed'
                 WHERE 1=1`;
      const args: string[] = [kind];
      if (from) {
        sql += ` AND date(t.opened_at) >= ?`;
        args.push(from);
      }
      if (to) {
        sql += ` AND date(t.opened_at) <= ?`;
        args.push(to);
      }
      sql += ` GROUP BY g.id ORDER BY cost ASC`;
      const res = await db.execute(sql, args);
      return res.rows.map((r) => ({
        tagId: String(r.tag_id),
        name: String(r.name),
        color: String(r.color),
        count: Number(r.cnt),
        cost: Number(r.cost),
      }));
    },
  });
}

export const useMistakeStats = (from: string | null, to: string | null) =>
  useTagStats("mistake", from, to);
