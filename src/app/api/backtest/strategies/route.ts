import { NextResponse } from "next/server";
import { getSession } from "@/server/community";
import { isAllowedOrigin } from "@/server/origin-check";
import { rateLimit } from "@/server/rate-limit";
import { saveStrategy } from "@/server/backtest";
import { saveStrategyBodySchema } from "@/features/backtest/persist/api";

/**
 * POST /api/backtest/strategies — save a strategy DEFINITION on its own
 * (login-gated). Used by the builder's "Save strategy" when the user wants to
 * keep the recipe without (or before) attaching a run. Anonymous building is
 * never gated — only the save itself is.
 */
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to save" }, { status: 401 });

  const { allowed } = await rateLimit(`bt:strat:${session.user.id}`, 30, 3600);
  if (!allowed) return NextResponse.json({ error: "Too many saves — try later" }, { status: 429 });

  const parsed = saveStrategyBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid strategy" },
      { status: 400 }
    );
  }

  const strategyId = await saveStrategy(session.user.id, parsed.data.strategy);
  return NextResponse.json({ strategyId }, { status: 201 });
}
