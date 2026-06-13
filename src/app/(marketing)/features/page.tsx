import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Trade logging with Indian charges, rules & mistakes engine, daily journal, P&L calendar, analytics, broker CSV imports, and your-own-database privacy.",
  alternates: { canonical: "/features" },
};

const SECTIONS = [
  {
    title: "Log trades in 15 seconds",
    text: "Quick-add knows Indian FnO: symbol, strike, CE/PE, expiry, lots. Gross P&L, all statutory charges (STT, exchange, GST, SEBI, stamp duty) and net P&L are computed instantly from your broker's charge profile. Planned entry/SL/target give you R-multiples automatically.",
  },
  {
    title: "The rules & mistakes engine",
    text: "Write your rules once — 'risk max 1%', 'no trades in the first 15 minutes', 'stop after 2 losses'. Tick them off daily. TradeMarkk tracks adherence over time and prices every broken rule in rupees, so you can see your most expensive habit, not just feel it.",
  },
  {
    title: "A journal you'll actually keep",
    text: "Three boxes a day: pre-market plan, live notes, post-market review. Mood tracking, 'followed my plan' flag, journaling streaks, and your day's trades attached automatically.",
  },
  {
    title: "Analytics that tell the truth",
    text: "Equity curve with drawdown, P&L calendar heatmap, win rate, profit factor, expectancy, R-distribution, performance by hour of day, weekday, setup, symbol and direction. All filterable by period.",
  },
  {
    title: "Broker imports",
    text: "Upload tradebook CSVs from Zerodha Console, Upstox, Angel One, Dhan, Fyers or Groww. Fills are FIFO-paired into round-trip trades with charges applied; re-importing the same file never duplicates.",
  },
  {
    title: "Your data, three ways",
    text: "Hosted (your own isolated database, managed by us), BYOD (your own free Turso database — we never see your data), or fully local in-browser. Switch anytime with verified, client-side migration.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14 [&_section]:max-w-3xl">
      <h1 className="text-3xl font-bold">Everything a serious intraday trader needs</h1>
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
