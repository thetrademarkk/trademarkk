import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SampleBacktestRunner } from "./sample-backtest-runner";

export const metadata: Metadata = {
  title: "Build a strategy",
  description: "No-code options strategy builder — pick an index, add legs, set risk, and run.",
  // App-like surface — not an SEO target.
  robots: { index: false, follow: true },
  alternates: { canonical: "/backtesting/build" },
};

/**
 * No-code builder placeholder. The full guided wizard with a live payoff rail
 * is the next milestone (the data models + calendar that back it ship in this
 * foundation). Kept honest and on-brand so the landing CTA never dead-ends.
 */
export default function BacktestingBuildPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15">
          <FlaskConical className="h-6 w-6 text-accent" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold">The no-code builder is on the way</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          We&apos;re wiring up the guided wizard — index, legs, timing and risk — with a live payoff
          preview and an honest strike ladder. The engine, data model and market calendar behind it
          are already in place.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline">
            <Link href="/backtesting">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to backtesting
            </Link>
          </Button>
        </div>
      </div>

      {/* BT-05 proof: run the real engine in a Web Worker end-to-end. */}
      <SampleBacktestRunner />
    </div>
  );
}
