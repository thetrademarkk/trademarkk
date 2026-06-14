import type { BrokerCaptureAdapter, CapturedOrder } from "./types";
import { EXCHANGE_TOKENS, parsePriceText, parseQtyText } from "./kite";

/**
 * Fyers Web (login.fyers.in / app.fyers.in / fyers.in/web — all under
 * *.fyers.in) order-window adapter — selector generation v1 (June 2026).
 *
 * Fyers Web is a React trading terminal whose order entry is a "New Order
 * Window" (optionally pinned as a Sticky Order Window) reached from a chart's
 * Buy/Sell buttons, a watchlist row or the option chain. Like Upstox Pro,
 * Groww and Dhan it ships UTILITY / HASHED class names that change between
 * deploys, so a literal class selector is worthless across builds. Everything
 * here therefore anchors on what survives a rebuild:
 *   - visible field LABELS ("Qty"/"Quantity", "Price") walked to the adjacent
 *     <input> — by far the most durable hook on a hashed-class app;
 *   - the buy/sell SIDE read from a buy/sell class FRAGMENT on the window, the
 *     active side tab/segment text and the order button copy ("BUY" / "SELL" /
 *     "Buy SBIN" / "Place buy order");
 *   - UNHASHED class fragments via attribute-substring matchers
 *     (`[class*="orderWindow"]`, `[class*="symbol"]`) only as a last resort.
 *
 * Real Fyers sits behind a login, so these selectors are best-effort by design
 * (public DOM research only — see docs/EXTENSION_ROADMAP.md ADR v2). The reader
 * returns null the moment it can no longer make sense of the DOM, so the
 * capture affordance simply disappears rather than ship a guessed number into
 * a journal — exactly like the Kite, Upstox, Groww and Dhan adapters.
 *
 * Symbols: Fyers identifies instruments with EXCHANGE-PREFIXED, series-suffixed
 * tickers — "NSE:SBIN-EQ", "NSE:NIFTY24JUN24500CE", "MCX:CRUDEOIL24JUNFUT". The
 * app's `parseContractName` already understands this exact shape (it strips the
 * "<EXCHANGE>:" prefix and the "-EQ"/series suffix itself), so the normalizer's
 * job is the opposite of the other adapters' — it PRESERVES a Fyers-style
 * "<EXCHANGE>:SYMBOL..." token verbatim and only cleans decorations, and only
 * falls back to exchange-token stripping for plain (non-colon) names.
 *
 * Bump FYERS_ADAPTER_VERSION whenever these selectors change — it travels with
 * every capture as `adapterVersion`.
 */
export const FYERS_ADAPTER_VERSION = 1;

/* ── Pure text parsing (unit-tested in fyers.test.ts) ────────────────────── */

/** A Fyers-native instrument key: "<EXCHANGE>:SYMBOL[-SERIES]". */
const FYERS_KEY = /^(?:NSE|BSE|NFO|BFO|MCX|CDS|NCDEX|NCD|BCD):\S/;

/**
 * Fyers order-window instrument text → something the app's contract-name parser
 * (`parseContractName`) understands. Fyers' canonical form is the
 * exchange-prefixed, series-suffixed ticker ("NSE:SBIN-EQ",
 * "NSE:NIFTY24JUN24500CE") that the parser handles directly, so when the text
 * already looks like that we PRESERVE it (uppercase + strip surrounding
 * decoration only). When the header instead shows a bare name (and the exchange
 * lives in a separate tag), we fall back to the same cleanup the other adapters
 * use — drop a leading "<EXCHANGE> "/"<EXCHANGE>:" prefix, ordinal day suffixes,
 * decorations, and standalone exchange tokens.
 */
export function normalizeFyersInstrumentText(raw: string): string {
  let s = raw.toUpperCase().trim();
  // Fyers instrument strings occasionally arrive pipe-keyed; take the human part.
  if (s.includes("|")) {
    const after = s.split("|").pop() ?? "";
    if (after.trim()) s = after.trim();
  }
  // Native Fyers key ("NSE:SBIN-EQ") — keep the prefix + series suffix; the
  // parser needs them. Only strip characters that aren't valid in such a key.
  if (FYERS_KEY.test(s)) {
    return s.replace(/[^\w&.\-:]/g, "").trim();
  }
  const cleaned = s
    // Leading "<EXCHANGE>:" / "<EXCHANGE> " on a non-native name.
    // NCDEX must precede NCD — regex alternation is ordered, so "NCD" would
    // otherwise match first and leave a stray "EX" on "NCDEX: GUARSEED10".
    .replace(/^(?:NSE|BSE|NFO|BFO|MCX|CDS|NCDEX|NCD|BCD)(?::\s*|\s+)/, " ")
    .replace(/(\d+)(?:ST|ND|RD|TH)\b/g, "$1") // "25TH JUN" → "25 JUN"
    .replace(/[^\w&.\- :]/g, " ") // drop decorations, keep symbol punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  // A compact tradingsymbol with no spaces passes through; only strip standalone
  // exchange tokens from spaced names ("SBIN NSE" → "SBIN").
  if (!cleaned.includes(" ")) return cleaned;
  return cleaned
    .split(" ")
    .filter((t) => !EXCHANGE_TOKENS.has(t))
    .join(" ")
    .trim();
}

