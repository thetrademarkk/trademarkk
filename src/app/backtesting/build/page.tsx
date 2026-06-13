import type { Metadata } from "next";
import { Suspense } from "react";
import { BuilderEntry } from "@/components/backtesting/builder/builder-entry";

export const metadata: Metadata = {
  title: "Build a strategy",
  description: "No-code options strategy builder — pick an index, add legs, set risk, and run.",
  // App-like surface — not an SEO target.
  robots: { index: false, follow: true },
  alternates: { canonical: "/backtesting/build" },
};

/**
 * The no-code BACKTEST BUILDER (BT-06): a 5-node wizard (Setup · Legs · Timing ·
 * Risk · Review) with an always-mounted live payoff rail and an interactive
 * strike ladder. Anonymous-first — no login to build or run. The wizard state
 * lives in a zustand store autosaved to localStorage, so every step is
 * deep-linkable and back-navigable without losing state.
 *
 * useSearchParams (template deep link) is isolated behind Suspense so the static
 * shell can prerender without bailing the whole route to client-only.
 */
export default function BacktestingBuildPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted">Loading builder…</div>
      }
    >
      <BuilderEntry />
    </Suspense>
  );
}
