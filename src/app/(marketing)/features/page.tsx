import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Trade logging for every Indian trader type with paise-accurate charges, an FY tax pack, a rules & mistakes engine, insights/tilt/Monte-Carlo analytics, broker CSV imports, a multi-broker Chrome extension, and your-own-database privacy.",
  alternates: { canonical: "/features" },
  // Match og:url to the route's canonical (relative — metadataBase resolves it)
  // so it doesn't inherit the homepage url; the branded card image still comes
  // from the root layout's explicit openGraph.images.
  openGraph: { url: "/features" },
};

const SECTIONS = [
  {
    title: "Log any trade in 15 seconds",
    text: "Built for every Indian trader: intraday, swing, positional, F&O, commodity (MCX) and currency (CDS). Quick-add knows symbol, strike, CE/PE, expiry and lots — and multi-leg strategies (straddles, spreads, iron condors) carry per-leg entries and exits. Planned entry/SL/target give you R-multiples automatically.",
  },
  {
    title: "Paise-accurate charges & an Indian tax pack",
    text: "Gross P&L, every statutory charge (STT/CTT, exchange, GST, SEBI, stamp duty) and net P&L are computed per leg to the paisa from your broker's charge profile. At year-end, the tax pack groups by financial year with F&O turnover (ICAI), the speculative/non-speculative split and realised P&L per instrument — exportable as CSV, Excel or print-to-PDF.",
  },
  {
    title: "The rules & mistakes engine",
    text: "Write your rules once — 'risk max 1%', 'no trades in the first 15 minutes', 'stop after 2 losses'. Tick them off daily. TradeMarkk tracks adherence over time and prices every broken rule in rupees, so you can see your most expensive habit, not just feel it.",
  },
  {
    title: "Insights, tilt & Monte-Carlo",
    text: "Equity curve with drawdown, P&L calendar heatmap, win rate, profit factor, expectancy, R-distribution, and performance by hour, weekday, setup, symbol and direction. Plus tilt detection (revenge sizing, rushed re-entries, overtrading) and a Monte-Carlo equity cone — all computed in your browser, on your own data.",
  },
  {
    title: "Broker imports & a multi-broker extension",
    text: "Upload tradebook CSVs from Zerodha Console, Upstox, Angel One, Dhan, Fyers or Groww — fills FIFO-pair into round trips with charges applied and re-imports never duplicate. The companion Chrome extension captures trades and runs a pre-trade rules checklist straight from your Kite, Upstox, Groww, Dhan or Fyers tab.",
  },
  {
    title: "Backtesting — coming as the dataset goes live",
    text: "Replay your saved playbooks against historical NIFTY & BANKNIFTY data with per-strategy equity curves, expectancy and walk-forward validation. We're building this on 5 years of 1-minute data; it ships as the dataset goes live.",
  },
  {
    title: "Your data, three ways",
    text: "Hosted (your own isolated database, managed by us), BYOD (your own free Turso database — we never see your data), or fully local in-browser. Switch anytime with verified, client-side migration.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14 [&_section]:max-w-3xl">
      <h1 className="text-3xl font-bold">Everything a serious Indian trader needs</h1>
      <div className="mt-8 space-y-8">
        {SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{s.text}</p>
          </section>
        ))}
      </div>
      <Button className="mt-10" size="lg" asChild>
        <Link href="/app/dashboard">Start free</Link>
      </Button>
    </div>
  );
}
