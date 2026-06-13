import type { BrokerId } from "./types";
import {
  EXCHANGE_TOKENS,
  normalizeKiteInstrumentText,
  parsePriceText,
  parseQtyText,
} from "./kite";

/**
 * Zerodha Kite (kite.zerodha.com) tradebook/orderbook adapter — reads the
 * EXECUTED orders out of the authenticated Orders page DOM so they can be
 * imported into the journal. Selector generation v1 (June 2026).
 *
 * Kite is a table-based app: the Orders page stacks a pending section and a
 * completed/executed section, each a `<table>` whose rows carry
 * `td.instrument` (`span.tradingsymbol` + `span.exchange`), `td.product`,
 * `td.quantity`, an average-price cell, a transaction-type cell (a `.buy`/
 * `.sell` class and/or BUY/SELL text) and `td.order-status`. Class names are
 * cross-checked against community userscripts and a published Kite extension;
 * real Kite sits behind a login, so the readers are layered (class → cell
 * class → text anchors) and DEGRADE SILENTLY: a row we can't fully trust is
 * skipped, never guessed. We import only COMPLETE/executed orders — pending,
 * cancelled and rejected rows are left out.
 *
 * Privacy: reads ONLY the per-fill fields a trade row needs (symbol, exchange,
 * side, qty, price, time, status). Balances, holdings, margins and free funds
 * are never touched. See docs/extension.md → Privacy.
 *
 * Bump KITE_POSITIONS_VERSION whenever these selectors change — it travels
 * with every import as `adapterVersion`.
 */
export const KITE_POSITIONS_VERSION = 1;

/* ── Pure parsing (unit-tested in kite-positions.test.ts) ────────────────── */

/** A single executed fill collected from one tradebook row. */
export interface ImportedFill {
  broker: BrokerId;
  adapterVersion: number;
  /** Instrument text, normalized for the app's contract-name parser. */
  symbol: string;
  exchange: string | null;
  side: "buy" | "sell";
  qty: number;
  price: number;
  /** Best-effort ISO timestamp of the fill, or null when the time is unreadable. */
  time: string | null;
}

/** Raw text the DOM collector pulls from one tradebook `<tr>`. */
export interface RawTradebookRow {
  symbolText: string;
  exchangeText: string;
  /** "BUY"/"SELL" text if a transaction-type cell exists. */
  sideText: string;
  /** Class tokens on the row / transaction-type cell (Kite tags `.buy`/`.sell`). */
  sideClasses: readonly string[];
  /** Filled quantity — Kite shows "10 / 10" (filled / total). */
  qtyText: string;
  /** Average fill price. */
  priceText: string;
  /** Order status text, e.g. "COMPLETE", "REJECTED", "OPEN". */
  statusText: string;
  /** Execution time as rendered, e.g. "10:30:45" or "2026-06-12 10:30:45". */
  timeText: string;
}

/** Only fully-executed orders become fills — never pending/cancelled/rejected. */
export function isExecutedStatus(statusText: string): boolean {
  return /\bcomplet|\bexecuted\b|\bfilled\b/i.test(statusText);
}

const REJECTED_RE = /reject|cancel|pending|open|trigger pending|put order req/i;

/**
 * Side from a tradebook row: Kite color-codes buy (blue) / sell (red) and tags
 * the transaction-type cell with a `buy`/`sell` class; the BUY/SELL text is the
 * fallback anchor. Unknown → null (never guess a trade direction).
 */
export function resolveTradeSide(
  sideClasses: readonly string[],
  sideText: string
): "buy" | "sell" | null {
  const hasBuy = sideClasses.includes("buy");
  const hasSell = sideClasses.includes("sell");
  if (hasBuy !== hasSell) return hasBuy ? "buy" : "sell";
  if (/\bbuy\b/i.test(sideText)) return "buy";
  if (/\bsell\b/i.test(sideText)) return "sell";
  return null;
}

/** "10 / 10" → 10 (filled side); "1,250" → 1250; 0/garbage → null. */
export function parseFilledQty(raw: string): number | null {
  // Kite renders filled/total ("10 / 10") — the filled count is what executed.
  const filled = raw.split("/")[0] ?? raw;
  return parseQtyText(filled);
}

/**
 * Tradebook execution time → ISO. Kite renders either a bare clock
 * ("10:30:45") or a full "YYYY-MM-DD HH:MM:SS". A bare clock is anchored to
 * `dayHintIso` (the page is the user's CURRENT trading day) so same-day
 * imports get an honest timestamp; anything unreadable returns null rather
 * than inventing a time.
 */