/**
 * Exchange text → a known exchange token, or null. Fyers renders the exchange a
 * few ways ("NSE", "NSE:", "NSE • Equity", "MCX Commodity"), and the native key
 * "NSE:SBIN-EQ" carries the exchange as its prefix — scan for the first
 * recognized exchange code rather than assuming the whole string is one.
 */
export function normalizeFyersExchange(raw: string): string | null {
  for (const token of raw.toUpperCase().split(/[^A-Z]+/)) {
    if (EXCHANGE_TOKENS.has(token)) return token;
  }
  return null;
}

/**
 * Buy/sell from the order window. Fyers has no single stable class, so layer:
 * a buy/sell class fragment on the window → the active side tab's text → the
 * order button copy ("BUY" / "SELL" / "Buy SBIN" / "Place buy order").
 * Ambiguous or missing → null (never guess a trade direction).
 */
export function resolveFyersSide(
  panelClasses: readonly string[],
  activeTabText: string,
  submitText: string
): "buy" | "sell" | null {
  const hasBuy = panelClasses.some((c) => /(^|[-_])buy([-_]|$)/i.test(c));
  const hasSell = panelClasses.some((c) => /(^|[-_])sell([-_]|$)/i.test(c));
  if (hasBuy !== hasSell) return hasBuy ? "buy" : "sell";
  const sideFromText = (t: string): "buy" | "sell" | null => {
    const buy = /\bbuy\b/i.test(t);
    const sell = /\bsell\b/i.test(t);
    if (buy === sell) return null; // neither or both → unknown
    return buy ? "buy" : "sell";
  };
  return sideFromText(activeTabText) ?? sideFromText(submitText);
}

/** Everything the DOM collector hands to the pure assembler. */
export interface RawFyersPanelFields {
  symbolText: string;
  exchangeText: string;
  qtyText: string;
  priceText: string;
  /** Market orders disable / hide the price input — fall back to the last price. */
  priceDisabled: boolean;
  lastPriceText: string;
  panelClasses: readonly string[];
  /** Text of the active Buy/Sell tab or segmented control, if any. */
  activeTabText: string;
  submitText: string;
}

/** Raw panel fields → capture, or null when the panel can't be trusted. */
export function assembleFyersCapture(fields: RawFyersPanelFields): CapturedOrder | null {
  const symbol = normalizeFyersInstrumentText(fields.symbolText);
  if (!symbol) return null;
  const side = resolveFyersSide(fields.panelClasses, fields.activeTabText, fields.submitText);
  if (!side) return null;
  const limit = fields.priceDisabled ? null : parsePriceText(fields.priceText);
  // Fyers carries the exchange in the symbol key ("NSE:SBIN-EQ") as well as a
  // separate tag — read the tag first, then fall back to the symbol's prefix.
  const exchange =
    normalizeFyersExchange(fields.exchangeText) ?? normalizeFyersExchange(fields.symbolText);
  return {
    broker: "fyers",
    adapterVersion: FYERS_ADAPTER_VERSION,
    symbol,
    exchange,
    side,
    qty: parseQtyText(fields.qtyText),
    price: limit ?? parsePriceText(fields.lastPriceText),
  };
}

/* ── DOM collection (covered by the Playwright fixture e2e) ──────────────── */

const visible = (el: Element): boolean => el.getClientRects().length > 0;

const text = (root: ParentNode, selector: string): string =>
  root.querySelector(selector)?.textContent?.trim() ?? "";

/** First selector that yields non-empty text. */
const firstText = (root: ParentNode, selectors: string[]): string => {
  for (const s of selectors) {
    const t = text(root, s);
    if (t) return t;
  }
  return "";
};

const isNumericInput = (input: HTMLInputElement): boolean =>
  input.type === "number" ||
  input.inputMode === "decimal" ||
  input.inputMode === "numeric" ||
  /^[\d,.\s]*$/.test(input.value);

/**
 * Label-anchored input lookup — the durable path on a hashed-class app. Walks
 * from each numeric input up to its labelling text (wrapping <label>, parent
 * container, or aria-label/placeholder/name/id) and matches it against `match`.
 */
function inputByLabel(
  panel: HTMLElement,
  match: RegExp,
  exclude?: RegExp
): HTMLInputElement | null {
  for (const input of panel.querySelectorAll<HTMLInputElement>("input")) {
    if (!isNumericInput(input)) continue;
    const scope = input.closest("label") ?? input.parentElement;
    const label = [
      scope?.textContent?.trim() ?? "",
      input.getAttribute("aria-label") ?? "",
      input.getAttribute("placeholder") ?? "",
      input.getAttribute("name") ?? "",
      input.id,
    ].join(" ");
    if (match.test(label) && !(exclude && exclude.test(label))) return input;
  }
  return null;
}

