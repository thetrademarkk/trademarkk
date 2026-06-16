/**
 * Manifest-driven expiry resolution — the DATA-DRIVEN counterpart to the
 * weekday-rule resolver in market-calendar.ts (`expiryFor`). The dataset's option
 * files ARE the ground truth for which expiries traded, and the NSE/BSE weekly
 * weekday churned repeatedly (NIFTY Thu→Tue mid-2025; SENSEX Fri→Tue→Thu;
 * BANKNIFTY weekly→monthly), so resolving the contract to trade from the actual
 * manifest is correct-by-construction and never points at a missing file.
 *
 * Resolution is by NEAREST listed expiry, mirroring how a trader holds the next
 * available contract:
 *   - WEEKLY      → the first listed expiry on or after `day`.
 *   - NEXT_WEEKLY → the second listed expiry on or after `day`.
 *   - MONTHLY     → the LAST listed expiry of the month that the nearest expiry
 *                   on/after `day` falls in (the monthly contract is the final
 *                   expiry of its calendar month).
 *
 * Returns `null` when the manifest has no expiry on/after `day` (a day beyond the
 * dataset, or a symbol with no option files yet) — the caller then falls back to
 * the weekday-rule `expiryFor`, so behaviour degrades gracefully rather than
 * pointing at a 404. Pure; the manifest is a frozen generated table.
 */

import type { IndexSymbol } from "../../../features/backtest/shared/instruments";
import type { ExpiryKind } from "./market-calendar";
import { EXPIRY_MANIFEST } from "./expiry-manifest.generated";

/** The ascending list of expiries that exist in the dataset for `index`. */
export function availableExpiries(index: IndexSymbol): readonly string[] {
  return EXPIRY_MANIFEST[index] ?? [];
}

/** True when the dataset has at least one option expiry for `index`. */
export function hasManifest(index: IndexSymbol): boolean {
  return availableExpiries(index).length > 0;
}

/** Index of the first expiry on or after `day`, or -1 if none. */
function firstOnOrAfter(list: readonly string[], day: string): number {
  // Linear is fine — lists are ≤ a few hundred and this runs once per plan.
  for (let i = 0; i < list.length; i++) {
    if (list[i]! >= day) return i;
  }
  return -1;
}

/**
 * Resolve the dataset expiry to trade for `day` and `kind` from the manifest, or
 * `null` when no listed expiry is on/after `day` (caller falls back to the
 * weekday-rule calendar).
 */
export function resolveExpiryFromManifest(
  index: IndexSymbol,
  day: string,
  kind: ExpiryKind
): string | null {
  const list = availableExpiries(index);
  if (list.length === 0) return null;
  const i = firstOnOrAfter(list, day);
  if (i === -1) return null;

  if (kind === "NEXT_WEEKLY") {
    return list[i + 1] ?? list[i]!; // clamp to nearest when there is no next
  }

  if (kind === "MONTHLY") {
    const month = list[i]!.slice(0, 7); // "YYYY-MM" of the nearest expiry
    let last = list[i]!;
    for (let j = i + 1; j < list.length && list[j]!.slice(0, 7) === month; j++) {
      last = list[j]!;
    }
    return last;
  }

  // WEEKLY (and any default) → the nearest expiry on/after `day`.
  return list[i]!;
}
