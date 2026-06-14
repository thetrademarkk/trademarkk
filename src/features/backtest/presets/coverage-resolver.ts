/**
 * Preset coverage resolver (BT-10). Bridges the committed coverage manifest
 * (`public/backtest/manifest/coverage-summary.json`, loaded via the BT-ETL
 * {@link CoverageManifest}) to a single honest coverage fraction per preset,
 * which the mandatory CoverageBadge renders.
 *
 * It is PURE over an injected {@link CoverageManifest} (so it is unit-tested
 * with a synthetic manifest, incl. the absent → unknown path). The Explore
 * server component imports the JSON once, builds the manifest, and precomputes a
 * coverage number per preset card — so the 170 KB summary NEVER ships to the
 * client; only the small per-preset fraction crosses the wire.
 *
 * Coverage = the MEAN per-expiry `meanBarCoverage` over the preset's real
 * `coverageExpiries` that the manifest actually has. If the manifest has NONE of
 * them (e.g. a future dataset extension, or a symbol with no captured expiries)
 * we fall back to the per-symbol rollup; if even that is absent we return
 * `null` => the badge shows the honest "Unknown" bucket. NO cherry-picking: every
 * declared expiry that the manifest knows about counts, low ones included.
 */

import type { CoverageManifest } from "../../../lib/backtest/manifest/coverage-loader";
import {
  bucketForCoverage,
  type CoverageBucketInfo,
} from "../../../lib/backtest/coverage/coverage-buckets";
import type { IndexSymbol } from "../shared/instruments";
import type { Preset, PresetMeta } from "./types";

export interface PresetCoverage {
  /** Mean coverage fraction 0..1, or null when the manifest knows nothing. */
  fraction: number | null;
  /** Bucketed view (high/medium/low/unknown) for the badge. */
  info: CoverageBucketInfo;
  /** How many of the preset's declared expiries the manifest actually had. */
  matchedExpiries: number;
  /** Total declared expiries (for an honest "N of M covered" sub-line). */
  totalExpiries: number;
  /** True when we fell back to the per-symbol rollup (no expiry matched). */
  usedSymbolFallback: boolean;
}

/**
 * Resolve coverage for an arbitrary (symbol, expiries) query against a manifest.
 * Exported so the CoverageBadge usage on a run RESULT (which knows the served
 * expiry) can reuse the exact same logic.
 */
export function resolveCoverage(
  manifest: CoverageManifest | null,
  symbol: IndexSymbol,
  expiries: readonly string[]
): PresetCoverage {
  const total = expiries.length;
  if (!manifest) {
    return {
      fraction: null,
      info: bucketForCoverage(null),
      matchedExpiries: 0,
      totalExpiries: total,
      usedSymbolFallback: false,
    };
  }

  const fractions: number[] = [];
  for (const expiry of expiries) {
    const cov = manifest.expiryCoverage(symbol, expiry);
    if (cov != null && Number.isFinite(cov)) fractions.push(cov);
  }

  if (fractions.length > 0) {
    const mean = fractions.reduce((a, b) => a + b, 0) / fractions.length;
    return {
      fraction: mean,
      info: bucketForCoverage(mean),
      matchedExpiries: fractions.length,
      totalExpiries: total,
      usedSymbolFallback: false,
    };
  }

  // No declared expiry matched — fall back to the honest per-symbol rollup.
  const sym = manifest.symbol(symbol);
  const symCov = sym?.meanBarCoverage ?? null;
  return {
    fraction: symCov,
    info: bucketForCoverage(symCov),
    matchedExpiries: 0,
    totalExpiries: total,
    usedSymbolFallback: symCov != null,
  };
}

/** Resolve coverage for a single preset. */
export function resolvePresetCoverage(
  manifest: CoverageManifest | null,
  preset: Preset | PresetMeta
): PresetCoverage {
  const meta: PresetMeta = "meta" in preset ? preset.meta : preset;
  return resolveCoverage(manifest, meta.index, meta.coverageExpiries);
}

/** A serialisable card payload: the metadata + its precomputed coverage. */
export interface PresetCard {
  meta: PresetMeta;
  coverage: PresetCoverage;
  /** True when this preset can run TODAY on committed local data (BT runnability). */
  runnableNow: boolean;
}