/** name/id/testid attr first, then label-text anchoring (Fyers classes are hashed). */
function findInput(panel: HTMLElement, names: string[], match: RegExp, exclude?: RegExp) {
  for (const name of names) {
    const byName =
      panel.querySelector<HTMLInputElement>(`input[name='${name}']`) ??
      panel.querySelector<HTMLInputElement>(`input#${name}`) ??
      panel.querySelector<HTMLInputElement>(`input[data-testid='${name}']`);
    if (byName) return byName;
  }
  return inputByLabel(panel, match, exclude);
}

/** Text of the currently-selected Buy/Sell tab/segment, if the window has one. */
function activeTabText(panel: HTMLElement): string {
  const active = panel.querySelector<HTMLElement>(
    "[aria-selected='true'], [aria-pressed='true'], [class*='active'], [class*='selected'], [class*='Active'], [class*='Selected']"
  );
  const t = active?.textContent?.trim() ?? "";
  return /\b(buy|sell)\b/i.test(t) ? t : "";
}

function collectRawFields(panel: HTMLElement): RawFyersPanelFields {
  const qtyInput = findInput(
    panel,
    ["quantity", "qty", "order-quantity", "orderQty"],
    /\bqty\b|quantity/i,
    /disclosed|trigger|stop|target|sl\b/i
  );
  const priceInput = findInput(
    panel,
    ["price", "order-price", "limit-price", "limitPrice"],
    /\bprice\b/i,
    /trigger|stop|target|last|ltp|average|avg|sl\b/i
  );
  return {
    symbolText: firstText(panel, [
      // Fyers idioms (hashed/utility classes, public research): the order window
      // header carries the exchange-prefixed symbol ("NSE:SBIN-EQ").
      "[class*='symbolName']",
      "[class*='SymbolName']",
      "[class*='symbol-name']",
      "[class*='tradingSymbol']",
      "[class*='tradingsymbol']",
      "[class*='TradingSymbol']",
      "[class*='instrumentName']",
      "[class*='contractName']",
      "[class*='_symbol']",
      "[class*='Symbol']",
      "[data-testid*='symbol']",
      "[data-testid*='contract']",
      "h1, h2, h3",
    ]),
    exchangeText: firstText(panel, [
      "[class*='exchange']",
      "[class*='Exchange']",
      "[class*='segment']",
      "[class*='Segment']",
      "[data-testid*='exchange']",
    ]),
    qtyText: qtyInput?.value ?? "",
    priceText: priceInput?.value ?? "",
    // A missing price input is treated like a disabled one (market order).
    priceDisabled: priceInput ? priceInput.disabled : true,
    lastPriceText: firstText(panel, [
      "[class*='ltp']",
      "[class*='Ltp']",
      "[class*='LTP']",
      "[class*='last-price']",
      "[class*='lastPrice']",
      "[class*='LastPrice']",
      "[data-testid*='ltp']",
    ]),
    panelClasses: Array.from(panel.classList),
    activeTabText: activeTabText(panel),
    submitText: firstText(panel, [
      "button[type='submit']",
      "[class*='placeOrder']",
      "[class*='PlaceOrder']",
      "[class*='place-order']",
      "[class*='confirm']",
      "[class*='submit']",
      "button",
    ]),
  };
}

export const fyersAdapter: BrokerCaptureAdapter = {
  id: "fyers",
  label: "Fyers",
  version: FYERS_ADAPTER_VERSION,
  // Fyers Web spans login.fyers.in / app.fyers.in / fyers.in/web (and the
  // Scalper terminal) — all under *.fyers.in; the user grants the host once.
  originPattern: "https://*.fyers.in/*",
  contentScript: "content-fyers.js",

  findOrderPanel(root: ParentNode): HTMLElement | null {
    const candidates = root.querySelectorAll<HTMLElement>(
      [
        "[class*='orderWindow']",
        "[class*='OrderWindow']",
        "[class*='order-window']",
        "[class*='orderPad']",
        "[class*='OrderPad']",
        "[class*='order-pad']",
        "[class*='orderForm']",
        "[class*='OrderForm']",
        "[class*='order-form']",
        "[class*='orderTicket']",
        "[class*='order-ticket']",
        "[class*='orderEntry']",
        "[class*='OrderEntry']",
        "[class*='buySell']",
        "[class*='BuySell']",
        "[class*='placeOrder']",
        "[class*='PlaceOrder']",
        "[role='dialog']",
        "form",
      ].join(", ")
    );
    for (const el of candidates) {
      // A real order window holds a quantity field — anything else (toasts,
      // unrelated dialogs/forms that share a class fragment) is ignored.
      if (!visible(el)) continue;
      if (findInput(el, ["quantity", "qty"], /\bqty\b|quantity/i, /disclosed|trigger/i)) {
        return el;
      }
    }
    return null;
  },

  readOrder(panel: HTMLElement): CapturedOrder | null {
    try {
      return assembleFyersCapture(collectRawFields(panel));
    } catch {
      return null; // degrade silently — never break the broker page
    }
  },
};
