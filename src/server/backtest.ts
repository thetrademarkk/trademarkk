import "server-only";
import { and, eq } from "drizzle-orm";
import { newId } from "@/lib/id";
import { platformDb } from "./db/platform";
import { backtestRuns, backtestStrategies } from "./db/platform-schema";
import { serializeRunResult, deserializeRunResult } from "@/features/backtest/persist/serialize";
import { generateShareId } from "@/features/backtest/persist/share-id";
import type { RunResult } from "@/features/backtest/shared/run-result";
import type { StrategyDef } from "@/features/backtest/shared/strategy-def";

/**
 * BT-09 server module — persistence + immutable public share for backtests.
 *
 * Invariants enforced here (the spec's load-bearing guarantees):
 *  - CLAIM, NEVER RE-RUN: `saveRun` stores the client-computed RunResult blob
 *    verbatim via serializeRunResult. The engine is never invoked server-side;
 *    a saved run is an immutable artifact.
 *  - IMMUTABLE ARTIFACT: there is no update path for `run_result`. A shared run
 *    is read-only for everyone, owner included — only the share toggle and a
 *    full delete ever touch a run row.
 *  - IDEMPOTENT SHARE: `shareRun(enabled:true)` mints a shareId once; calling it
 *    again on an already-shared run returns the SAME id (no new link).
 *  - UNGUESSABLE + OPT-IN: shareId is a 108-bit nanoid, set only on demand, so a
 *    run is private until the owner explicitly shares it.
 *
 * Auth/guard chaining (origin → session → rateLimit → parse) lives in the route
 * handlers, mirroring src/app/api/feedback/route.ts.
 */

const ENGINE_VERSION_FALLBACK = "1.0.0";

/** Persist a strategy definition (create). Returns the new strategy id. */
export async function saveStrategy(userId: string, strategy: StrategyDef): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await platformDb.insert(backtestStrategies).values({
    id,
    userId,
    name: strategy.name,
    strategyDef: JSON.stringify(strategy),
    engineVersion: ENGINE_VERSION_FALLBACK,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/**
 * Save (claim) a client-computed run for `userId`. Optionally links it to an
 * existing strategy; otherwise creates a strategy row from the run's config so
 * "My strategies" always has the definition behind every saved run. The
 * RunResult is stored verbatim (serialized blob) — never re-derived.
 */
export async function saveRun(
  userId: string,
  strategy: StrategyDef,
  result: RunResult,
  strategyId?: string
): Promise<{ runId: string; strategyId: string }> {
  // Resolve / create the owning strategy.
  let stratId = strategyId;
  if (stratId) {
    const owned = await platformDb
      .select({ id: backtestStrategies.id })
      .from(backtestStrategies)
      .where(and(eq(backtestStrategies.id, stratId), eq(backtestStrategies.userId, userId)))
      .get();
    if (!owned) stratId = undefined; // not theirs → fall through to create
  }
  if (!stratId) stratId = await saveStrategy(userId, strategy);

  const runId = newId();
  await platformDb.insert(backtestRuns).values({
    id: runId,
    userId,
    strategyId: stratId,
    runResult: serializeRunResult(result),
    dataSnapshotId: result.dataSnapshotId,
    engineVersion: result.engineVersion,
    shareId: null,
    createdAt: new Date().toISOString(),
  });
  return { runId, strategyId: stratId };
}

export interface RunRow {
  id: string;
  userId: string | null;
  strategyId: string | null;
  shareId: string | null;
  createdAt: string;
  result: RunResult;
}

function rowToRun(row: typeof backtestRuns.$inferSelect): RunRow {
  return {
    id: row.id,
    userId: row.userId,
    strategyId: row.strategyId,
    shareId: row.shareId,
    createdAt: row.createdAt,
    result: deserializeRunResult(row.runResult),
  };
}

/** Fetch a run by its primary id (owner-scoped reads). Null if absent. */
export async function getRunById(id: string): Promise<RunRow | null> {
  const row = await platformDb.select().from(backtestRuns).where(eq(backtestRuns.id, id)).get();
  return row ? rowToRun(row) : null;
}

/**
 * Fetch a PUBLIC run by its share-id. No auth required — this backs the
 * immutable `/backtesting/r/[shareId]` permalink. Only rows whose shareId is set
 * are reachable, so an owner-only run can never be read here.
 */
export async function getRunByShareId(shareId: string): Promise<RunRow | null> {
  const row = await platformDb
    .select()
    .from(backtestRuns)
    .where(eq(backtestRuns.shareId, shareId))
    .get();
  return row ? rowToRun(row) : null;
}

/** True iff the session user owns the run, OR the run is publicly shared. */
export function canViewRun(run: RunRow, viewerId: string | null): boolean {
  if (run.shareId) return true;
  return Boolean(viewerId) && run.userId === viewerId;
}

/**
 * Opt a run into (or out of) public sharing. IDEMPOTENT: enabling an
 * already-shared run returns its EXISTING shareId — re-sharing never mints a
 * second link. Only the owner may toggle. Returns the resulting shareId (null
 * when disabled) — the caller composes the absolute URL.
 */
export async function shareRun(
  id: string,
  userId: string,
  enabled: boolean
): Promise<{ ok: boolean; shareId: string | null }> {
  const row = await platformDb.select().from(backtestRuns).where(eq(backtestRuns.id, id)).get();
  if (!row || row.userId !== userId) return { ok: false, shareId: null };

  if (!enabled) {
    if (row.shareId !== null) {
      await platformDb.update(backtestRuns).set({ shareId: null }).where(eq(backtestRuns.id, id));
    }
    return { ok: true, shareId: null };
  }

  // Idempotent: a run that's already shared keeps the same id.
  if (row.shareId) return { ok: true, shareId: row.shareId };

  const shareId = generateShareId();
  await platformDb.update(backtestRuns).set({ shareId }).where(eq(backtestRuns.id, id));
  return { ok: true, shareId };
}

/** Delete a run (owner only). Returns whether a row was removed. */
export async function deleteRun(id: string, userId: string): Promise<boolean> {
  const row = await platformDb
    .select({ id: backtestRuns.id, userId: backtestRuns.userId })
    .from(backtestRuns)
    .where(eq(backtestRuns.id, id))
    .get();
  if (!row || row.userId !== userId) return false;
  await platformDb.delete(backtestRuns).where(eq(backtestRuns.id, id));
  return true;
}

/** Compose the absolute public share URL from a shareId. */
export function shareUrl(origin: string, shareId: string): string {
  return `${origin.replace(/\/$/, "")}/backtesting/r/${shareId}`;
}
