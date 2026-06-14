import type { Metadata } from "next";
import { BacktestHome } from "./backtest-home";
import { FeaturedPresets } from "@/components/backtesting/presets/featured-presets";

export const metadata: Metadata = {
  title: "Backtesting",
  description:
    "Backtest NIFTY, BANKNIFTY & SENSEX option strategies free in your browser. Honest about data coverage, no login until you save. Educational only.",
  // Let metadataBase + canonical drive the URLs and inherit the branded OG card
  // from the root layout — an explicit openGraph.url without its own image only
  // duplicated the homepage og:url.
  alternates: { canonical: "/backtesting" },
};

/**
 * The backtesting landing. Fully static + indexable — the only "compute" a
 * first-time visitor sees is the pre-baked sample card, which hydrates from a
 * static module and NEVER boots the engine/WASM (UX Priority 1). No server data
 * fetch, so it prerenders cleanly. The featured-templates strip is a sibling
 * server section (coverage computed at build time, manifest stays server-side).
 */
export default function BacktestingLandingPage() {
  return (
    <>
      <BacktestHome />
      <div className="mx-auto max-w-5xl px-4 pb-12">
        <FeaturedPresets />
      </div>
    </>
  );
}
