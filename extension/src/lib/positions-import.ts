import type { DbClient, DbStatement } from "@/lib/db/types";
import { pairFillsToTrades, type RawFill } from "@/features/trades/csv";
import { parseContractName } from "@/features/trades/instrument-parse";
import { buildTradeSaveStatements } from "@/features/trades/save-statements";
import type { TradeFormValues } from "@/features/trades/schemas";
import type { TradeRow } from "@/features/trades/types";
import { isoToLocalInput } from "@/features/trades/utils";
import type { ImportedFill } from "../brokers/kite-positions";

/**
 * Turns executed fills scraped from a broker's authenticated tradebook into
 * journal trades, deduped against what the user already has, written through
 * the SAME statement builder the web app uses.
 *
 * Pipeline (all client-side — nothing transits the platform):
 *  1. `ImportedFill[]` (from the Kite positions adapter) → the shared
 *     `RawFill[]` shape, pre-parsed so the instrument joins the dedupe key.
 *  2. `pairFillsToTrades` (reused from CSV import) FIFO-pairs them into
 *     round-trip `TradeRow`s with paise-correct charges and the SAME
 *     deterministic `stableId` convention — so re-scraping the same tradebook
 *     is idempotent (identical ids ⇒ all rows show "already in journal").
 *     The id also lines up with a Zerodha-Console CSV import of the same fills
 *     (both go through the legacy compact-symbol path); a CSV from a broker
 *     that carries an explicit expiry column keys its id on that expiry, so
 *     cross-source dedupe holds for equities/Zerodha but not necessarily for
 *     dated-contract CSVs from other brokers.
 *  3. Dedupe by querying which ids already exist in the journal DB.
 *  4. Writes go through `buildTradeSaveStatements` (ULIDs for fills, status,
 *     timestamps) so imported rows are byte-identical to web/quick-log writes.
 */

export interface ImportTrade {
  /** Deterministic dedupe id (matches CSV import's stableId). */
  id: string;
  trade: TradeRow;
  /** True when a trade with this id is already in the journal DB. */
  existing: boolean;
}

export interface ImportPreview {
  trades: ImportTrade[];
  /** Fills the adapter dropped because their time was unreadable. */
  skippedNoTime: number;
}

/** Imported fills → the CSV pipeline's RawFill shape (instrument pre-parsed). */
function toRawFills(fills: ImportedFill[]): { rawFills: RawFill[]; skippedNoTime: number } {
  const rawFills: RawFill[] = [];
  let skippedNoTime = 0;
  for (const f of fills) {
    if (!f.time) {
      // No trustworthy timestamp → can't place the fill on a day; skip rather
      // than invent a time that would corrupt the journal timeline.
      skippedNoTime++;
      continue;
    }
    const parsed = parseContractName(f.symbol);
    rawFills.push({
      symbol: parsed.symbol,
      side: f.side,
      qty: f.qty,
      price: f.price,
      time: f.time,
      expiry: parsed.expiry,
      segment: parsed.segment,
      strike: parsed.strike,
      optionType: parsed.optionType,
    });
  }
  // FIFO pairing assumes chronological order, but Kite's tradebook is often
  // rendered newest-first — sort ascending by fill time (mirrors the CSV
  // path's rowsToFills) so buys open positions before their sells close them.
  rawFills.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return { rawFills, skippedNoTime };
}

/**
 * Builds a dedupe-tagged preview. Pure pairing + charge math; the only DB read
 * is the id-existence check (no journal data leaves the user's own database).
 */
export async function buildImportPreview(
  fills: ImportedFill[],
  accountId: string,
  chargeProfileId: string,
  db: DbClient
): Promise<ImportPreview> {
  const { rawFills, skippedNoTime } = toRawFills(fills);
  const trades = pairFillsToTrades(rawFills, accountId, chargeProfileId);
  const existing = await existingIds(
    trades.map((t) => t.id),
    db
  );
  return {
    trades: trades.map((trade) => ({
      id: trade.id,
      trade,
      existing: existing.has(trade.id),
    })),
    skippedNoTime,
  };
}

/** Which of these ids already exist in the journal (chunked IN queries). */
async function existingIds(ids: string[], db: DbClient): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const res = await db.execute(
      `SELECT id FROM trades WHERE id IN (${placeholders})`,
      chunk
    );
    for (const r of res.rows) found.add(String(r.id));
  }
  return found;
}

/** A previewed TradeRow → the web trade form's values (single leg). */
export function tradeRowToFormValues(t: TradeRow): TradeFormValues {
  return {
    accountId: t.account_id,
    symbol: t.symbol,
    segment: t.segment,
    expiry: t.expiry ?? undefined,
    strike: t.strike ?? undefined,
    optionType: t.option_type ?? undefined,
    direction: t.direction,
    qty: t.qty,
    avgEntry: t.avg_entry,
    avgExit: t.avg_exit ?? undefined,
    plannedEntry: undefined,
    plannedSl: undefined,
    plannedTarget: undefined,
    openedAt: isoToLocalInput(t.opened_at),
    closedAt: t.closed_at ? isoToLocalInput(t.closed_at) : undefined,
    playbookId: undefined,
    confidence: undefined,
    notes: undefined,
    tagIds: [],
    // Charges already computed paise-correct by pairFillsToTrades — pass them
    // through verbatim so the statement builder doesn't re-derive (open trades
    // carry 0, which the builder also produces).
    manualCharges: t.status === "closed" ? t.charges : undefined,
    extraLegs: undefined,
  };
}

/**
 * Writes the selected trades through the shared statement builder, using each
 * trade's deterministic dedupe id so a future re-import is a no-op.
 *
 * Already-in-journal rows are SKIPPED even if the user re-checks one: the
 * statement builder does a full delete-then-insert on a known id, which would
 * wipe any notes/tags/plan the user added to that trade after the first
 * import. We only ever write rows the preview marked NEW. Returns the count of
 * rows actually written.
 */
export async function importTrades(
  selected: ImportTrade[],
  chargeProfileId: string,
  db: DbClient
): Promise<number> {
  const toWrite = selected.filter((item) => !item.existing);
  // Each trade's statements (delete-then-insert + fills) must land in one
  // batch, so chunk by whole trades — never split a trade across batches.
  const TRADES_PER_BATCH = 25;
  for (let i = 0; i < toWrite.length; i += TRADES_PER_BATCH) {
    const statements: DbStatement[] = [];
    for (const item of toWrite.slice(i, i + TRADES_PER_BATCH)) {
      const values = tradeRowToFormValues(item.trade);
      const { statements: stmts } = buildTradeSaveStatements(values, chargeProfileId, item.id);
      statements.push(...stmts);
    }
    if (statements.length) await db.batch(statements);
  }
  return toWrite.length;
}
