import type { BrokerId } from "../brokers/types";
import { kitePositionsAdapter } from "../brokers/kite-positions";
import type { ImportedFill } from "../brokers/kite-positions";

/**
 * Panel ⇄ content-script protocol for positions/tradebook import.
 *
 * Unlike the order-window capture (page-driven: a button click on the broker
 * page pushes a single order), positions import is PANEL-driven: the user
 * clicks "Import from Kite" in the panel, the panel finds the broker tab and
 * asks its content script to scrape the visible tradebook, and the content
 * script replies with the executed fills. The scrape is opt-in (the content
 * script is only registered after the user grants the host permission) and
 * reads only the order fields a trade row needs — never balances or holdings.
 *
 * The literals here are mirrored in content/kite-positions-capture.ts (a
 * standalone IIFE bundle) — keep them in sync.
 */
export const SCRAPE_REQUEST_TYPE = "tm:scrape-tradebook";
export const SCRAPE_RESPONSE_TYPE = "tm:tradebook-fills";

export interface ScrapeRequest {
  type: typeof SCRAPE_REQUEST_TYPE;
  broker: BrokerId;
  /** The user's current local day, ISO, to anchor bare-clock fill times. */
  dayHintIso: string;
}

export interface ScrapeResponse {
  type: typeof SCRAPE_RESPONSE_TYPE;
  broker: BrokerId;
  adapterVersion: number;
  fills: ImportedFill[];
}

/** Strict validation — fills cross a privilege boundary (content → panel). */
const BROKER_IDS: readonly BrokerId[] = ["kite", "upstox", "groww"];

export function isImportedFill(v: unknown): v is ImportedFill {
  if (typeof v !== "object" || v === null) return false;
  const f = v as Record<string, unknown>;
  return (
    BROKER_IDS.includes(f.broker as BrokerId) &&
    typeof f.adapterVersion === "number" &&
    typeof f.symbol === "string" &&
    f.symbol.trim().length > 0 &&
    (f.exchange === null || typeof f.exchange === "string") &&
    (f.side === "buy" || f.side === "sell") &&
    typeof f.qty === "number" &&
    Number.isFinite(f.qty) &&
    f.qty > 0 &&
    typeof f.price === "number" &&
    Number.isFinite(f.price) &&
    f.price > 0 &&
    (f.time === null || typeof f.time === "string")
  );
}

function isScrapeResponse(v: unknown): v is ScrapeResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.type === SCRAPE_RESPONSE_TYPE &&
    BROKER_IDS.includes(r.broker as BrokerId) &&
    typeof r.adapterVersion === "number" &&
    Array.isArray(r.fills)
  );
}

export class NoBrokerTabError extends Error {
  constructor(label: string) {
    super(
      `Open your ${label} orders/positions page in a tab (and reload it after enabling import), then try again.`
    );
    this.name = "NoBrokerTabError";
  }
}

const today = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * Finds the user's Kite tab and asks its content script to scrape the visible
 * tradebook. Returns the trustworthy executed fills (already shape-validated).
 *
 * Tab discovery is by message round-trip rather than by URL pattern: the
 * import content script is only present on tabs the user granted (and only
 * answers for its own broker id), so messaging every tab and keeping the first
 * valid response is both robust to Kite's exact path and host-permission-safe
 * (no `tabs` permission needed — sendMessage reaches only injected tabs).
 */
export async function scrapeKiteTradebook(): Promise<ImportedFill[]> {
  const adapter = kitePositionsAdapter;
  const tabs = await chrome.tabs.query({});
  if (tabs.length === 0) throw new NoBrokerTabError(adapter.label);

  // Prefer the active tab and tabs already on an orders/positions page.
  const ranked = [...tabs].sort((a, b) => score(b) - score(a));
  const request: ScrapeRequest = {
    type: SCRAPE_REQUEST_TYPE,
    broker: adapter.id,
    dayHintIso: today(),
  };

  let reached = false;
  for (const tab of ranked) {
    if (tab.id === undefined) continue;
    let res: unknown;
    try {
      res = await chrome.tabs.sendMessage(tab.id, request);
    } catch {
      continue; // no content script on this tab — try the next
    }
    if (!isScrapeResponse(res)) continue;
    reached = true;
    const fills = res.fills.filter(isImportedFill);
    if (fills.length) return fills;
  }
  // Reached a broker tab but it had nothing importable → empty (not an error).
  if (reached) return [];
  throw new NoBrokerTabError(adapter.label);
}

function score(tab: chrome.tabs.Tab): number {
  const url = tab.url ?? "";
  const onHint = kitePositionsAdapter.pageHints.some((h) => url.includes(h));
  return (onHint ? 2 : 0) + (tab.active ? 1 : 0);
}
