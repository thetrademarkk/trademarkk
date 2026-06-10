"use client";

import * as React from "react";
import NumberFlow from "@number-flow/react";
import { BarChart3, CalendarDays, Database, NotebookPen, Upload, Zap } from "lucide-react";
import { Reveal } from "./reveal";
import { cn } from "@/lib/utils";

/** Mistake-cost ticker — counts what bad habits cost, live. */
function CostTicker() {
  const [i, setI] = React.useState(0);
  const rows = React.useMemo(
    () => [
      { tag: "Revenge trade", cost: -18400 },
      { tag: "Oversized", cost: -12750 },
      { tag: "Chased entry", cost: -7300 },
    ],
    []
  );
  React.useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % rows.length), 2200);
    return () => clearInterval(t);
  }, [rows.length]);
  return (
    <div className="mt-4 space-y-2">
      {rows.map((r, idx) => (
        <div
          key={r.tag}
          className={cn(
            "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-all duration-500",
            idx === i ? "border-loss/50 bg-loss/10" : "opacity-50"
          )}
        >
          <span>{r.tag}</span>
          <span className="font-money text-loss">
            <NumberFlow
              value={idx === i ? r.cost : 0}
              format={{ style: "currency", currency: "INR", maximumFractionDigits: 0 }}
              locales="en-IN"
            />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Charges breakdown mini-demo. */
function ChargesDemo() {
  const rows: [string, string][] = [
    ["Brokerage", "₹40.00"],
    ["STT (sell premium)", "₹9.00"],
    ["Exchange + SEBI", "₹5.79"],
    ["GST + stamp duty", "₹8.47"],
  ];
  return (
    <div className="mt-4 rounded-lg border bg-surface-2/40 p-3 font-money text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between py-0.5 text-muted">
          <span className="font-sans">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-1.5 text-sm font-semibold">
        <span className="font-sans">Net P&L</span>
        <span className="text-profit">+₹1,436.74</span>
      </div>
    </div>
  );
}

const CELLS = [
  {
    icon: Zap,
    title: "Log a trade in 15 seconds",
    text: "Strike, CE/PE, expiry, lots — quick-add speaks Indian FnO. Every statutory charge is computed instantly.",
    demo: <ChargesDemo />,
    className: "md:row-span-2",
  },
  {
    icon: BarChart3,
    title: "Your most expensive habit, priced",
    text: "Tag mistakes on trades. TradeMark totals what each habit costs you — in rupees, not feelings.",
    demo: <CostTicker />,
    className: "md:row-span-2",
  },
  {
    icon: NotebookPen,
    title: "A journal you'll keep",
    text: "Pre-market plan → live notes → review. Mood, streaks, and your day's trades attached automatically.",
  },
  {
    icon: Upload,
    title: "Import your tradebook",
    text: "Zerodha, Upstox, Angel One, Dhan, Fyers, Groww CSVs — auto-paired into round trips, deduped.",
  },
  {
    icon: CalendarDays,
    title: "P&L calendar",
    text: "Green and red days at a glance. Click any day to replay it — trades, journal, rules.",
  },
  {
    icon: Database,
    title: "Switch storage anytime",
    text: "Hosted ⇄ your own database, copied in your browser and verified table-by-table before flipping.",
  },
];

export function FeatureBento() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 md:[grid-auto-rows:minmax(0,auto)]">
      {CELLS.map((c, i) => (
        <Reveal key={c.title} delay={i * 0.06} className={c.className}>
          <div className="group h-full rounded-xl border bg-surface p-5 transition-colors hover:border-accent/50">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent transition-transform group-hover:scale-110">
              <c.icon className="h-4.5 w-4.5" />
            </div>
            <h3 className="mt-4 text-base font-semibold">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">{c.text}</p>
            {c.demo}
          </div>
        </Reveal>
      ))}
    </div>
  );
}
