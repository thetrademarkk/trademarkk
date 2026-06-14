/**
 * Run-result serialization for persistence + share (BT-09).
 *
 * A RunResult is the IMMUTABLE artifact of a backtest. To save / share one we
 * store it verbatim as a stable JSON string and read it back into a
 * byte-identical RunResult — never re-deriving it by re-running the engine.
 * This module is the single round-trip boundary:
 *
 *     RunResult  ──serializeRunResult──►  string blob  (what the DB stores)
 *     string blob ──deserializeRunResult─►  RunResult   (what /r/[id] renders)
 *
 * The blob is wrapped in a tiny versioned envelope so a future RunResult schema
 * bump can be migrated on read without guessing. The payload is parsed back
 * through the canonical `runResultSchema` (zod) on the way OUT, so a tampered
 * or truncated row can never reach the UI as a malformed RunResult.
 *
 * Determinism contract (run-result.ts): the same RunResult round-trips to an
 * identical RunResult — `deserializeRunResult(serializeRunResult(r))` deep-equals
 * `r`. RunResult holds only JSON primitives (numbers, strings, arrays, plain
 * objects), so `JSON.stringify`/`JSON.parse` is lossless here.
 */

import { z } from "zod";
import { runResultSchema, type RunResult } from "../shared/run-result";

export const STORED_RUN_VERSION = 1 as const;

/** The on-disk envelope: a version tag + the validated RunResult payload. */
export const storedRunEnvelopeSchema = z.object({
  storedVersion: z.literal(STORED_RUN_VERSION),
  result: runResultSchema,
});
export type StoredRunEnvelope = z.infer<typeof storedRunEnvelopeSchema>;

/**
 * Serialize a RunResult into the immutable stored blob. Validates on the way
 * IN so a malformed result is never persisted. Keys are emitted in the object's
 * own order — stable for a given RunResult, which is all the round-trip needs.
 */
export function serializeRunResult(result: RunResult): string {
  // Validate (and normalize) before storing — refuse to persist garbage.
  const parsed = runResultSchema.parse(result);
  const envelope: StoredRunEnvelope = { storedVersion: STORED_RUN_VERSION, result: parsed };
  return JSON.stringify(envelope);
}

/**
 * Read a stored blob back into a RunResult. Re-validates through the canonical
 * schema so a tampered/truncated/legacy row throws here rather than rendering a
 * broken result. Throws on any parse/validation failure (callers map to 404/410).
 */
export function deserializeRunResult(blob: string): RunResult {
  const json: unknown = JSON.parse(blob);
  const envelope = storedRunEnvelopeSchema.parse(json);
  return envelope.result;
}

/** Non-throwing variant — returns the RunResult or null on any failure. */
export function safeDeserializeRunResult(blob: string): RunResult | null {
  try {
    return deserializeRunResult(blob);
  } catch {
    return null;
  }
}
