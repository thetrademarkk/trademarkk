import { NextResponse } from "next/server";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { canViewRun, deleteRun, getRunById } from "@/server/backtest";

/**
 * GET /api/backtest/runs/[id] — fetch a run by its primary id. Visible to the
 * OWNER, or to anyone if the run has been publicly shared (canViewRun). Returns
 * the immutable RunResult. (Public share links resolve via /backtesting/r/[shareId],
 * which reads by shareId — this route is the owner-scoped lookup.)
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const run = await getRunById(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const session = await getSession();
  if (!canViewRun(run, session?.user.id ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    runId: run.id,
    shareId: run.shareId,
    createdAt: run.createdAt,
    result: run.result,
  });
}

/** DELETE /api/backtest/runs/[id] — owner removes their run (and its share). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const ok = await deleteRun(id, session.user.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
