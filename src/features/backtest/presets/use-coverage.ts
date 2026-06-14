"use client";

import * as React from "react";
import { CoverageManifest } from "../../../lib/backtest/manifest/coverage-loader";
import type { IndexSymbol } from "../shared/instruments";
import { resolveCoverage, type PresetCoverage } from "./coverage-resolver";

/**
 * Client-side coverage lookup for a RUN RESULT (BT-10). The mandatory
 * CoverageBadge on a preset/builder run result needs honest coverage for the
 * exact (symbol, expiry) the engine ran — but the 170 KB manifest summary must
 * NOT be bundled into the client chunk. So this hook LAZILY fetches the
 * already-served committed JSON (`/backtest/manifest/coverage-summary.json`)
 * once, caches the parsed manifest module-globally, and resolves coverage.
 *
 * Until it loads (or if the fetch fails) coverage is `null` => the badge shows
 * the honest "Unknown" bucket rather than a fabricated number. Zero new deps,
 * reuses the BT-ETL CoverageManifest loader + the preset resolver.
 */

const MANIFEST_URL = "/backtest/manifest/coverage-summary.json";

let cached: CoverageManifest | null | undefined;
let inflight: Promise<CoverageManifest | null> | null = null;

async function loadManifest(): Promise<CoverageManifest | null> {
  if (cached !== undefined) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(MANIFEST_URL, { cache: "force-cache" });
      if (!res.ok) {
        cached = null;
        return null;
      }
      const raw = await res.json();
      cached = CoverageManifest.from(raw);
      return cached;
    } catch {
      cached = null;
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Resolve coverage for a (symbol, expiries) query on the client. Returns the
 * honest "unknown" coverage until the manifest loads.
 */
export function useCoverage(
  symbol: IndexSymbol | null,
  expiries: readonly string[]
): PresetCoverage {
  const [manifest, setManifest] = React.useState<CoverageManifest | null>(() => cached ?? null);

  React.useEffect(() => {
    let mounted = true;
    void loadManifest().then((m) => {
      if (mounted) setManifest(m);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return React.useMemo(
    () => resolveCoverage(manifest, symbol ?? ("NIFTY" as IndexSymbol), expiries),
    [manifest, symbol, expiries]
  );
}
