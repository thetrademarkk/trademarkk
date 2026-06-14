/**
 * The "held run" — an anonymous backtest result waiting to be claimed (BT-09).
 *
 * Flow: a signed-out user builds + runs a backtest entirely in the browser
 * (no gate). When they click Save / Share / Notify we DON'T re-run anything —
 * the result is an immutable artifact. We persist the *computed* RunResult
 * (+ the StrategyDef that produced it) to IndexedDB so it survives the
 * sign-in/sign-up navigation, then POST it ONCE after auth to claim ownership
 * and clear the local copy.
 *
 * Why IndexedDB and not localStorage: a full RunResult blob (blotter +
 * equity curve) can exceed localStorage's ~5MB string budget on a long run,
 * and IndexedDB stores structured data without a JSON re-stringify per write.
 * A thin promise-wrapper over a single object-store keeps the dependency
 * surface at zero (no idb-keyval). All ops are best-effort and degrade to a
 * resolved no-op when IndexedDB is unavailable (SSR, privacy mode) so the
 * feature never throws into the UI.
 */

import type { RunResult } from "../shared/run-result";
import type { StrategyDef } from "../shared/strategy-def";

const DB_NAME = "tmk.bt";
const STORE = "held-runs";
/** A single well-known key — only the most-recent anonymous run is ever held. */
export const HELD_RUN_KEY = "pending";

/** The shape held in IndexedDB between run and claim. */
export interface HeldRun {
  /** The exact strategy that produced the result (so a Save can persist both). */
  strategy: StrategyDef;
  /** The immutable computed artifact — NEVER re-run on claim. */
  result: RunResult;
  /** When the run was held (epoch ms) — lets a stale held run be ignored. */
  heldAt: number;
}

function hasIDB(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const store = db.transaction(STORE, mode).objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

/** Hold an anonymous run so it survives the sign-in round-trip. Best-effort. */
export async function holdRun(strategy: StrategyDef, result: RunResult): Promise<void> {
  if (!hasIDB()) return;
  const held: HeldRun = { strategy, result, heldAt: Date.now() };
  try {
    await tx("readwrite", (s) => s.put(held, HELD_RUN_KEY));
  } catch {
    /* best-effort — a held run that can't persist just means re-clicking Save */
  }
}

/** Read the held run (or null). Best-effort — never throws into the UI. */
export async function readHeldRun(): Promise<HeldRun | null> {
  if (!hasIDB()) return null;
  try {
    const held = await tx<HeldRun | undefined>("readonly", (s) => s.get(HELD_RUN_KEY));
    return held ?? null;
  } catch {
    return null;
  }
}

/** Clear the held run after a successful claim (or when no longer needed). */
export async function clearHeldRun(): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx("readwrite", (s) => s.delete(HELD_RUN_KEY));
  } catch {
    /* best-effort */
  }
}
