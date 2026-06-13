import { newId } from "@/lib/id";
import { computeCharges, computeGrossPnl, computeRMultiple } from "@/lib/charges/charges";
import type { Product, Segment } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import { toDateKey } from "@/lib/utils";
import {
  DEFAULT_TRADER_TYPE,
  sanitizeTraderProfile,
  TRADER_PROFILE_KEY,
  type TraderType,
} from "@/features/onboarding/trader-profile";
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
    criteria:
      "- 15m opening range defined\n- Breakout candle closes outside range\n- Volume above average\n- Entry on retest",
  },
  {
    name: "VWAP Reversal",
    description: "Mean reversion to VWAP after an extended move.",
    criteria:
      "- Price extended >1% from VWAP\n- Reversal candle pattern\n- Entry against the move, SL beyond extreme",
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
  /**
   * SEG-08 — the user's trader type, persisted as the `trader_profile.v1`
   * setting so the trade form + dashboard pick matching defaults. Defaults to
   * `mixed` (the neutral pre-SEG-08 behaviour).
   */
  traderType?: TraderType;
}

const now = () => new Date().toISOString();

/** Bootstraps a fresh journal DB: account, default tags, rules, playbooks, settings. */
export async function seedDefaults(db: DbClient, opts: SeedOptions): Promise<string> {
  const accountId = newId();
  const ts = now();
  const traderType = sanitizeTraderProfile({
    traderType: opts.traderType ?? DEFAULT_TRADER_TYPE,
  }).traderType;
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
    {
      sql: `INSERT OR REPLACE INTO settings (key, value) VALUES ('capital', ?)`,
      args: [String(opts.startingCapital)],
    },
    {
      sql: `INSERT OR REPLACE INTO settings (key, value) VALUES ('default_risk_pct', ?)`,
      args: [String(opts.defaultRiskPct)],
    },
    // SEG-08 — persist the trader profile (additive, idempotent key/value row).
    {
      sql: `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
      args: [TRADER_PROFILE_KEY, JSON.stringify({ traderType })],
    },
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

const LOT_SIZES: Record<string, number> = {
  NIFTY: 75,
  BANKNIFTY: 35,
  SENSEX: 20,
  CRUDEOIL: 100,
  GOLD: 100,
  SILVER: 30,
  NATURALGAS: 1250,
  USDINR: 1000,
  EURINR: 1000,
  GBPINR: 1000,
};

/**
 * SEG-08 — a per-trader-type recipe for the per-day single-trade generator. The
 * multi-day templates (swing) and derivative books (F&O/commodity/currency) are
 * shaped so the dashboard, holding-period analytics and tax views all read the
 * intended style straight away. All money flows through the same paise-correct
 * charge engine with the CORRECT (segment, product) so charges match reality
 * (e.g. swing CNC pays delivery STT + DP, not intraday STT).
 */
interface TraderRecipe {
  /** Instruments to pick from, with their segment + how to price/size them. */
  segment: Segment;
  product: Product;
  /** Min/max calendar days the trade is held (0 = same IST day = intraday). */
  holdDays: [number, number];
  /** Symbols this trader trades. */
  symbols: string[];
  /** Whether trades carry strike/CE-PE/expiry (OPT only). */
  option: boolean;
  /** Exchange stored on the row (drives per-exchange txn charges). */
  exchange: string;
  /** Price band for a single leg/contract. */
  price: [number, number];
}

const RECIPES: Record<Exclude<TraderType, "mixed">, TraderRecipe> = {
  "intraday-equity": {
    segment: "EQ",
    product: "MIS",
    holdDays: [0, 0],
    symbols: ["RELIANCE", "HDFCBANK", "TATAMOTORS", "SBIN", "INFY", "ICICIBANK"],
    option: false,
    exchange: "NSE",
    price: [400, 3000],
  },
  swing: {
    segment: "EQ",
    product: "CNC",
    holdDays: [2, 12],
    symbols: ["RELIANCE", "HDFCBANK", "TATAMOTORS", "SBIN", "INFY", "ITC"],
    option: false,
    exchange: "NSE",
    price: [400, 3000],
  },
  fno: {
    segment: "OPT",
    product: "NRML",
    holdDays: [0, 3],
    symbols: ["NIFTY", "NIFTY", "BANKNIFTY", "SENSEX"],
    option: true,
    exchange: "NSE",
    price: [80, 380],
  },
  commodity: {
    segment: "COMM",
    product: "NRML",
    holdDays: [0, 5],
    symbols: ["CRUDEOIL", "GOLD", "SILVER", "NATURALGAS"],
    option: false,
    exchange: "MCX",
    price: [200, 7000],
  },
  currency: {
    segment: "CDS",
    product: "NRML",
    holdDays: [0, 4],
    symbols: ["USDINR", "EURINR", "GBPINR"],
    option: false,
    exchange: "NSE",
    price: [83, 95],
  },
};

/** Fills a DB with ~3 months of realistic demo trades, journals and rule checks. */
export async function seedSampleData(
  db: DbClient,
  traderType: TraderType = DEFAULT_TRADER_TYPE
): Promise<void> {
  const type = sanitizeTraderProfile({ traderType }).traderType;
  const accountId = await seedDefaults(db, {
    accountName: "Demo Account",
    broker: "zerodha",
    startingCapital: 500000,
    defaultRiskPct: 1,
    traderType: type,
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
  const round2 = (n: number) => Math.round(n * 100) / 100;

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
      // Pick the recipe for this trade. A `mixed` book blends every type so the
      // demo shows the full app; a typed book uses that type's recipe so the
      // dashboard/analytics/tax read the intended style straight away.
      const recipe = type === "mixed" ? RECIPES[pick(MIXED_TYPES)] : RECIPES[type];

      const symbol = pick(recipe.symbols);
      const segment = recipe.segment;
      const product = recipe.product;
      const direction: "long" | "short" = rand() < 0.78 ? "long" : "short";
      const optionType = recipe.option ? (rand() < 0.5 ? "CE" : "PE") : null;
      const strike = recipe.option
        ? symbol === "NIFTY"
          ? Math.round(between(24000, 25500) / 50) * 50
          : symbol === "BANKNIFTY"
            ? Math.round(between(51000, 56000) / 100) * 100
            : Math.round(between(80000, 84000) / 100) * 100
        : null;
      const lot = LOT_SIZES[symbol];
      const qty = lot ? lot * (1 + Math.floor(rand() * 3)) : Math.round(between(10, 120));
      const entry = between(recipe.price[0], recipe.price[1]);
      const win = rand() < 0.46;
      const exit = win ? entry * between(1.05, 1.4) : entry * between(0.66, 0.95);
      const plannedSl =
        direction === "long" ? entry * between(0.8, 0.9) : entry * between(1.1, 1.2);
      // A planned target on the same side as the trade (≈ 1.5–2.5R from entry),
      // so plan-adherence (target hit / cut early / stopped) has data to grade.
      const plannedTarget =
        direction === "long" ? entry * between(1.18, 1.4) : entry * between(0.6, 0.82);

      // Hold span: intraday (0 days) squares off the same session; multi-day
      // (swing/positional) holds a whole number of calendar days so the
      // holding-period analytics + capital-gains classification have real spans.
      const holdDays =
        recipe.holdDays[0] + Math.floor(rand() * (recipe.holdDays[1] - recipe.holdDays[0] + 1));
      const openHour = 9 + Math.floor(rand() * 5);
      const openMin = openHour === 9 ? 16 + Math.floor(rand() * 44) : Math.floor(rand() * 60);
      const openedAt = new Date(day);
      openedAt.setHours(openHour, openMin, 0, 0);
      const closedAt =
        holdDays === 0
          ? new Date(openedAt.getTime() + between(5, 110) * 60000)
          : (() => {
              const c = new Date(openedAt);
              c.setDate(c.getDate() + holdDays);
              c.setHours(10 + Math.floor(rand() * 5), Math.floor(rand() * 60), 0, 0);
              return c;
            })();

      const e = round2(entry);
      const x = round2(exit);
      const gross = computeGrossPnl({ direction, qty, entryPrice: e, exitPrice: x });
      const charges = computeCharges(profile, {
        segment,
        product,
        exchange: recipe.exchange,
        qty,
        entryPrice: e,
        exitPrice: x,
        direction,
      }).total;
      const net = round2(gross - charges);
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
      // Derivative expiry sits on/after the close; equity has none.
      const expiry = recipe.option
        ? toDateKey(new Date(closedAt.getTime() + Math.floor(rand() * 3) * 86_400_000))
        : null;
      stmts.push({
        sql: `INSERT INTO trades (id, account_id, symbol, exchange, segment, product, expiry, strike, option_type, direction, status, qty, avg_entry, avg_exit, planned_entry, planned_sl, planned_target, opened_at, closed_at, gross_pnl, charges, net_pnl, r_multiple, playbook_id, confidence, notes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        args: [
          tradeId,
          accountId,
          symbol,
          recipe.exchange,
          segment,
          product,
          expiry,
          strike,
          optionType,
          direction,
          qty,
          e,
          x,
          e,
          round2(plannedSl),
          round2(plannedTarget),
          openedAt.toISOString(),
          closedAt.toISOString(),
          gross,
          charges,
          net,
          r,
          rand() < 0.7 ? pick(playbooks) : null,
          2 + Math.floor(rand() * 4),
          ts,
          ts,
        ],
      });
      stmts.push({
        sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          newId(),
          tradeId,
          direction === "long" ? "buy" : "sell",
          qty,
          e,
          openedAt.toISOString(),
        ],
      });
      stmts.push({
        sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          newId(),
          tradeId,
          direction === "long" ? "sell" : "buy",
          qty,
          x,
          closedAt.toISOString(),
        ],
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
            ? pick([
                "Followed the plan well. Patience paid.",
                "Good execution, exits could be better.",
                "Solid day — process over outcome.",
              ])
            : pick([
                "Forced trades in chop. Should have stopped earlier.",
                "Broke my own rules — revenge traded after SL hit.",
                "Bad day, but losses contained within limit.",
              ]),
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

  // ── Multi-leg option strategies ────────────────────────────────────────
  // A spread of straddles / strangles / verticals so the payoff diagram,
  // strategy grouping and DTE buckets all have realistic data to render. These
  // are F&O structures, so they're seeded for an F&O or mixed book (a swing or
  // commodity trader's demo shouldn't carry option spreads it doesn't use).
  if (type === "fno" || type === "mixed") {
    seedMultiLegTrades(stmts, accountId, profile, rand);
  }

  // Insert in chunks to stay within request limits.
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
}

