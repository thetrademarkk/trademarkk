import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { getRunByShareId } from "@/server/backtest";
import { isValidShareId } from "@/features/backtest/persist/share-id";
import { formatINR } from "@/lib/utils";
import { INDEX_META } from "@/features/backtest/shared/instruments";
import { SharedRunView } from "./shared-run-view";

/**
 * Immutable public share permalink — `/backtesting/r/[shareId]`.
 *
 * Renders a read-only RunResult from the immutable stored blob. NO auth is
 * required to view; the link is stable forever. The shareId is unguessable, so
 * only someone the owner gave the link can reach it. The full coverage-honesty
 * layer renders identically to the owner's view, plus a point-in-time-not-advice
 * disclaimer. A shared run is read-only for EVERYONE (owner included) — there is
 * no edit/save affordance on this page.
 *
 * Server component: reads by shareId (the only public lookup), 404s a missing /
 * malformed / un-shared id. The heavy result render is delegated to a client
 * child (charts need the browser).
 */
type Params = { params: Promise<{ shareId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shareId } = await params;
  if (!isValidShareId(shareId)) return { title: "Backtest not found" };
  const run = await getRunByShareId(shareId);
  if (!run) return { title: "Backtest not found" };
  const r = run.result;
  const sym = INDEX_META[r.config.market.symbol]?.label ?? r.config.market.symbol;
  const net = formatINR(r.stats.netPnl, { decimals: true });
  const title = `${r.config.name} · ${sym} backtest`;
  const description = `Net P&L ${net} over ${r.blotter.length} trading days · ${Math.round(
    r.coverage.overall * 100
  )}% data coverage. Point-in-time backtest on historical data — not advice.`;
  return {
    title,
    description,
    robots: { index: false, follow: true }, // shareable, not an SEO target
    openGraph: { title, description, type: "article" },
    alternates: { canonical: `/backtesting/r/${shareId}` },
  };
}

export default async function SharedBacktestPage({ params }: Params) {
  const { shareId } = await params;
  if (!isValidShareId(shareId)) notFound();
  const run = await getRunByShareId(shareId);
  if (!run) notFound();

  const r = run.result;
  const sym = INDEX_META[r.config.market.symbol]?.label ?? r.config.market.symbol;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-accent">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Shared backtest
        </div>
        <h1 className="text-xl font-semibold sm:text-2xl">{r.config.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {sym} · {r.config.market.dateRange.start} → {r.config.market.dateRange.end} ·{" "}
          {r.blotter.length} trading days
        </p>
      </header>

      {/* Point-in-time, not-advice disclaimer — first-class on a shared link. */}
      <p
        className="mb-5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-warning"
        data-testid="bt-share-disclaimer"
      >
        This is a point-in-time backtest on historical data, not advice or a prediction. Results are
        hypothetical, use patchy options coverage, and exclude liquidity/impact beyond modelled
        slippage. Past performance never guarantees future results.
      </p>

      <SharedRunView result={r} />

      <p className="mt-8 text-center text-xs text-muted">
        Want to build your own?{" "}
        <a href="/backtesting/build" className="text-accent hover:underline">
          Try the no-code backtester
        </a>
      </p>
    </div>
  );
}
