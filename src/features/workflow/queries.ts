"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { buildBulkStatements, type BulkAction } from "./bulk-actions";

/**
 * Applies a {@link BulkAction} to a set of trade ids in ONE transaction. The
 * statements are built purely (bulk-actions.ts) and run via `db.batch`, so a
 * bulk tag/playbook/delete is atomic and identical across storage modes. On
 * success every trade-derived query is invalidated so the table, analytics and
 * journal all reflect the change instantly.
 */
export function useBulkAction() {
  const { db } = useDb();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, ids }: { action: BulkAction; ids: string[] }) => {
      const statements = buildBulkStatements(action, ids);
      if (statements.length === 0) return 0;
      await db.batch(statements);
      return new Set(ids).size;
    },
    // Bulk tag/playbook/delete mutates trades, trade_tags, trade_legs, fills and
    // attachments — invalidate every local trade-derived surface (table, single
    // trade, legs, tag/playbook lists & counts, analytics-feeding adherence/tag
    // stats, calendar/day trades, streak). Scoped to the trades domain — never
    // touches community/network keys.
    onSuccess: () => {
      for (const key of [
        ["trades"],
        ["trade"],
        ["all-legs"],
        ["tags"],
        ["playbooks"],
        ["adherence"],
        ["tag-stats"],
        ["day-trades"],
        ["streak"],
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