export function parseTradeTime(raw: string, dayHintIso: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // Full date+time the broker rendered (ISO-ish "2026-06-12 10:30:45").
  const full = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (full) {
    const [, y, mo, d, hh, mm, ss] = full;
    const date = new Date(
      `${y}-${mo}-${d}T${pad(hh!)}:${mm}:${ss ?? "00"}`
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  // Bare clock ("10:30:45" / "10:30") — anchor to the page's trading day.
  const clock = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) {
    const day = dayHintIso.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const [, hh, mm, ss] = clock;
    const date = new Date(`${day}T${pad(hh!)}:${mm}:${ss ?? "00"}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

const pad = (s: string) => s.padStart(2, "0");

/**
 * One raw tradebook row → an executed fill, or null when the row can't be
 * trusted (not executed, unknown side, zero/garbage qty or price, unparseable
 * symbol). The whole import is built only from rows that survive this gate.
 */
export function assembleFill(row: RawTradebookRow, dayHintIso: string): ImportedFill | null {
  // Skip anything that isn't a clean executed order.
  if (REJECTED_RE.test(row.statusText)) return null;
  // A status cell that exists must say "complete/executed"; an empty status
  // cell (some Kite builds omit it on the executed tab) is allowed through.
  if (row.statusText.trim() && !isExecutedStatus(row.statusText)) return null;

  const symbol = normalizeKiteInstrumentText(row.symbolText);
  if (!symbol) return null;
  const side = resolveTradeSide(row.sideClasses, row.sideText);
  if (!side) return null;
  const qty = parseFilledQty(row.qtyText);
  if (qty == null) return null;
  const price = parsePriceText(row.priceText);
  if (price == null) return null;

  const exchange = row.exchangeText.trim().toUpperCase();
  return {
    broker: "kite",
    adapterVersion: KITE_POSITIONS_VERSION,
    symbol,
    exchange: EXCHANGE_TOKENS.has(exchange) ? exchange : null,
    side,
    qty,
    price,
    time: parseTradeTime(row.timeText, dayHintIso),
  };
}

/** Assemble every trustworthy fill from a page's worth of raw rows. */
export function assembleFills(rows: RawTradebookRow[], dayHintIso: string): ImportedFill[] {
  const fills: ImportedFill[] = [];
  for (const row of rows) {
    const fill = assembleFill(row, dayHintIso);
    if (fill) fills.push(fill);
  }
  return fills;
}

/* ── DOM collection (covered by the Playwright fixture e2e) ──────────────── */

const text = (root: ParentNode, selector: string): string =>
  root.querySelector(selector)?.textContent?.trim() ?? "";

const firstText = (root: ParentNode, selectors: string[]): string => {
  for (const s of selectors) {
    const t = text(root, s);
    if (t) return t;
  }
  return "";
};

/** Pulls the raw text fields out of one executed-order `<tr>`. */
function collectRow(tr: HTMLElement): RawTradebookRow {
  const instrument = tr.querySelector<HTMLElement>("td.instrument, .instrument");
  const sideCell = tr.querySelector<HTMLElement>(
    "td.transaction-type, .transaction-type, td.order-type, .buysell"
  );
  const sideClasses = [
    ...Array.from(tr.classList),
    ...(sideCell ? Array.from(sideCell.classList) : []),
    ...(sideCell?.querySelector(".buy, .sell")
      ? Array.from(sideCell.querySelector(".buy, .sell")!.classList)
      : []),
  ];
  return {
    symbolText: instrument
      ? firstText(instrument, ["span.tradingsymbol", ".tradingsymbol", ".nice-name"])
      : firstText(tr, ["td.tradingsymbol", ".tradingsymbol"]),
    exchangeText: instrument
      ? firstText(instrument, ["span.exchange", ".exchange", "span.exchange-tag"])
      : firstText(tr, [".exchange", ".exchange-tag"]),
    sideText: sideCell?.textContent?.trim() ?? "",
    sideClasses,
    qtyText: firstText(tr, ["td.quantity", ".quantity", "td.qty", ".qty"]),
    priceText: firstText(tr, [
      "td.average-price",
      ".average-price",
      "td.average",
      ".average",
      "td.avg-price",
      "td.price",
    ]),
    statusText: firstText(tr, ["td.order-status", ".order-status", "td.status", ".status"]),
    timeText: firstText(tr, ["td.time", ".time", "td.order-timestamp", ".order-timestamp"]),
  };
}

const visible = (el: Element): boolean => el.getClientRects().length > 0;

/**
 * Finds every executed-order row in the page. Prefers Kite's
 * `.completed-orders`/`.executed-orders` section, then falls back to any
 * orders/tradebook table — only rows carrying an `.instrument` cell (a real
 * order row, not a header/spacer/expander) are returned.
 */
export function findTradebookRows(root: ParentNode): HTMLElement[] {
  const scopes = [
    ".completed-orders",
    ".executed-orders",
    "[class*='completed-orders']",
    "[class*='executed-orders']",
    ".orders",
    ".tradebook",
    "[class*='tradebook']",
  ];
  const seen = new Set<HTMLElement>();
  const rows: HTMLElement[] = [];
  const add = (tr: HTMLElement) => {
    if (seen.has(tr) || !visible(tr)) return;
    if (tr.classList.contains("show-all-row")) return; // Kite footer/expander
    if (!tr.querySelector("td.instrument, .instrument, .tradingsymbol")) return;
    seen.add(tr);
    rows.push(tr);
  };
  for (const scope of scopes) {
    const container = root.querySelector(scope);
    if (!container) continue;
    for (const tr of container.querySelectorAll<HTMLElement>("tbody tr, tr.order, [role='row']")) {
      add(tr);
    }
    if (rows.length) return rows; // first matching section wins
  }
  return rows;
}

export interface KitePositionsAdapter {
  id: BrokerId;
  label: string;
  /** Bump on every selector change — imports carry it as `adapterVersion`. */
  version: number;
  /** Match patterns the user grants to read the Orders/Positions pages. */
  originPattern: string;
  /** Built content-script bundle, relative to the extension dist root. */
  contentScript: string;
  /** Pages the import affordance is offered on. */
  pageHints: readonly string[];
  /** Collect every trustworthy executed fill from the live DOM. */
  readFills(root: ParentNode, dayHintIso: string): ImportedFill[];
}

export const kitePositionsAdapter: KitePositionsAdapter = {
  id: "kite",
  label: "Zerodha Kite",
  version: KITE_POSITIONS_VERSION,
  originPattern: "https://kite.zerodha.com/*",
  contentScript: "content-kite-positions.js",
  pageHints: ["/orders", "/positions", "/tradebook"],

  readFills(root: ParentNode, dayHintIso: string): ImportedFill[] {
    try {
      const rows = findTradebookRows(root).map(collectRow);
      return assembleFills(rows, dayHintIso);
    } catch {
      return []; // degrade silently — never break the broker page
    }
  },
};
