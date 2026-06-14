import { NextResponse } from "next/server";
import { getSession, notify } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { saveRun } from "@/server/backtest";
import { saveRunBodySchema } from "@/features/backtest/persist/api";

/**
 * POST /api/backtest/runs — the SAVE / CLAIM path (login-gated).
 *
 * Persists a CLIENT-computed run (the immutable RunResult artifact) plus the
 * strategy that produced it. This is exactly where an anonymous run is claimed:
 * after sign-in the held IndexedDB run is POSTed here ONCE with the now-known
 * user. The engine is never re-executed — the result is stored verbatim.
 *
 * Guard chain mirrors src/app/api/feedback/route.ts:
 *   origin → session (required) → rate-limit → zod-parse → act → typed JSON.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to save" }, { status: 401 });

  const { allowed } = await rateLimit(`bt:save:${session.user.id}`, 30, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many saves — try later" }, { status: 429 });
  }

  const parsed = saveRunBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid run" },
      { status: 400 }
    );
  }

  const { runId, strategyId } = await saveRun(
    session.user.id,
    parsed.data.strategy,
    parsed.data.result,
    parsed.data.strategyId
  );

  // D6: confirm the save with an in-app notification (best-effort; never blocks
  // the response). actorId === userId so it surfaces as a self-action receipt.
  void notify({
    userId: session.user.id,
    actorId: "system",
    type: "backtest_done",
    backtestId: runId,
  });

  return NextResponse.json({ runId, strategyId }, { status: 201 });
}
