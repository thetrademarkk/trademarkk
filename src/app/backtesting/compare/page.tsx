import type { Metadata } from "next";
import { GitCompareArrows } from "lucide-react";
import { DbSessionProvider } from "@/providers/db-session-provider";
import { CompareClient } from "@/components/backtesting/compare/compare-client";

export const metadata: Metadata = {
  title: "Compare with your journal",
  description:
    "Overlay your real journaled trades against a mechanical backtest of the same idea — an honest mirror for self-review. Runs locally on your own journal.",
  // App-like surface that reads private journal data — never an SEO target.
  robots: { index: false, follow: true },
  alternates: { canonical: "/backtesting/compare" },
};

/**
 * BT-12 journal-compare route. A clearly-owned compare surface inside the public
 * backtesting universe. It mounts its OWN DbSessionProvider so it can read the
 * user's journal trades through the existing query layer (read-only) — the
 * backtesting layout has QueryProvider but no DbSession, and the journal pages
 * (owned by the segments lane) are never touched. Opt-in: the comparison only
 * runs when the user explicitly presses "Run comparison".
 */
export default function BacktestingComparePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <header className="mb-5">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15">
          <GitCompareArrows className="h-5 w-5 text-accent" aria-hidden />
        </span>
        <h1 className="text-2xl font-bold sm:text-3xl">Compare with your journal</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          The journal-first question: <em>did you actually trade your plan?</em> This overlays your
          real journaled trades on a mechanical backtest of the same idea and shows — descriptively,
          never as a verdict — where your real trading diverged from that baseline.
        </p>
      </header>
      <DbSessionProvider>
        <CompareClient />
      </DbSessionProvider>
    </div>
  );
}
