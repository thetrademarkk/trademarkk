import type { DbClient } from "./types";

/**
 * Idempotent, versioned migrations for the user journal database.
 * The same migrations run against hosted Turso DBs (server-side at provisioning),
 * BYOD DBs (client-side at connect), and local sql.js DBs.
 *
 * Every primary key is a ULID — this makes cross-DB migration copies idempotent.
 *
 * A migration is a list of plain `statements` and/or an optional `run(db)` step
 * for logic that must introspect the schema (e.g. an idempotent ADD COLUMN that
 * tolerates an already-present column, or a data backfill).
 */
interface Migration {
  version: number;
  statements?: string[];
  run?: (db: DbClient) => Promise<void>;
}

/** True when `table` already has a column named `column` (SQLite introspection). */
async function hasColumn(db: DbClient, table: string, column: string): Promise<boolean> {
  const res = await db.execute(`PRAGMA table_info(${table})`);
  return res.rows.some((r) => String(r.name) === column);
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        broker TEXT NOT NULL DEFAULT 'zerodha',
        starting_capital REAL NOT NULL DEFAULT 0,
        charge_profile TEXT NOT NULL DEFAULT 'zerodha',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL DEFAULT 'NSE',
        segment TEXT NOT NULL DEFAULT 'OPT',
        expiry TEXT,
        strike REAL,
        option_type TEXT,
        direction TEXT NOT NULL DEFAULT 'long',
        status TEXT NOT NULL DEFAULT 'closed',
        qty INTEGER NOT NULL,
        avg_entry REAL NOT NULL,
        avg_exit REAL,
        planned_entry REAL,
        planned_sl REAL,
        planned_target REAL,
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        gross_pnl REAL NOT NULL DEFAULT 0,
        charges REAL NOT NULL DEFAULT 0,
        net_pnl REAL NOT NULL DEFAULT 0,
        r_multiple REAL,
        playbook_id TEXT,
        confidence INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS trade_fills (
        id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL,
        side TEXT NOT NULL,
        qty INTEGER NOT NULL,
        price REAL NOT NULL,
        fill_time TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'custom',
        color TEXT NOT NULL DEFAULT '#8B5CF6'
      )`,
      `CREATE TABLE IF NOT EXISTS trade_tags (
        trade_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (trade_id, tag_id)
      )`,
      `CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL UNIQUE,
        premarket_plan TEXT,
        market_notes TEXT,
        postmarket_review TEXT,
        mood INTEGER,
        followed_plan INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'discipline',
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rule_checks (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        rule_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'na',
        trade_id TEXT,
        note TEXT,
        UNIQUE (date, rule_id)
      )`,
      `CREATE TABLE IF NOT EXISTS playbooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        criteria TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        trade_id TEXT,
        journal_date TEXT,
        data TEXT NOT NULL,
        caption TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades (opened_at)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_account ON trades (account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_trades_playbook ON trades (playbook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_fills_trade ON trade_fills (trade_id)`,
      `CREATE INDEX IF NOT EXISTS idx_rule_checks_date ON rule_checks (date)`,
      `CREATE INDEX IF NOT EXISTS idx_attachments_trade ON attachments (trade_id)`,
    ],
  },
  {
    version: 2,
    statements: [
      // Explicit "no trades today" marks — they keep the journaling streak alive
      // on days the user deliberately sat out (discipline counts as activity).
      `CREATE TABLE IF NOT EXISTS no_trade_days (
        date TEXT PRIMARY KEY,
        note TEXT,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 3,
    statements: [
      // Strategy legs (straddles, spreads…): each leg has its own instrument
      // details + execution. The trades row keeps leg-1 values + totals.
      `CREATE TABLE IF NOT EXISTS trade_legs (
        id TEXT PRIMARY KEY,
        trade_id TEXT NOT NULL,
        leg_no INTEGER NOT NULL,
        strike REAL,
        option_type TEXT,
        direction TEXT NOT NULL,
        qty INTEGER NOT NULL,
        avg_entry REAL NOT NULL,
        avg_exit REAL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_trade_legs_trade ON trade_legs (trade_id)`,
    ],
  },
  {
    // v4 — Segment × Product model. The `segment` column already exists as TEXT
    // (no enum change is possible in SQLite anyway), so widening it to
    // EQ/FUT/OPT/COMM/CDS is purely a TypeScript concern. Here we add a nullable
    // `product` column and backfill a sensible value for existing rows:
    //   • same-IST-day equity  → 'MIS' (intraday)
    //   • other equity (held overnight) → 'CNC' (delivery)
    //   • derivatives (FUT/OPT/COMM/CDS) → 'NRML' (carry-forward)
    // Rows that stay NULL (e.g. an open equity trade) are treated as MIS by the
    // charge engine — exactly the pre-v4 behaviour, so no P&L regression.
    version: 4,
    run: async (db) => {
      if (!(await hasColumn(db, "trades", "product"))) {
        await db.execute(`ALTER TABLE trades ADD COLUMN product TEXT`);
      }
      // Backfill is itself idempotent (only touches rows still NULL).
      await db.execute(
        `UPDATE trades SET product = 'MIS'
           WHERE product IS NULL AND segment = 'EQ'
             AND closed_at IS NOT NULL AND date(opened_at) = date(closed_at)`
      );
      await db.execute(
        `UPDATE trades SET product = 'CNC'
           WHERE product IS NULL AND segment = 'EQ'
             AND closed_at IS NOT NULL AND date(opened_at) <> date(closed_at)`
      );
      await db.execute(
        `UPDATE trades SET product = 'NRML'
           WHERE product IS NULL AND segment IN ('FUT', 'OPT', 'COMM', 'CDS')`
      );
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_trades_product ON trades (product)`);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** All journal tables in dependency-safe copy order (used by the mode-switch engine). */
export const JOURNAL_TABLES = [
  "accounts",
  "playbooks",
  "tags",
  "trades",
  "trade_fills",
  "trade_tags",
  "journal_entries",
  "rules",
  "rule_checks",
  "attachments",
  "settings",
  "no_trade_days",
  "trade_legs",
] as const;

export async function runMigrations(db: DbClient): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
  const res = await db.execute(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations`);
  const current = Number(res.rows[0]?.v ?? 0);
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    for (const sql of m.statements ?? []) {
      await db.execute(sql);
    }
    if (m.run) await m.run(db);
    await db.execute(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`, [
      m.version,
      new Date().toISOString(),
    ]);
  }
}
