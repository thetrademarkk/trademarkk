import { kitePositionsAdapter } from "../brokers/kite-positions";

/**
 * Content entry for kite.zerodha.com positions/tradebook import — bundled
 * standalone as content-kite-positions.js (extension/vite.content.config.ts)
 * and registered dynamically when the user enables Kite import in Settings.
 *
 * Panel-driven (the inverse of the order-window capture): it does nothing on
 * its own. When the panel sends a scrape request, it reads ONLY the executed
 * tradebook fields the journal needs and replies with the fills. Zero console
 * output, zero thrown errors — broker DOM drift yields an empty list, never a
 * broken page.
 *
 * Literals mirror extension/src/lib/positions-capture.ts (content bundles are
 * standalone IIFEs and can't import the panel's chrome typings cleanly).
 */
const SCRAPE_REQUEST_TYPE = "tm:scrape-tradebook";
const SCRAPE_RESPONSE_TYPE = "tm:tradebook-fills";

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as { type?: unknown; broker?: unknown; dayHintIso?: unknown } | null;
    if (msg?.type !== SCRAPE_REQUEST_TYPE || msg.broker !== kitePositionsAdapter.id) return;
    try {
      const dayHintIso = typeof msg.dayHintIso === "string" ? msg.dayHintIso : "";
      const fills = kitePositionsAdapter.readFills(document, dayHintIso);
      sendResponse({
        type: SCRAPE_RESPONSE_TYPE,
        broker: kitePositionsAdapter.id,
        adapterVersion: kitePositionsAdapter.version,
        fills,
      });
    } catch {
      // Degrade silently — never break the broker page.
      sendResponse({
        type: SCRAPE_RESPONSE_TYPE,
        broker: kitePositionsAdapter.id,
        adapterVersion: kitePositionsAdapter.version,
        fills: [],
      });
    }
    return true; // response sent synchronously above
  });
}
