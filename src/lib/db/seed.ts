import { newId } from "@/lib/id";
import { computeCharges, computeGrossPnl, computeRMultiple } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import { toDateKey } from "@/lib/utils";
import type { DbClient, DbStatement } from "./types";

export const DEFAULT_MISTAKE_TAGS = [
  { name: "Revenge trade", color: "#F87171" },
  { name: "Oversized", color: "#FB923C" },
  { name: "Chased entry", color: "#FBBF24" },
  { name: "Early exit", color: "#A3E635" },
  { name: "No stop loss", color: "#F472B6" },
  { name: "Moved stop loss", color: "#E879F9" },
  { name: "FOMO entry", color: "#60A5FA" },
  { name: "Averaged a loser", color: "#2DD4BF" },
  { name: "Overtrading", color: "#C084FC" },
];

export const DEFAULT_EMOTION_TAGS = [
  { name: "Calm", color: "#34D399" },
  { name: "Confident", color: "#60A5FA" },
  { name: "Anxious", color: "#FBBF24" },
  { name: "Greedy", color: "#FB923C" },
  { name: "Fearful", color: "#F87171" },
  { name: "Frustrated", color: "#E879F9" },
];

export const DEFAULT_RULES = [
  { text: "Risk maximum 1% of capital per trade", category: "risk" },
  { text: "Maximum 3 trades per day", category: "discipline" },
  { text: "No trading in the first 15 minutes", category: "entry" },
  { text: "Always place stop loss before entry", category: "risk" },
  { text: "Stop trading after 2 consecutive losses", category: "discipline" },
  { text: "Journal every trading day", category: "discipline" },
];

export const DEFAULT_PLAYBOOKS = [
  {
    name: "Opening Range Breakout",
    description: "Break of the first 15-minute range with volume confirmation.",
    criteria: "- 15m opening range defined\n- Breakout candle closes outside range\n- Volume above average\n- Entry on retest",
  },
  {
    name: "VWAP Reversal",
    description: "Mean reversion to VWAP after an extended move.",
    criteria: "- Price extended >1% from VWAP\n- Reversal candle pattern\n- Entry against the move, SL beyond extreme",
  },
  {
    name: "Breakout Retest",
    description: "Key level breakout, entry on successful retest.",
    criteria: "- Clear S/R level\n- Breakout with momentum\n- Retest holds on lower timeframe",
  },
];

export interface SeedOptions {
  accountName: string;
  broker: string;
  startingCapital: number;
  defaultRiskPct: number;
}

const now = () => new Date().toISOString();