/** The trader types a `mixed` demo blends across (every concrete recipe). */
const MIXED_TYPES: Exclude<TraderType, "mixed">[] = [
  "intraday-equity",
  "swing",
  "fno",
  "commodity",
  "currency",
];

interface SeedLeg {
  strike: number;
  optionType: "CE" | "PE";
  direction: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
}

interface MultiLegTemplate {
  symbol: keyof typeof LOT_SIZES;
  /** Days from entry to expiry — drives the DTE bucket. */
  dte: number;
  /** How many days ago the trade was opened. */
  daysAgo: number;
  legs: Omit<SeedLeg, "qty">[];
  /** Lots per leg (qty = lots × lot size). */
  lots: number;
}

/**
 * Deterministic multi-leg option strategies. Quantities use the real lot size
 * so notional/payoff are realistic. Several DTE buckets are covered.
 */
function seedMultiLegTrades(
  stmts: DbStatement[],
  accountId: string,
  profile: ReturnType<typeof getChargeProfile>,
  rand: () => number
): void {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Repeat the catalogue so each structure clears the n>=5 DTE/strategy gate.
  // Strikes are deliberately outside the random single-leg generator's range
  // (NIFTY 24000–25500, BANKNIFTY 51000–56000) so each multi-leg trade is
  // uniquely identifiable in the trades table for e2e + the demo.
  const catalogue: MultiLegTemplate[] = [
    // Long straddle (same strike CE+PE), short-dated.
    {
      symbol: "NIFTY",
      dte: 0,
      daysAgo: 30,
      lots: 1,
      legs: [
        { strike: 26000, optionType: "CE", direction: "long", entry: 90, exit: 140 },
        { strike: 26000, optionType: "PE", direction: "long", entry: 85, exit: 40 },
      ],
    },
    // Short strangle (sell OTM CE + OTM PE), weekly.
    {
      symbol: "BANKNIFTY",
      dte: 4,
      daysAgo: 28,
      lots: 1,
      legs: [
        { strike: 58000, optionType: "CE", direction: "short", entry: 120, exit: 60 },
        { strike: 50000, optionType: "PE", direction: "short", entry: 110, exit: 55 },
      ],
    },
    // Bull call spread (buy lower, sell higher), monthly.
    {
      symbol: "NIFTY",
      dte: 25,
      daysAgo: 40,
      lots: 2,
      legs: [
        { strike: 26500, optionType: "CE", direction: "long", entry: 220, exit: 320 },
        { strike: 27000, optionType: "CE", direction: "short", entry: 90, exit: 130 },
      ],
    },
    // Bear put spread, mid-dated.
    {
      symbol: "NIFTY",
      dte: 6,
      daysAgo: 22,
      lots: 1,
      legs: [
        { strike: 23500, optionType: "PE", direction: "long", entry: 180, exit: 250 },
        { strike: 23000, optionType: "PE", direction: "short", entry: 70, exit: 95 },
      ],
    },
    // Long strangle, far-dated.
    {
      symbol: "BANKNIFTY",
      dte: 45,
      daysAgo: 50,
      lots: 1,
      legs: [
        { strike: 58500, optionType: "CE", direction: "long", entry: 300, exit: 210 },
        { strike: 49000, optionType: "PE", direction: "long", entry: 280, exit: 360 },
      ],
    },
  ];

  // Three passes with small entry/exit jitter → n>=5 per bucket, varied P&L.
  for (let pass = 0; pass < 3; pass++) {
    for (const tpl of catalogue) {
      const lotSize = LOT_SIZES[tpl.symbol] ?? 50;
      const qty = lotSize * tpl.lots;
      const opened = new Date();
      opened.setDate(opened.getDate() - (tpl.daysAgo - pass * 2));
      opened.setHours(10, 15 + pass * 5, 0, 0);
      const closed = new Date(opened.getTime() + (40 + pass * 10) * 60000);
      const expiry = new Date(opened);
      expiry.setDate(expiry.getDate() + tpl.dte);

      const legs: SeedLeg[] = tpl.legs.map((l) => ({
        ...l,
        qty,
        entry: round2(l.entry * (0.97 + rand() * 0.06)),
        exit: round2(l.exit * (0.97 + rand() * 0.06)),
      }));

      let gross = 0;
      let charges = 0;
      for (const leg of legs) {
        gross += computeGrossPnl({
          direction: leg.direction,
          qty: leg.qty,
          entryPrice: leg.entry,
          exitPrice: leg.exit,
        });
        charges += computeCharges(profile, {
          segment: "OPT",
          product: "NRML",
          qty: leg.qty,
          entryPrice: leg.entry,
          exitPrice: leg.exit,
          direction: leg.direction,
        }).total;
      }
      gross = round2(gross);
      charges = round2(charges);
      const net = round2(gross - charges);

      const tradeId = newId();
      const ts = now();
      const leg1 = legs[0]!;
      // Leg 1 lives in the top-level fields; legs 2..N go in trade_legs.
      stmts.push({
        sql: `INSERT INTO trades (id, account_id, symbol, exchange, segment, product, expiry, strike, option_type, direction, status, qty, avg_entry, avg_exit, planned_entry, planned_sl, planned_target, opened_at, closed_at, gross_pnl, charges, net_pnl, r_multiple, playbook_id, confidence, notes, created_at, updated_at)
              VALUES (?, ?, ?, 'NSE', 'OPT', 'NRML', ?, ?, ?, ?, 'closed', ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
        args: [
          tradeId,
          accountId,
          tpl.symbol,
          toDateKey(expiry),
          leg1.strike,
          leg1.optionType,
          leg1.direction,
          leg1.qty,
          leg1.entry,
          leg1.exit,
          opened.toISOString(),
          closed.toISOString(),
          gross,
          charges,
          net,
          3 + Math.floor(rand() * 3),
          ts,
          ts,
        ],
      });
      legs.forEach((leg, i) => {
        stmts.push({
          sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            newId(),
            tradeId,
            leg.direction === "long" ? "buy" : "sell",
            leg.qty,
            leg.entry,
            opened.toISOString(),
          ],
        });
        stmts.push({
          sql: `INSERT INTO trade_fills (id, trade_id, side, qty, price, fill_time) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            newId(),
            tradeId,
            leg.direction === "long" ? "sell" : "buy",
            leg.qty,
            leg.exit,
            closed.toISOString(),
          ],
        });
        stmts.push({
          sql: `INSERT INTO trade_legs (id, trade_id, leg_no, strike, option_type, direction, qty, avg_entry, avg_exit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            newId(),
            tradeId,
            i + 1,
            leg.strike,
            leg.optionType,
            leg.direction,
            leg.qty,
            leg.entry,
            leg.exit,
          ],
        });
      });
    }
  }
}
