/**
 * Keyboard-command identifiers for the extension.
 *
 * The literal value is mirrored in two places that can't import this module:
 *  - `extension/public/manifest.json` — the `commands` key Chrome reads at
 *    install time (JSON, no imports).
 *  - `extension/src/sw.ts` — the dependency-free service worker bundle (it
 *    re-declares the constant rather than importing, exactly like the capture
 *    and badge literals).
 * This module is the single typed source of truth, and `commands.test.ts`
 * asserts the manifest entry stays in sync so the three never drift.
 */

/**
 * Opens the TradeMarkk side panel on the active tab (or, on Chromium forks
 * without `chrome.sidePanel`, focuses the action popup). Suggested key:
 * Ctrl+Shift+J (MacCtrl+Shift+J on macOS — Cmd+Shift+J is taken by DevTools).
 */
export const OPEN_PANEL_COMMAND = "open-trademarkk-panel";
