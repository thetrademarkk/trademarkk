import type { BrokerCaptureAdapter, BrokerId } from "./types";
import { kiteAdapter } from "./kite";

/**
 * Registry of broker capture adapters. Adding a broker (Upstox, Groww, …) is:
 *  1. `extension/src/brokers/<broker>.ts` — adapter implementing
 *     `BrokerCaptureAdapter` (pure parsing split from DOM collection, see kite.ts).
 *  2. `extension/src/content/<broker>-capture.ts` — content entry reusing
 *     `runCapture` from `../content/run-capture`.
 *  3. A build pass for the new content bundle (extension/vite.content.config.ts).
 *  4. Register it here — the settings toggle, permission flow and panel
 *     prefill pick it up automatically.
 */
export const captureAdapters: readonly BrokerCaptureAdapter[] = [kiteAdapter];

export function brokerLabel(id: BrokerId): string {
  return captureAdapters.find((a) => a.id === id)?.label ?? id;
}
