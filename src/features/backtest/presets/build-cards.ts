/**
 * Server-side card builder (BT-10). Loads the committed coverage manifest once,
 * computes the honest coverage + run-vs-locked state for each preset, and
 * returns serialisable {@link PresetCard}s. Called from the Explore route +
 * landing featured section (both server components) so the 170 KB summary stays
 * out of the client bundle — only the small per-card numbers cross the wire.
 *
 * Importing the JSON statically is safe in a server component: it is committed
 * static data tree-shaken into the server render, NOT the client chunk.
 */

import coverageSummaryRaw from "../../../../public/backtest/manifest/coverage-summary.json";
import { CoverageManifest } from "../../../lib/backtest/manifest/coverage-loader";
import { PRESETS } from "./catalogue";
import { resolvePresetCoverage, type PresetCard } from "./coverage-resolver";
import { localDataAvailability } from "./local-availability";
import { isPresetRunnable } from "./run-decision";

/** Build the committed manifest once (module-level singleton). */
let manifestSingleton: CoverageManifest | null | undefined;
function manifest(): CoverageManifest | null {
  if (manifestSingleton === undefined) {
    manifestSingleton = CoverageManifest.from(coverageSummaryRaw);
  }
  return manifestSingleton;
}

/** Build all preset cards (coverage + runnability) for the Explore grid. */
export function buildPresetCards(): PresetCard[] {
  const m = manifest();
  const avail = localDataAvailability();
  return PRESETS.map((preset) => ({
    meta: preset.meta,
    coverage: resolvePresetCoverage(m, preset),
    runnableNow: isPresetRunnable(preset, avail),
  }));
}

/**
 * The featured subset for the /backtesting landing — a small spread across
 * indices + strategy types (NOT cherry-picked by coverage). Deterministic order.
 */
export function featuredPresetCards(): PresetCard[] {
  const featuredIds = ["nifty-short-straddle", "nifty-iron-condor", "sensex-iron-condor"];
  const all = buildPresetCards();
  const byId = new Map(all.map((c) => [c.meta.id, c]));
  return featuredIds.map((id) => byId.get(id)).filter((c): c is PresetCard => !!c);
}
