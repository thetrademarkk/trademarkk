import { JOURNAL_TABLES, runMigrations } from "@/lib/db/migrations";
import { assertSafeIdentifiers } from "@/lib/db/identifiers";
import type { DbClient, DbStatement, DbValue } from "@/lib/db/types";

export interface CopyProgress {
  table: string;
  done: number;
  total: number;
}

export interface CopyReport {
  table: string;
  copied: number;
  sourceCount: number;
  targetCount: number;
}

/**
 * Client-side database copy: the browser connects to BOTH databases at once,
 * so journal data never passes through our servers. ULID primary keys +
 * INSERT OR REPLACE make this idempotent and resumable.
 */
export async function copyDatabase(
  source: DbClient,
  target: DbClient,
  onProgress?: (p: CopyProgress) => void
): Promise<CopyReport[]> {
  await runMigrations(target);
  const reports: CopyReport[] = [];

  for (const table of JOURNAL_TABLES) {
    const rows = (await source.execute(`SELECT * FROM ${table}`)).rows;
    const total = rows.length;
    let done = 0;

    if (total > 0) {
      // Source DB schema is external input — its column names go into SQL.
      const columns = assertSafeIdentifiers(Object.keys(rows[0]!));
      const placeholders = columns.map(() => "?").join(", ");
      const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
      for (let i = 0; i < rows.length; i += 50) {
        const chunk = rows.slice(i, i + 50);
        const statements: DbStatement[] = chunk.map((r) => ({
          sql,
          args: columns.map((c) => (r[c] ?? null) as DbValue),
        }));
        await target.batch(statements);
        done += chunk.length;
        onProgress?.({ table, done, total });
      }
    } else {
      onProgress?.({ table, done: 0, total: 0 });
    }

    const targetCount = Number(
      (await target.execute(`SELECT COUNT(*) AS c FROM ${table}`)).rows[0]?.c ?? 0
    );
    reports.push({ table, copied: done, sourceCount: total, targetCount });
  }
  // Force the copied data fully to disk before the caller flips storage mode, so
  // a mode-switch immediately after copy can't lose it (no-op on remote adapters).
  await target.flush?.();
  return reports;
}

/** Verification gate: every table's target row count must cover the source. */
export function verifyCopy(reports: CopyReport[]): { ok: boolean; failures: string[] } {
  const failures = reports
    .filter((r) => r.targetCount < r.sourceCount)
    .map((r) => `${r.table}: ${r.targetCount}/${r.sourceCount}`);
  return { ok: failures.length === 0, failures };
}
