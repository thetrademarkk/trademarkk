import type { BrokerCaptureAdapter, CapturedOrder } from "./types";
import { EXCHANGE_TOKENS, parsePriceText, parseQtyText } from "./kite";

/**
 * Groww (groww.in) order-window adapter — selector generation v1 (June 2026).
 *
 * Groww's web trading terminal ("915") is a React app whose order placement is
 * a side/bottom sheet (the "Buy"/"Sell" order pad reached from a stock, F&O or
 * MTF page). Like Upstox Pro it ships UTILITY / HASHED class names that change
 * between deploys, so a literal class selector is worthless across builds.
 * Everything here therefore anchors on what survives a rebuild:
 *   - visible field LABELS ("Qty"/"Quantity", "Price") walked to the adjacent
 *     <input> — by far the most durable hook on a hashed-class app;
 *   - the buy/sell SIDE read from a buy/sell class FRAGMENT on the pad, the
 *     active side tab text and the order button copy ("BUY" / "SELL" /
 *     "Buy RELIANCE" / "Place buy order");
 *   - UNHASHED class fragments via attribute-substring matchers
 *     (`[class*="orderPad"]`, `[class*="contractName"]`) only as a last resort.
 *
 * Real Groww sits behind a login, so these selectors are best-effort by design
 * (public DOM research only — see docs/EXTENSION_ROADMAP.md ADR v2). The reader
 * returns null the moment it can no longer make sense of the DOM, so the
 * capture affordance simply disappears rather than ship a guessed number into
 * a journal — exactly like the Kite and Upstox adapters.
 *
 * Groww renders F&O contracts as SPACED names — "NIFTY 25 JUN 2026 24500 CALL",
 * "BANKNIFTY 26JUN2026 52000 CE" — which the app's `parseContractName` already
 * understands (CALL/PUT → CE/PE), so normalization preserves the spacing and
 * only strips decorations + standalone exchange tokens.
 *
 * Bump GROWW_ADAPTER_VERSION whenever these selectors change — it travels with
 * every capture as `adapterVersion`.
 */
export const GROWW_ADAPTER_VERSION = 1;

/* ── Pure text parsing (unit-tested in groww.test.ts) ────────────────────── */

/**
 * Groww order-window instrument text → something the app's contract-name parser
 * (`parseContractName`) understands. Groww renders names a few ways — a compact
 * tradingsymbol ("RELIANCE"), an exchange-prefixed name ("NSE: RELIANCE",
 * "NSE_EQ|RELIANCE") or (the common F&O case) a SPACED derivative name
 * ("NIFTY 25 JUN 2026 24500 CALL", "BANKNIFTY 26JUN2026 52000 CE") — so we:
 * uppercase, take the part after any pipe key, drop a leading "<EXCHANGE>:" /
 * "<EXCHANGE>_<SEGMENT>|" / "<EXCHANGE> " prefix, strip ordinal day suffixes
 * ("25th JUN" → "25 JUN"), strip decorations (keeping symbol punctuation and
 * spaces so spaced contract names survive intact), and remove any standalone
 * exchange tokens left over. Compact tradingsymbols pass through.
 */
export function normalizeGrowwInstrumentText(raw: string): string {
  let s = raw.toUpperCase().trim();
  // Groww instrument keys occasionally arrive pipe-keyed ("NSE_EQ|RELIANCE",
  // "NSE_FO|NIFTY..."). Take the part after the pipe — the human/tradingsymbol.
  if (s.includes("|")) {
    const after = s.split("|").pop() ?? "";
    if (after.trim()) s = after.trim();
  }
  const cleaned = s
    // Leading "<EXCHANGE>:" / "<EXCHANGE> " — parseContractName also strips the
    // colon form, but doing it here keeps the standalone-token filter below from
    // misfiring on a spaced "NSE RELIANCE".
    // NCDEX must precede NCD — regex alternation is ordered, so "NCD" would
    // otherwise match first and leave a stray "EX" on "NCDEX: GUARSEED10".
    .replace(/^(?:NSE|BSE|NFO|BFO|MCX|CDS|NCDEX|NCD|BCD)(?::\s*|\s+)/, " ")
    .replace(/(\d+)(?:ST|ND|RD|TH)\b/g, "$1") // "25TH JUN" → "25 JUN"
    .replace(/[^\w&.\- :]/g, " ") // drop decorations, keep symbol punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  // A compact tradingsymbol with no spaces (RELIANCE, BANKNIFTY24JUN52000CE) is
  // handled verbatim by parseContractName — only strip standalone exchange
  // tokens from spaced names so "RELIANCE NSE" → "RELIANCE" but spaced contract
  // names keep their date/strike/CE tokens.
  if (!cleaned.includes(" ")) return cleaned;
  return cleaned
    .split(" ")
    .filter((t) => !EXCHANGE_TOKENS.has(t))
    .join(" ")
    .trim();
}

