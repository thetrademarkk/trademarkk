import { NextResponse } from "next/server";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { serverEnv } from "@/server/env";
import { shareRun, shareUrl } from "@/server/backtest";
import { shareRunBodySchema } from "@/features/backtest/persist/api";

/**
 * POST /api/backtest/runs/[id]/share — opt a run into (or out of) a public,
 * immutable share link. Owner-only. IDEMPOTENT: enabling an already-shared run
 * returns the SAME url; re-sharing never mints a second link. `enabled:false`
 * clears the share (the run becomes owner-only again). The minted shareId is an
 * unguessable nanoid, so a run is private until the owner explicitly shares it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { allowed } = await rateLimit(`bt:share:${session.user.id}`, 60, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id } = await ctx.params;
  const parsed = shareRunBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { ok, shareId } = await shareRun(id, session.user.id, parsed.data.enabled);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = shareId ? shareUrl(serverEnv.authUrl, shareId) : null;
  return NextResponse.json({ shareId, url });
}
