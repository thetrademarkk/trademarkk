/**
 * Local data availability (BT-10 → BT-08 seam, data side). Reports which
 * (symbol, trading-day) pairs the CURRENTLY-AVAILABLE data source can serve, so
 * `decidePresetRun` can pick "run" vs honest "locked".
 *
 * TODAY this reads the single committed golden NIFTY 2024-07-24..25 slice. When
 * BT-08 lands, this ONE function is replaced (or augmented) to report the HF
 * dataset's available days — and every preset that overlaps the live data flips
 * from "locked" to "run" automatically, with no change to the catalogue or the
 * Explore UI. That is the documented zero-preset-code-change seam.
 */

import { loadGoldenSnapshot } from "../../../lib/backtest/__fixtures__/golden-loader";
import { availabilityFrom, type LocalDataAvailability } from "./run-decision";

/**
 * Availability backed by the committed local fixtures (golden slice). Pure;
 * recomputed cheaply (the golden loader is in-memory).
 */
export function localDataAvailability(): LocalDataAvailability {
  const snap = loadGoldenSnapshot();
  const days = snap.days.map((d) => d.day);
  return availabilityFrom([{ symbol: snap.symbol, days }]);
}