/**
 * Exchange text → a known exchange token, or null. Groww renders the segment a
 * few ways ("NSE", "NSE_EQ", "NSE • Equity", "BSE F&O"), so scan for the first
 * recognized exchange code rather than assuming the whole string is one.
 */
export function normalizeGrowwExchange(raw: string): string | null {
  for (const token of raw.toUpperCase().split(/[^A-Z]+/)) {
    if (EXCHANGE_TOKENS.has(token)) return token;
  }
  return null;
}

/**
 * Buy/sell from the order pad. Groww has no single stable class, so layer:
 * a buy/sell class fragment on the pad → the active side tab's text → the order
 * button copy ("BUY" / "SELL" / "Buy RELIANCE" / "Place buy order").
 * Ambiguous or missing → null (never guess a trade direction).
 */
export function resolveGrowwSide(
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
export interface RawGrowwPanelFields {
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
export function assembleGrowwCapture(fields: RawGrowwPanelFields): CapturedOrder | null {
  const symbol = normalizeGrowwInstrumentText(fields.symbolText);
  if (!symbol) return null;
  const side = resolveGrowwSide(fields.panelClasses, fields.activeTabText, fields.submitText);
  if (!side) return null;
  const limit = fields.priceDisabled ? null : parsePriceText(fields.priceText);
  return {
    broker: "groww",
    adapterVersion: GROWW_ADAPTER_VERSION,
    symbol,
    exchange: normalizeGrowwExchange(fields.exchangeText),
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

/** name/id/testid attr first, then label-text anchoring (Groww classes are hashed). */
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

/** Text of the currently-selected Buy/Sell tab/segment, if the pad has one. */
function activeTabText(panel: HTMLElement): string {
  const active = panel.querySelector<HTMLElement>(
    "[aria-selected='true'], [aria-pressed='true'], [class*='active'], [class*='selected'], [class*='Active'], [class*='Selected']"
  );
  const t = active?.textContent?.trim() ?? "";
  return /\b(buy|sell)\b/i.test(t) ? t : "";
}

function collectRawFields(panel: HTMLElement): RawGrowwPanelFields {
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
      // Groww idioms (hashed/utility classes, public research): the order pad
      // header carries the contract / tradingsymbol.
      "[class*='contractName']",
      "[class*='ContractName']",
      "[class*='contract-name']",
      "[class*='symbolName']",
      "[class*='SymbolName']",
      "[class*='_symbol']",
      "[class*='instrumentName']",
      "[class*='tradingsymbol']",
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

export const growwAdapter: BrokerCaptureAdapter = {
  id: "groww",
  label: "Groww",
  version: GROWW_ADAPTER_VERSION,
  originPattern: "https://groww.in/*",
  contentScript: "content-groww.js",

  findOrderPanel(root: ParentNode): HTMLElement | null {
    const candidates = root.querySelectorAll<HTMLElement>(
      [
        "[class*='orderPad']",
        "[class*='OrderPad']",
        "[class*='order-pad']",
        "[class*='orderForm']",
        "[class*='OrderForm']",
        "[class*='order-form']",
        "[class*='orderWindow']",
        "[class*='order-window']",
        "[class*='buySell']",
        "[class*='BuySell']",
        "[class*='placeOrder']",
        "[class*='PlaceOrder']",
        "[role='dialog']",
        "form",
      ].join(", ")
    );
    for (const el of candidates) {
      // A real order pad holds a quantity field — anything else (toasts,
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
      return assembleGrowwCapture(collectRawFields(panel));
    } catch {
      return null; // degrade silently — never break the broker page
    }
  },
};
