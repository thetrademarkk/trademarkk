import type { Metadata } from "next";
import { BacktestHome } from "./backtest-home";

export const metadata: Metadata = {
  title: "Backtesting",
  description:
    "Backtest NIFTY, BANKNIFTY & SENSEX option strategies free in your browser. Honest about data coverage, no login until you save. Educational only.",
  alternates: { canonical: "/backtesting" },
  openGraph: { url: "/backtesting" },
};

/**
 * The backtesting landing. Fully static + indexable — the only "compute" a
 * first-time visitor sees is the pre-baked sample card, which hydrates from a
 * static module and NEVER boots the engine/WASM (UX Priority 1). No server data
 * fetch, so it prerenders cleanly.
 */
export default function BacktestingLandingPage() {
  return <BacktestHome />;
}
