"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { newId } from "@/lib/id";
import type { DbClient, DbStatement, DbValue } from "@/lib/db/types";
import type {
  AccountRow,
  AttachmentRow,
  FillRow,
  TradeLegRow,
  PlaybookRow,
  Tag,
  TradeFilters,
  TradeRow,
  TradeWithMeta,
} from "./types";
import {
  buildRecomputeStatements,
  previewRecompute,
  type RecomputePreview,
  type TradeForRecompute,
} from "./recompute";
import type { TradeFormValues } from "./schemas";
import { buildTradeSaveStatements } from "./save-statements";

const cast = <T>(rows: Record<string, unknown>[]): T[] => rows as unknown as T[];

async function fetchTagsByTrade(db: DbClient): Promise<Map<string, Tag[]>> {
  const res = await db.execute(
    `SELECT tt.trade_id AS trade_id, g.id, g.name, g.kind, g.color
     FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id`
  );
  const map = new Map<string, Tag[]>();
  for (const r of res.rows) {
    const tradeId = String(r.trade_id);
    const tag: Tag = {
      id: String(r.id),
      name: String(r.name),
      kind: r.kind as Tag["kind"],
      color: String(r.color),
    };
    const arr = map.get(tradeId);
    if (arr) arr.push(tag);
    else map.set(tradeId, [tag]);
  }
  return map;
}

export function useTrades(filters: TradeFilters = {}) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["trades", filters],
    queryFn: async (): Promise<TradeWithMeta[]> => {
      let sql = `SELECT t.*, p.name AS playbook_name FROM trades t
                 LEFT JOIN playbooks p ON p.id = t.playbook_id WHERE 1=1`;
      const args: DbValue[] = [];
      if (filters.from) {
        sql += ` AND date(t.opened_at) >= ?`;
        args.push(filters.from);
      }
      if (filters.to) {
        sql += ` AND date(t.opened_at) <= ?`;
        args.push(filters.to);
      }
      if (filters.segment) {
        sql += ` AND t.segment = ?`;
        args.push(filters.segment);
      }
      if (filters.direction) {
        sql += ` AND t.direction = ?`;
        args.push(filters.direction);
      }
      if (filters.result === "win") sql += ` AND t.net_pnl > 0 AND t.status = 'closed'`;
      if (filters.result === "loss") sql += ` AND t.net_pnl < 0 AND t.status = 'closed'`;
      if (filters.playbookId) {
        sql += ` AND t.playbook_id = ?`;
        args.push(filters.playbookId);
      }
      if (filters.search) {
        sql += ` AND t.symbol LIKE ?`;
        args.push(`%${filters.search.toUpperCase()}%`);
      }
      sql += ` ORDER BY t.opened_at DESC`;
      const res = await db.execute(sql, args);
      const trades = cast<TradeWithMeta>(res.rows).map((t) => ({ ...t, tags: [] as Tag[] }));
      const tagMap = await fetchTagsByTrade(db);
      if (filters.tagId) {
        return trades
          .map((t) => ({ ...t, tags: tagMap.get(t.id) ?? [] }))
          .filter((t) => t.tags.some((g) => g.id === filters.tagId));
      }
      return trades.map((t) => ({ ...t, tags: tagMap.get(t.id) ?? [] }));
    },
  });
}

export function useTrade(id: string) {
  const { db } = useDb();
  return useQuery({
    queryKey: ["trade", id],
    queryFn: async () => {
      const res = await db.execute(
        `SELECT t.*, p.name AS playbook_name FROM trades t
         LEFT JOIN playbooks p ON p.id = t.playbook_id WHERE t.id = ?`,
        [id]
      );
      const trade = cast<TradeWithMeta>(res.rows)[0];
      if (!trade) return null;
      const [fills, tags, attachments, legs] = await Promise.all([
        db.execute(`SELECT * FROM trade_fills WHERE trade_id = ? ORDER BY fill_time`, [id]),
        db.execute(
          `SELECT g.* FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.trade_id = ?`,
          [id]
        ),
        db.execute(`SELECT * FROM attachments WHERE trade_id = ? ORDER BY created_at`, [id]),
        db.execute(`SELECT * FROM trade_legs WHERE trade_id = ? ORDER BY leg_no`, [id]),
      ]);
      return {
        ...trade,
        tags: cast<Tag>(tags.rows),
        fills: cast<FillRow>(fills.rows),
        attachments: cast<AttachmentRow>(attachments.rows),
        legs: cast<TradeLegRow>(legs.rows),
      };
    },
  });
}

/**
 * All multi-leg `trade_legs` rows in one query, grouped by trade id. The
 * analytics options tab needs every trade's leg shape to classify strategies;
 * single-leg trades have no rows here (their shape lives on the trade row).
 */
export function useAllLegs() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["all-legs"],
    queryFn: async (): Promise<Map<string, TradeLegRow[]>> => {
      const res = await db.execute(`SELECT * FROM trade_legs ORDER BY trade_id, leg_no`);
      const map = new Map<string, TradeLegRow[]>();
      for (const leg of cast<TradeLegRow>(res.rows)) {
        const arr = map.get(leg.trade_id);
        if (arr) arr.push(leg);
        else map.set(leg.trade_id, [leg]);
      }
      return map;
    },
  });
}

