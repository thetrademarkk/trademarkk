/**
 * Shared request/response zod schemas for the BT-09 persistence + share API.
 * Lives in `features` (not `server`) so both the route handlers and the client
 * claim/save effects parse against ONE contract — a save body that type-checks
 * on the client is the same shape the server validates.
 */

import { z } from "zod";
import { runResultSchema } from "../shared/run-result";
import { strategyDefSchema } from "../shared/strategy-def";

/**
 * POST /api/backtest/runs — the save / claim path. Persists a CLIENT-computed
 * run (the immutable artifact) plus the strategy that produced it. The server
 * never re-executes the engine; it stores `result` verbatim.
 */
export const saveRunBodySchema = z.object({
  strategy: strategyDefSchema,
  result: runResultSchema,
  /** Optional id of an already-saved strategy to link the run to. */
  strategyId: z.string().min(1).optional(),
});
export type SaveRunBody = z.infer<typeof saveRunBodySchema>;

export const saveRunResponseSchema = z.object({
  runId: z.string(),
  strategyId: z.string(),
});
export type SaveRunResponse = z.infer<typeof saveRunResponseSchema>;

/**
 * POST /api/backtest/strategies — save a strategy definition on its own
 * (without a run), e.g. "save this strategy" from the builder.
 */
export const saveStrategyBodySchema = z.object({
  strategy: strategyDefSchema,
});
export type SaveStrategyBody = z.infer<typeof saveStrategyBodySchema>;

/**
 * POST /api/backtest/runs/[id]/share — opt into (or out of) a public share
 * link. Sharing is idempotent: enabling an already-shared run returns the SAME
 * url. `enabled:false` clears the share (the run becomes owner-only again).
 */
export const shareRunBodySchema = z.object({
  enabled: z.boolean().default(true),
});
export type ShareRunBody = z.infer<typeof shareRunBodySchema>;

export const shareRunResponseSchema = z.object({
  shareId: z.string().nullable(),
  url: z.string().nullable(),
});
export type ShareRunResponse = z.infer<typeof shareRunResponseSchema>;
