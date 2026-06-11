import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in TradeMark.",
  alternates: { canonical: "/changelog" },
};

const RELEASES = [
  {
    version: "0.1.0",
    date: "June 2026",
    items: [
      "Initial release",
      "Trade logging with Indian FnO charges engine (STT, GST, stamp duty, SEBI, exchange)",
      "Daily journal with pre/post-market sections, mood and streaks",
      "Rules engine: daily checklist, adherence %, ₹ cost of broken rules",
      "Mistake tags with frequency and cost analytics",
      "Dashboard: KPIs, equity curve, P&L calendar heatmap",
      "Analytics: by hour, weekday, setup, symbol, segment, direction + R-distribution",
      "Playbooks with per-setup performance",
      "Weekly/monthly reports with CSV & print export",
      "Broker tradebook CSV import with FIFO pairing & dedupe",
      "Three storage modes: hosted, bring-your-own Turso DB, in-browser demo",
      "Verified in-app migration between storage modes (both directions)",
      "4 themes (Carbon, Midnight, OLED, Light) + color-blind-safe P&L",
      "Installable PWA, fully responsive",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <h1 className="text-3xl font-bold">Changelog</h1>
      <div className="mt-8 space-y-10">
        {RELEASES.map((r) => (
          <section key={r.version}>
            <h2 className="text-lg font-semibold">
              v{r.version} <span className="ml-2 text-xs font-normal text-muted">{r.date}</span>
            </h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {r.items.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
