import { JOURNAL_TABLES } from "@/lib/db/migrations";
import { assertSafeIdentifiers } from "@/lib/db/identifiers";
import type { DbClient, DbStatement, DbValue } from "@/lib/db/types";

/** Full JSON backup of every journal table (works in all three modes). */
export async function exportBackup(db: DbClient): Promise<string> {
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const table of JOURNAL_TABLES) {
    data[table] = (await db.execute(`SELECT * FROM ${table}`)).rows;
  }
  return JSON.stringify(
    { app: "trademark", version: 1, exportedAt: new Date().toISOString(), data },
    null,
    2
  );
}

export async function importBackup(db: DbClient, json: string): Promise<number> {
  const parsed = JSON.parse(json) as {
    app?: string;
    data?: Record<string, Record<string, unknown>[]>;
  };
  if (parsed.app !== "trademark" || !parsed.data) throw new Error("Not a TradeMarkk backup file");
  let total = 0;
  for (const table of JOURNAL_TABLES) {
    const rows = parsed.data[table] ?? [];
    if (rows.length === 0) continue;
    // Backup files are untrusted input — column names go into SQL, so validate them.
    const columns = assertSafeIdentifiers(Object.keys(rows[0]!));
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    const stmts: DbStatement[] = rows.map((r) => ({
      sql,
      args: columns.map((c) => (r[c] ?? null) as DbValue),
    }));
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
    total += rows.length;
  }
  return total;
}

export function downloadFile(filename: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trades as CSV for spreadsheets. */
export async function exportTradesCsv(db: DbClient): Promise<string> {
  const rows = (await db.execute(`SELECT * FROM trades ORDER BY opened_at`)).rows;
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join(
    "\n"
  );
}
