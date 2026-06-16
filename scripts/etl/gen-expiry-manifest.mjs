/**
 * Generate src/lib/backtest/calendar/expiry-manifest.generated.ts from the LIVE
 * HuggingFace dataset tree. The dataset's option files (options/{SYM}/{EXPIRY}.parquet)
 * ARE the ground truth for which expiries were actually traded — NSE/BSE shifted
 * the weekly-expiry weekday repeatedly across 2024-26 (NIFTY Thu→Tue, SENSEX
 * Fri→Tue→Thu, BANKNIFTY weekly→monthly), so a hard-coded weekday rule silently
 * resolves the WRONG (often missing) expiry file. Resolving expiries from this
 * manifest is correct-by-construction and immune to that churn.
 *
 * Re-run after the backfill adds expiries:
 *   node scripts/etl/gen-expiry-manifest.mjs
 *
 * No secrets — the dataset is public. Pure read; writes one generated TS file.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "thetrademarkk/india-index-options-1m";
const SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"];
const API = `https://huggingface.co/api/datasets/${REPO}/tree/main/options`;

async function fetchExpiries(sym) {
  const res = await fetch(`${API}/${sym}?recursive=false&expand=false`, {
    headers: { "User-Agent": "trademarkk-etl" },
  });
  if (!res.ok) throw new Error(`HF tree ${sym}: HTTP ${res.status}`);
  const tree = await res.json();
  return tree
    .filter((e) => typeof e.path === "string" && e.path.endsWith(".parquet"))
    .map((e) =>
      e.path
        .split("/")
        .pop()
        .replace(/\.parquet$/, "")
    )
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outPath = join(root, "src", "lib", "backtest", "calendar", "expiry-manifest.generated.ts");

const manifest = {};
for (const sym of SYMBOLS) {
  manifest[sym] = await fetchExpiries(sym);
  console.log(`[gen-expiry-manifest] ${sym}: ${manifest[sym].length} expiries`);
}

const body = SYMBOLS.map(
  (sym) => `  ${sym}: [\n${manifest[sym].map((d) => `    "${d}",`).join("\n")}\n  ],`
).join("\n");

const ts = `/**
 * GENERATED — do not edit by hand. Run \`node scripts/etl/gen-expiry-manifest.mjs\`.
 *
 * The set of option EXPIRY dates ("YYYY-MM-DD") that actually exist in the HF
 * dataset (options/{SYM}/{EXPIRY}.parquet), per index, ascending. This is the
 * ground-truth expiry calendar the backtest data layer resolves against — it
 * tracks the real NSE/BSE weekday churn that a static rule cannot.
 */

import type { IndexSymbol } from "../../../features/backtest/shared/instruments";

export const EXPIRY_MANIFEST: Record<IndexSymbol, readonly string[]> = {
${body}
} as const;
`;

writeFileSync(outPath, ts);
console.log(`[gen-expiry-manifest] wrote ${outPath}`);
