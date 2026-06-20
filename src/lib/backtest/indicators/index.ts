/**
 * Indicator library — public entry point and registry aggregation.
 *
 * This file pre-declares the imports for EVERY category file. Category agents
 * ONLY edit their own category file (./trend, ./momentum, …) by appending to
 * its exported `*Indicators` array — they NEVER edit this file. As soon as a
 * category file's array gains an entry, it is registered here automatically.
 *
 * See docs/backtesting/12-indicator-library.md for the design.
 */

import { listIndicators, registerAll } from "./registry";
import { trendIndicators } from "./trend";
import { momentumIndicators } from "./momentum";
import { volatilityIndicators } from "./volatility";
import { volumeIndicators } from "./volume";
import { directionalIndicators } from "./directional";
import { statisticalIndicators } from "./statistical";
import { maExtIndicators } from "./ma_ext";
import { oscillatorsExtIndicators } from "./oscillators_ext";
import { bandsVolExtIndicators } from "./bands_vol_ext";
import { volumeExtIndicators } from "./volume_ext";
import { ext2Indicators } from "./indicators_ext2";

// Public surface.
export * from "./types";
export * from "./registry";
export * from "./smoothing";

/**
 * Register every category's indicators into the shared registry. Idempotent:
 * safe to call from app bootstrap and from tests (no-op once the registry is
 * populated, so __resetRegistry() in tests cleanly re-arms it). Returns the
 * number of indicators registered on this call (0 if already populated).
 */
export function registerIndicators(): number {
  if (listIndicators().length > 0) return 0;
  registerAll([
    ...trendIndicators,
    ...momentumIndicators,
    ...volatilityIndicators,
    ...volumeIndicators,
    ...directionalIndicators,
    ...statisticalIndicators,
    ...maExtIndicators,
    ...oscillatorsExtIndicators,
    ...bandsVolExtIndicators,
    ...volumeExtIndicators,
    ...ext2Indicators,
  ]);
  return (
    trendIndicators.length +
    momentumIndicators.length +
    volatilityIndicators.length +
    volumeIndicators.length +
    directionalIndicators.length +
    statisticalIndicators.length +
    maExtIndicators.length +
    oscillatorsExtIndicators.length +
    bandsVolExtIndicators.length +
    volumeExtIndicators.length +
    ext2Indicators.length
  );
}
