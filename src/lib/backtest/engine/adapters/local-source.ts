/**
 * LOCAL archive data source — reads a JSON snapshot pre-extracted from the local
 * market_archive_1m parquet by scripts/gen-backtest-fixtures.mjs (python+pyarrow),
 * and exposes it through the same 6-fn DataSource interface as the fixtures.
 *
 * Why a pre-extracted JSON slice and not a live parquet read: there is no node
 * duckdb/parquet dependency in this project (the HF/duckdb-wasm path is BT-08).
 * The python gen script range-reads the real parquet (narrow WHERE per
 * day×strike) and writes the canonical FixtureSnapshot shape, so the engine runs
 * against REAL archive data with ZERO new runtime deps. BT-08 swaps this for a
 * duckdb-wasm source behind the identical interface.
 *
 * This module is Node-only (uses fs); never import it into client/worker code.
 */

import { readFileSync } from "node:fs";
import { FixtureDataSource, type FixtureSnapshot } from "./fixture-source";

/** Construct a DataSource from a snapshot JSON file produced by the gen script. */
export function loadLocalSnapshot(jsonPath: string): FixtureDataSource {
  const raw = readFileSync(jsonPath, "utf8");
  const snap = JSON.parse(raw) as FixtureSnapshot;
  return new FixtureDataSource(snap);
}

/** Construct a DataSource from an already-parsed snapshot object. */
export function localSourceFromSnapshot(snap: FixtureSnapshot): FixtureDataSource {
  return new FixtureDataSource(snap);
}
