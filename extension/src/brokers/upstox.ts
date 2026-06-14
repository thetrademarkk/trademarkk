import type { BrokerCaptureAdapter, CapturedOrder } from "./types";
import { EXCHANGE_TOKENS, parsePriceText, parseQtyText } from "./kite";

/**
 * Upstox Pro (pro.upstox.com / upstox.com) order-window adapter — selector
 * generation v1 (June 2026).
 *
 * Upstox Pro is a React app whose order placement is a FLOATING, draggable
 * window (the "Floating Order Window"); its component classes are CSS-Modules
 * hashed (`_qty_a1b2c`), so the hash changes on every deploy and a literal
 * class selector is worthless across builds. Everything here therefore anchors
 * on what survives a rebuild:
 *   - visible field LABELS ("Qty"/"Quantity", "Price") walked to the adjacent
 *     <input> — by far the most durable hook on a hashed-class app;
 *   - the buy/sell SIDE read from the dialog/active-tab text and the confirm
 *     button copy ("Buy" / "Sell" / "Confirm to buy" / "Confirm to sell");
 *   - UNHASHED class fragments via attribute-substring matchers
 *     (`[class*="order-window"]`, `[class*="_symbol_"]`) only as a last resort.
 *
 * Real Upstox Pro sits behind a login, so these selectors are best-effort by
 * design (public DOM research only — see docs/EXTENSION_ROADMAP.md). The reader
 * returns null the moment it can no longer make sense of the DOM, so the
 * capture affordance simply disappears rather than ship a guessed number into
 * a journal — exactly like the Kite adapter.
 *
 * Bump UPSTOX_ADAPTER_VERSION whenever these selectors change — it travels with
 * every capture as `adapterVersion`.
 */
export const UPSTOX_ADAPTER_VERSION = 1;

/* ── Pure text parsing (unit-tested in upstox.test.ts) ───────────────────── */

/**
 * Upstox order-window instrument text → something the app's contract-name
 * parser (`parseContractName`) understands. Upstox renders names a few ways —
 * a compact tradingsymbol ("RELIANCE"), an exchange-prefixed name
 * ("NSE:RELIANCE", "NSE_EQ|RELIANCE", "NSE RELIANCE") or a spaced derivative
 * name ("NIFTY 25 JUN 24500 CE") — so we: uppercase, drop a leading
 * "<EXCHANGE>:" / "<EXCHANGE>_<SEGMENT>|" / "<EXCHANGE> " prefix, strip ordinal
 * day suffixes ("13th JUN" → "13 JUN"), strip decorations, and remove any
 * standalone exchange tokens left over. Compact tradingsymbols pass through.
 */
export function normalizeUpstoxInstrumentText(raw: string): string {
  let s = raw.toUpperCase().trim();
  // Upstox instrument keys: "NSE_EQ|RELIANCE", "NSE_FO|NIFTY...", "BSE_EQ|..."
  // Take the part after the pipe — it carries the human/tradingsymbol.
  if (s.includes("|")) {
    const after = s.split("|").pop() ?? "";
    if (after.trim()) s = after.trim();
  }
  const cleaned = s
    // Leading "<EXCHANGE>:" / "<EXCHANGE> " (Fyers-style) — parseContractName
    // also strips the colon form, but doing it here keeps the standalone-token
    // filter below from misfiring on a spaced "NSE RELIANCE".
    // NCDEX must precede NCD — regex alternation is ordered, so "NCD" would
    // otherwise match first and leave a stray "EX" on "NCDEX: GUARSEED10".
    .replace(/^(?:NSE|BSE|NFO|BFO|MCX|CDS|NCDEX|NCD|BCD)(?::\s*|\s+)/, " ")
    .replace(/(\d+)(?:ST|ND|RD|TH)\b/g, "$1") // "13TH JUN" → "13 JUN"
    .replace(/[^\w&.\- :]/g, " ") // drop decorations, keep symbol punctuation
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  // A compact tradingsymbol with no spaces (NSE:SBIN-EQ, RELIANCE) is handled
  // verbatim by parseContractName — only strip standalone exchange tokens from
  // spaced names so "INFY NSE" → "INFY" but "NSE:SBIN-EQ" survives intact.
  if (!cleaned.includes(" ")) return cleaned;
  return cleaned
    .split(" ")
    .filter((t) => !EXCHANGE_TOKENS.has(t))
    .join(" ")
    .trim();
}

/**
 * Exchange text → a known exchange token, or null. Upstox renders the segment a
 * few ways ("NSE", "NSE_EQ", "NSE • Equity", "BSE | F&O"), so we scan for the
 * first recognized exchange code rather than assuming the whole string is one.
 */
