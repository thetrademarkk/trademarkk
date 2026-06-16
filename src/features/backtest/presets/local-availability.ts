/**
 * Local data availability (BT-10 → BT-08 seam, data side). Reports which
 * (symbol, trading-day) pairs the CURRENTLY-AVAILABLE data source can serve, so
 * `decidePresetRun` can pick "run" vs honest "locked".
 *
 * THE SEAM IS NOW CONNECTED. Availability is derived from the LIVE HuggingFace
 * dataset's real option-expiry manifest (expiry-manifest.generated.ts) — the
 * builder already runs every strategy against that 1-minute dataset via the
 * duckdb-wasm worker (review-step builderHfPayload). For each index we report the
 * trading days spanned by its real expiries, so every preset whose window lies
 * inside the dataset flips from "locked" → "run" automatically, with ZERO change
 * to the catalogue or the Explore UI. Presets outside the dataset's span stay
 * honestly locked. The golden NIFTY slice is unioned in as a always-present
 * floor. Pure + synchronous (manifest + calendar are in-memory), recomputed
 * cheaply and memoised.
 */

import { loadGoldenSnapshot } from "../../../lib/backtest/__fixtures__/golden-loader";
import { EXPIRY_MANIFEST } from "../../../lib/backtest/calendar/expiry-manifest.generated";
import { tradingDays } from "../../../lib/backtest/calendar/market-calendar";
import type { IndexSymbol } from "../shared/instruments";
import { availabilityFrom, type LocalDataAvailability } from "./run-decision";

let _cached: LocalDataAvailability | null = null;

/**
 * Availability backed by the LIVE HF dataset's expiry manifest, unioned with the
 * committed golden slice. For each index, the served trading days are every
 * market day between its first and last real expiry — the engine then resolves
 * exact days/strikes at run time and reports true per-leg coverage honestly, so a
 * thin-data corner of the span surfaces as low coverage in the RESULT, never as a
 * fabricated "available" claim here.
 */
export function localDataAvailability(): LocalDataAvailability {
  if (_cached) return _cached;
  const entries: { symbol: IndexSymbol; days: readonly string[] }[] = [];

  for (const symbol of Object.keys(EXPIRY_MANIFEST) as IndexSymbol[]) {
    const expiries = EXPIRY_MANIFEST[symbol];
    if (!expiries || expiries.length === 0) continue;
    const first = expiries[0]!;
    const last = expiries[expiries.length - 1]!;
    entries.push({ symbol, days: tradingDays(first, last, symbol) });
  }

  // Always include the committed golden NIFTY slice as a floor (works offline /
  // if the manifest is ever empty).
  const snap = loadGoldenSnapshot();
  entries.push({ symbol: snap.symbol, days: snap.days.map((d) => d.day) });

  _cached = availabilityFrom(entries);
  return _cached;
}
