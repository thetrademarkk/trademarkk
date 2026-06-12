import type { BrokerCaptureAdapter, CapturedOrder } from "./types";

/**
 * Zerodha Kite (kite.zerodha.com) order-window adapter — selector generation
 * v1 (June 2026).
 *
 * Kite's order window is a draggable dialog: `.order-window` carrying a
 * `buy`/`sell` class for the transaction type, a header with the instrument
 * name + exchange, and `input[name=quantity]` / `input[name=price]` fields
 * (`tradingsymbol` / `exchange-tag` spans are long-standing Kite idioms, cf.
 * community userscripts). Every selector here is layered with fallbacks
 * (name attrs → label text → text anchors) and the whole reader returns null
 * the moment it can no longer make sense of the DOM — the capture affordance
 * simply disappears instead of shipping wrong numbers into a journal.
 *
 * Bump KITE_ADAPTER_VERSION whenever these selectors change.
 */
export const KITE_ADAPTER_VERSION = 1;

/* ── Pure text parsing (unit-tested in kite.test.ts) ─────────────────────── */

const EXCHANGE_TOKENS = new Set(["NSE", "BSE", "NFO", "BFO", "MCX", "CDS", "NCD", "BCD"]);

/**
 * Order-window instrument text → something the app's contract-name parser
 * (`parseContractName`) understands: uppercase, ordinal day suffixes dropped
 * ("25th JUN" → "25 JUN"), decorations stripped, standalone exchange tokens
 * removed ("INFY NSE" → "INFY"). Compact tradingsymbols pass through as-is.
 */
export function normalizeKiteInstrumentText(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/(\d+)(?:ST|ND|RD|TH)\b/g, "$1")
    .replace(/[^\w&.\- :]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .filter((t) => !EXCHANGE_TOKENS.has(t))
    .join(" ")
    .trim();
}

/** "1,250" → 1250; rejects empty, zero, negative and fractional quantities. */
export function parseQtyText(raw: string): number | null {
  const v = raw.replace(/[,\s]/g, "");
  if (!v || !/^\d+(?:\.0*)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** First positive number in the text: "₹1,520.40" → 1520.4; 0/garbage → null. */
export function parsePriceText(raw: string): number | null {
  const m = raw.replace(/[,₹]/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Buy/sell from the order window: Kite tags the dialog itself with a
 * `buy`/`sell` class; the submit button text is the fallback anchor.
 * Unknown → null (never guess a trade direction).
 */
export function resolveSide(
  panelClasses: readonly string[],
  submitText: string
): "buy" | "sell" | null {
  const hasBuy = panelClasses.includes("buy");
  const hasSell = panelClasses.includes("sell");
  if (hasBuy !== hasSell) return hasBuy ? "buy" : "sell";
  if (/\bbuy\b/i.test(submitText)) return "buy";
  if (/\bsell\b/i.test(submitText)) return "sell";
  return null;
}

/** Everything the DOM collector hands to the pure assembler. */
export interface RawOrderPanelFields {
  symbolText: string;
  exchangeText: string;
  qtyText: string;
  priceText: string;
  /** Market orders disable the price input — fall back to the last price. */
  priceDisabled: boolean;
  lastPriceText: string;
  panelClasses: readonly string[];
  submitText: string;
}

/** Raw panel fields → capture, or null when the panel can't be trusted. */
export function assembleCapture(fields: RawOrderPanelFields): CapturedOrder | null {
  const symbol = normalizeKiteInstrumentText(fields.symbolText);
  if (!symbol) return null;
  const side = resolveSide(fields.panelClasses, fields.submitText);
  if (!side) return null;
  const limit = fields.priceDisabled ? null : parsePriceText(fields.priceText);
  const exchange = fields.exchangeText.trim().toUpperCase();
  return {
    broker: "kite",
    adapterVersion: KITE_ADAPTER_VERSION,
    symbol,
    exchange: EXCHANGE_TOKENS.has(exchange) ? exchange : null,
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

/** Label-anchored input lookup for when Kite drops its `name` attributes. */
function inputByLabel(
  panel: HTMLElement,
  match: RegExp,
  exclude?: RegExp
): HTMLInputElement | null {
  for (const input of panel.querySelectorAll<HTMLInputElement>(
    "input[type='number'], input[inputmode='decimal'], input[inputmode='numeric']"
  )) {
    const scope = input.closest("label") ?? input.parentElement;
    const label = scope?.textContent?.trim() ?? "";
    if (match.test(label) && !(exclude && exclude.test(label))) return input;
  }
  return null;
}

function findInput(panel: HTMLElement, name: string, match: RegExp, exclude?: RegExp) {
  return (
    panel.querySelector<HTMLInputElement>(`input[name='${name}']`) ??
    inputByLabel(panel, match, exclude)
  );
}

function collectRawFields(panel: HTMLElement): RawOrderPanelFields {
  const qtyInput = findInput(panel, "quantity", /qty|quantity/i, /disclosed/i);
  const priceInput = findInput(panel, "price", /price/i, /trigger|stop|target|last/i);
  const checkedExchange = panel.querySelector<HTMLInputElement>("input[name='exchange']:checked");
  return {
    symbolText: firstText(panel, [
      ".instrument-name .name",
      "span.tradingsymbol",
      ".instrument-name",
      "h3 .name",
      "h2, h3",
    ]),
    exchangeText: checkedExchange
      ? (checkedExchange.closest("label")?.textContent?.trim() ?? checkedExchange.value)
      : firstText(panel, [".instrument-name .exchange", "span.exchange-tag", "span.exchange"]),
    qtyText: qtyInput?.value ?? "",
    priceText: priceInput?.value ?? "",
    priceDisabled: priceInput?.disabled ?? true,
    lastPriceText: firstText(panel, [".last-price", "[class*='last-price']"]),
    panelClasses: Array.from(panel.classList),
    submitText: firstText(panel, ["button[type='submit']", "button.submit"]),
  };
}

export const kiteAdapter: BrokerCaptureAdapter = {
  id: "kite",
  label: "Zerodha Kite",
  version: KITE_ADAPTER_VERSION,
  originPattern: "https://kite.zerodha.com/*",
  contentScript: "content-kite.js",

  findOrderPanel(root: ParentNode): HTMLElement | null {
    for (const el of root.querySelectorAll<HTMLElement>(".order-window, [class*='order-window']")) {
      // A real order window holds a quantity field — anything else (toasts,
      // tooltips that happen to share the class fragment) is ignored.
      if (!visible(el)) continue;
      if (findInput(el, "quantity", /qty|quantity/i, /disclosed/i)) return el;
    }
    return null;
  },

  readOrder(panel: HTMLElement): CapturedOrder | null {
    try {
      return assembleCapture(collectRawFields(panel));
    } catch {
      return null; // degrade silently — never break the broker page
    }
  },
};