/** Bootstraps a fresh journal DB: account, default tags, rules, playbooks, settings. */
export async function seedDefaults(db: DbClient, opts: SeedOptions): Promise<string> {
  const accountId = newId();
  const ts = now();
  const stmts: DbStatement[] = [
    {
      sql: `INSERT INTO accounts (id, name, broker, starting_capital, charge_profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [accountId, opts.accountName, opts.broker, opts.startingCapital, opts.broker, ts, ts],
    },
    ...DEFAULT_MISTAKE_TAGS.map((t) => ({
      sql: `INSERT OR IGNORE INTO tags (id, name, kind, color) VALUES (?, ?, 'mistake', ?)`,
      args: [newId(), t.name, t.color],
    })),
    ...DEFAULT_EMOTION_TAGS.map((t) => ({
      sql: `INSERT OR IGNORE INTO tags (id, name, kind, color) VALUES (?, ?, 'emotion', ?)`,
      args: [newId(), t.name, t.color],
    })),
    ...DEFAULT_RULES.map((r, i) => ({
      sql: `INSERT INTO rules (id, text, category, active, sort_order, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
      args: [newId(), r.text, r.category, i, ts],
    })),
    ...DEFAULT_PLAYBOOKS.map((p) => ({
      sql: `INSERT INTO playbooks (id, name, description, criteria, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [newId(), p.name, p.description, p.criteria, ts, ts],
    })),
    { sql: `INSERT OR REPLACE INTO settings (key, value) VALUES ('capital', ?)`, args: [String(opts.startingCapital)] },
    { sql: `INSERT OR REPLACE INTO settings (key, value) VALUES ('default_risk_pct', ?)`, args: [String(opts.defaultRiskPct)] },
    { sql: `INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarded', '1')`, args: [] },
  ];
  await db.batch(stmts);
  return accountId;
}

// Deterministic RNG so the demo always looks the same.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOT_SIZES: Record<string, number> = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };

/** Fills a DB with ~3 months of realistic demo trades, journals and rule checks. */
export async function seedSampleData(db: DbClient): Promise<void> {
  const accountId = await seedDefaults(db, {
    accountName: "Demo Account",
    broker: "zerodha",
    startingCapital: 500000,
    defaultRiskPct: 1,
  });

  const rand = mulberry32(20260610);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

  const playbooks = (await db.execute(`SELECT id FROM playbooks`)).rows.map((r) => String(r.id));
  const mistakeTags = (await db.execute(`SELECT id FROM tags WHERE kind = 'mistake'`)).rows.map(
    (r) => String(r.id)
  );
  const emotionTags = (await db.execute(`SELECT id FROM tags WHERE kind = 'emotion'`)).rows.map(
    (r) => String(r.id)
  );
  const rules = (await db.execute(`SELECT id FROM rules`)).rows.map((r) => String(r.id));

  const stmts: DbStatement[] = [];
  const profile = getChargeProfile("zerodha");

  for (let daysAgo = 90; daysAgo >= 1; daysAgo--) {
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    const dow = day.getDay();
    if (dow === 0 || dow === 6) continue; // market closed
    if (rand() < 0.25) continue; // not every day is traded
    const dateKey = toDateKey(day);

    const tradesToday = 1 + Math.floor(rand() * 3);
    let dayPnl = 0;

    for (let i = 0; i < tradesToday; i++) {
      const isEq = rand() < 0.15;
      const symbol = isEq
        ? pick(["RELIANCE", "HDFCBANK", "TATAMOTORS", "SBIN"])
        : pick(["NIFTY", "NIFTY", "BANKNIFTY", "SENSEX"]);
      const segment = isEq ? "EQ" : "OPT";
      const direction: "long" | "short" = rand() < 0.8 ? "long" : "short";
      const optionType = isEq ? null : rand() < 0.5 ? "CE" : "PE";
      const strike = isEq
        ? null
        : symbol === "NIFTY"
          ? Math.round(between(24000, 25500) / 50) * 50
          : symbol === "BANKNIFTY"
            ? Math.round(between(51000, 56000) / 100) * 100
            : Math.round(between(80000, 84000) / 100) * 100;
      const qty = isEq
        ? Math.round(between(10, 120))
        : (LOT_SIZES[symbol] ?? 50) * (1 + Math.floor(rand() * 3));
      const entry = isEq ? between(400, 3000) : between(80, 380);
      const win = rand() < 0.46;
      const exit = win ? entry * between(1.08, 1.55) : entry * between(0.6, 0.93);
      const plannedSl = direction === "long" ? entry * between(0.75, 0.88) : entry * between(1.12, 1.25);

      const openHour = 9 + Math.floor(rand() * 5);
      const openMin = openHour === 9 ? 16 + Math.floor(rand() * 44) : Math.floor(rand() * 60);
      const openedAt = new Date(day);
      openedAt.setHours(openHour, openMin, 0, 0);
      const closedAt = new Date(openedAt.getTime() + between(5, 110) * 60000);

      const round2 = (n: number) => Math.round(n * 100) / 100;
      const e = round2(entry);
      const x = round2(exit);
      const gross = computeGrossPnl({ direction, qty, entryPrice: e, exitPrice: x });
      const charges = computeCharges(profile, {
        segment: segment as "EQ" | "OPT",
        qty,
        entryPrice: e,
        exitPrice: x,
        direction,
      }).total;
      const net = Math.round((gross - charges) * 100) / 100;
      const r = computeRMultiple({
        direction,
        entryPrice: e,
        exitPrice: x,
        plannedEntry: e,
        plannedSl: round2(plannedSl),
      });
      dayPnl += net;

      const tradeId = newId();
      const ts = now();
      const expiry = isEq ? null : dateKey;
      stmts.push({
        sql: `INSERT INTO trades (id, account_id, symbol, exchange, segment, expiry, strike, option_type, direction, status, qty, avg_entry, avg_exit, planned_entry, planned_sl, planned_target, opened_at, closed_at, gross_pnl, charges, net_pnl, r_multiple, playbook_id, confidence, notes, created_at, updated_at)
              VALUES (?, ?, ?, 'NSE', ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        args: [
          tradeId, accountId, symbol, segment, expiry, strike, optionType, direction, qty,
          e, x, e, round2(plannedSl),
          openedAt.toISOString(), closedAt.toISOString(),
          gross, charges, net, r,
          rand() < 0.7 ? pick(playbooks) : null,
          2 + Math.floor(rand() * 4),
          ts, ts,
        ],
      });
      stmts.push({
        sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [newId(), tradeId, direction === "long" ? "buy" : "sell", qty, e, openedAt.toISOString()],
      });
      stmts.push({
        sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [newId(), tradeId, direction === "long" ? "sell" : "buy", qty, x, closedAt.toISOString()],
      });
      if (!win && rand() < 0.55) {
        stmts.push({
          sql: `INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)`,
          args: [tradeId, pick(mistakeTags)],
        });
      }
      if (rand() < 0.6) {
        stmts.push({
          sql: `INSERT OR IGNORE INTO trade_tags (trade_id, tag_id) VALUES (?, ?)`,
          args: [tradeId, pick(emotionTags)],
        });
      }
    }

    if (rand() < 0.65) {
      const ts = now();
      stmts.push({
        sql: `INSERT OR IGNORE INTO journal_entries (id, date, premarket_plan, market_notes, postmarket_review, mood, followed_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId(),
          dateKey,
          pick([
            "Bias: bullish above yesterday's high. Watching NIFTY 24800 CE.",
            "Gap-up expected. Plan: wait for ORB, no trades before 9:30.",
            "Rangebound day likely. Will only take VWAP reversals.",
            "Trend day setup. Max loss for today: ₹5,000.",
          ]),
          rand() < 0.4 ? "Choppy first hour. Sat on hands as planned." : null,
          dayPnl >= 0
            ? pick(["Followed the plan well. Patience paid.", "Good execution, exits could be better.", "Solid day — process over outcome."])
            : pick(["Forced trades in chop. Should have stopped earlier.", "Broke my own rules — revenge traded after SL hit.", "Bad day, but losses contained within limit."]),
          dayPnl >= 0 ? 3 + Math.floor(rand() * 3) : 1 + Math.floor(rand() * 3),
          dayPnl >= 0 ? 1 : rand() < 0.5 ? 1 : 0,
          ts,
          ts,
        ],
      });
    }

    for (const ruleId of rules) {
      const roll = rand();
      stmts.push({
        sql: `INSERT OR IGNORE INTO rule_checks (id, date, rule_id, status, trade_id, note) VALUES (?, ?, ?, ?, NULL, NULL)`,
        args: [newId(), dateKey, ruleId, roll < 0.82 ? "followed" : roll < 0.95 ? "broken" : "na"],
      });
    }
  }

  // Insert in chunks to stay within request limits.
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
}
