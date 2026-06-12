/**
 * Per-broker capture adapters — the ONLY code allowed to read a broker page.
 *
 * Contract (see docs/EXTENSION_ROADMAP.md, ADR v2):
 *  - An adapter reads nothing but the visible ORDER-ENTRY fields. Balances,
 *    holdings and positions are out of bounds by design.
 *  - Broker DOMs are brittle: every reader must degrade silently (return
 *    null) instead of guessing or throwing when the DOM stops matching.
 *  - `version` is bumped whenever selectors change and travels with every
 *    capture, so breakage reports can name the adapter generation.
 */

export type BrokerId = "kite" | "upstox" | "groww";

/** What a capture adapter is allowed to hand to the panel — nothing more. */
export interface CapturedOrder {
  broker: BrokerId;
  /** Selector-generation tag of the adapter that produced this capture. */
  adapterVersion: number;
  /** Instrument text, normalized for the app's contract-name parser. */
  symbol: string;
  exchange: string | null;
  side: "buy" | "sell";
  qty: number | null;
  /** Limit price, or the last traded price for market orders. */
  price: number | null;
}

export interface BrokerCaptureAdapter {
  id: BrokerId;
  /** Human label, e.g. "Zerodha Kite". */
  label: string;
  /** Bump on every selector change — captures carry it as `adapterVersion`. */
  version: number;
  /** Match pattern the content script needs (optional host permission). */
  originPattern: string;
  /** Built content-script bundle, relative to the extension dist root. */
  contentScript: string;
  /** The visible order-entry panel, or null when none is open. */
  findOrderPanel(root: ParentNode): HTMLElement | null;
  /** Panel → capture; null = DOM no longer understood (degrade silently). */
  readOrder(panel: HTMLElement): CapturedOrder | null;
}
