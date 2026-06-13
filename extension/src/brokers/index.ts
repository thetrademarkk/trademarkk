import type { BrokerCaptureAdapter, BrokerId } from "./types";
import { kiteAdapter } from "./kite";
import { upstoxAdapter } from "./upstox";
import { growwAdapter } from "./groww";
import { dhanAdapter } from "./dhan";
import { fyersAdapter } from "./fyers";

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
export const captureAdapters: readonly BrokerCaptureAdapter[] = [
  kiteAdapter,
  upstoxAdapter,
  growwAdapter,
  dhanAdapter,
  fyersAdapter,
];

// (Adding the next broker is one more entry above + its content entry + a
//  build pass in package.json's ext:build — the registry drives everything else.)

export function brokerLabel(id: BrokerId): string {
  return captureAdapters.find((a) => a.id === id)?.label ?? id;
}