export function normalizeUpstoxExchange(raw: string): string | null {
  for (const token of raw.toUpperCase().split(/[^A-Z]+/)) {
    if (EXCHANGE_TOKENS.has(token)) return token;
  }
  return null;
}

/**
 * Buy/sell from the order window. Upstox has no single stable class, so layer:
 * a buy/sell class fragment on the dialog → the active side tab's text →
 * the confirm button copy ("Buy" / "Sell" / "Confirm to buy/sell").
 * Ambiguous or missing → null (never guess a trade direction).
 */
export function resolveUpstoxSide(
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
export interface RawUpstoxPanelFields {
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
export function assembleUpstoxCapture(fields: RawUpstoxPanelFields): CapturedOrder | null {
  const symbol = normalizeUpstoxInstrumentText(fields.symbolText);
  if (!symbol) return null;
  const side = resolveUpstoxSide(fields.panelClasses, fields.activeTabText, fields.submitText);
  if (!side) return null;
  const limit = fields.priceDisabled ? null : parsePriceText(fields.priceText);
  return {
    broker: "upstox",
    adapterVersion: UPSTOX_ADAPTER_VERSION,
    symbol,
    exchange: normalizeUpstoxExchange(fields.exchangeText),
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
 * container, or aria-label/placeholder) and matches it against `match`.
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

/** name/id attr first, then label-text anchoring (Upstox classes are hashed). */
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
    "[aria-selected='true'], [aria-pressed='true'], [class*='active'], [class*='selected'], .tab-active"
  );
  const t = active?.textContent?.trim() ?? "";
  return /\b(buy|sell)\b/i.test(t) ? t : "";
}

function collectRawFields(panel: HTMLElement): RawUpstoxPanelFields {
  const qtyInput = findInput(
    panel,
    ["quantity", "qty", "order-quantity"],
    /\bqty\b|quantity/i,
    /disclosed|trigger|stop|target/i
  );
  const priceInput = findInput(
    panel,
    ["price", "order-price", "limit-price"],
    /\bprice\b/i,
    /trigger|stop|target|last|ltp|average|avg/i
  );
  return {
    symbolText: firstText(panel, [
      // Upstox idioms (CSS-Modules hashed, public research): watchlist
      // `_symbol_<hash>`, positions `_symbolName_<hash>`.
      "[class*='_symbol_']",
      "[class*='symbolName']",
      "[class*='_name_']",
      "[class*='symbol-name']",
      "[class*='instrument-name']",
      "[class*='tradingsymbol']",
      "[data-testid*='symbol']",
      "h1, h2, h3",
    ]),
    exchangeText: firstText(panel, [
      "[class*='_category_']",
      "[class*='exchange']",
      "[class*='segment']",
      "[data-testid*='exchange']",
    ]),
    qtyText: qtyInput?.value ?? "",
    priceText: priceInput?.value ?? "",
    // A missing price input is treated like a disabled one (market order).
    priceDisabled: priceInput ? priceInput.disabled : true,
    lastPriceText: firstText(panel, [
      "[class*='ltp']",
      "[class*='last-price']",
      "[class*='lastPrice']",
      "[class*='_ltp_']",
      "[data-testid*='ltp']",
    ]),
    panelClasses: Array.from(panel.classList),
    activeTabText: activeTabText(panel),
    submitText: firstText(panel, [
      "button[type='submit']",
      "[class*='confirm']",
      "[class*='place-order']",
      "[class*='submit']",
      "button",
    ]),
  };
}

export const upstoxAdapter: BrokerCaptureAdapter = {
  id: "upstox",
  label: "Upstox",
  version: UPSTOX_ADAPTER_VERSION,
  // Both the legacy and Pro web hosts; the user grants this optional host once.
  originPattern: "https://*.upstox.com/*",
  contentScript: "content-upstox.js",

  findOrderPanel(root: ParentNode): HTMLElement | null {
    const candidates = root.querySelectorAll<HTMLElement>(
      [
        "[class*='order-window']",
        "[class*='orderWindow']",
        "[class*='order-ticket']",
        "[class*='orderTicket']",
        "[class*='order-form']",
        "[class*='orderForm']",
        "[class*='place-order']",
        "[class*='placeOrder']",
        "[role='dialog']",
      ].join(", ")
    );
    for (const el of candidates) {
      // A real order window holds a quantity field — anything else (toasts,
      // unrelated dialogs that share a class fragment) is ignored.
      if (!visible(el)) continue;
      if (findInput(el, ["quantity", "qty"], /\bqty\b|quantity/i, /disclosed|trigger/i)) {
        return el;
      }
    }
    return null;
  },

  readOrder(panel: HTMLElement): CapturedOrder | null {
    try {
      return assembleUpstoxCapture(collectRawFields(panel));
    } catch {
      return null; // degrade silently — never break the broker page
    }
  },
};