export function useAccounts() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () =>
      cast<AccountRow>((await db.execute(`SELECT * FROM accounts ORDER BY created_at`)).rows),
  });
}

export function useTags() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () =>
      cast<Tag>((await db.execute(`SELECT * FROM tags ORDER BY kind, name`)).rows),
  });
}

export function usePlaybooks() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["playbooks"],
    queryFn: async () =>
      cast<PlaybookRow>((await db.execute(`SELECT * FROM playbooks ORDER BY created_at`)).rows),
  });
}

/**
 * Builds all statements to persist a trade (insert or full replace on edit).
 * The statement construction itself lives in `save-statements.ts` (pure) so
 * the browser extension produces byte-identical writes.
 */
async function buildSaveStatements(
  db: DbClient,
  values: TradeFormValues,
  existingId?: string
): Promise<{ id: string; statements: DbStatement[] }> {
  const accountRes = await db.execute(`SELECT charge_profile FROM accounts WHERE id = ?`, [
    values.accountId,
  ]);
  const profileId = String(accountRes.rows[0]?.charge_profile ?? "zerodha");
  return buildTradeSaveStatements(values, profileId, existingId);
}

export function useSaveTrade() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ values, id }: { values: TradeFormValues; id?: string }) => {
      const { id: tradeId, statements } = await buildSaveStatements(db, values, id);
      await db.batch(statements);
      return tradeId;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteTrade() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.batch([
        { sql: `DELETE FROM trade_fills WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM trade_tags WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM attachments WHERE trade_id = ?`, args: [id] },
        { sql: `DELETE FROM trades WHERE id = ?`, args: [id] },
      ]);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useAddAttachment() {
  const { db } = useDb();
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
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useDeleteAttachment() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await db.execute(`DELETE FROM attachments WHERE id = ?`, [id]);
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useImportTrades() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: TradeRow[]) => {
      const stmts: DbStatement[] = rows.map((t) => ({
        sql: `INSERT OR IGNORE INTO trades (id, account_id, symbol, exchange, segment, product, expiry, strike, option_type, direction, status, qty, avg_entry, avg_exit, planned_entry, planned_sl, planned_target, opened_at, closed_at, gross_pnl, charges, net_pnl, r_multiple, playbook_id, confidence, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          t.id,
          t.account_id,
          t.symbol,
          t.exchange,
          t.segment,
          t.product ?? null,
          t.expiry,
          t.strike,
          t.option_type,
          t.direction,
          t.status,
          t.qty,
          t.avg_entry,
          t.avg_exit,
          t.planned_entry,
          t.planned_sl,
          t.planned_target,
          t.opened_at,
          t.closed_at,
          t.gross_pnl,
          t.charges,
          t.net_pnl,
          t.r_multiple,
          t.playbook_id,
          t.confidence,
          t.notes,
          t.created_at,
          t.updated_at,
        ],
      }));
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
      return rows.length;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

/**
 * SEG-04 — recompute-charges maintenance action. Gathers the account charge
 * profile + every CLOSED trade (and its legs) and diffs the stored charges
 * against a fresh per-(segment,product) engine pass. Used both to PREVIEW (no
 * write) and, on explicit confirm, to APPLY the corrected charges/net in one
 * batch. Works identically across hosted / BYOD / local.
 */
async function gatherRecomputeInput(
  db: DbClient
): Promise<{ profileId: string; trades: TradeForRecompute[] }> {
  const accountRes = await db.execute(
    `SELECT charge_profile FROM accounts ORDER BY created_at LIMIT 1`
  );
  const profileId = String(accountRes.rows[0]?.charge_profile ?? "zerodha");
  const tradeRes = await db.execute(`SELECT * FROM trades WHERE status = 'closed'`);
  const trades = cast<TradeRow>(tradeRes.rows);
  const legRes = await db.execute(`SELECT * FROM trade_legs ORDER BY trade_id, leg_no`);
  const legsByTrade = new Map<string, TradeLegRow[]>();
  for (const leg of cast<TradeLegRow>(legRes.rows)) {
    const arr = legsByTrade.get(leg.trade_id);
    if (arr) arr.push(leg);
    else legsByTrade.set(leg.trade_id, [leg]);
  }
  return {
    profileId,
    trades: trades.map((t) => ({ trade: t, legs: legsByTrade.get(t.id) ?? [] })),
  };
}

/** Previews a charge recompute over all closed trades (read-only — no writes). */
export function useRecomputePreview() {
  const { db } = useDb();
  return useMutation({
    mutationFn: async (): Promise<RecomputePreview> => {
      const { profileId, trades } = await gatherRecomputeInput(db);
      return previewRecompute(profileId, trades);
    },
  });
}

/** Applies a charge recompute: re-derives + writes corrected charges/net in one batch. */
export function useApplyRecompute() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RecomputePreview> => {
      const { profileId, trades } = await gatherRecomputeInput(db);
      const preview = previewRecompute(profileId, trades);
      const stmts = buildRecomputeStatements(preview.items);
      for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
      return preview;
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}
