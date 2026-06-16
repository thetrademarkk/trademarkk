"use client";

import * as React from "react";
import NumberFlow from "@number-flow/react";
import {
  BarChart3,
  Chrome,
  Database,
  FileCheck,
  FlaskConical,
  Flame,
  Landmark,
  Layers,
  Upload,
} from "lucide-react";
import { Reveal } from "./reveal";
import { cn } from "@/lib/utils";

/** Mistake-cost ticker — counts what bad habits cost, live (only while visible). */
function CostTicker() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [i, setI] = React.useState(0);
  const [visible, setVisible] = React.useState(false);
  const rows = React.useMemo(
    () => [
      { tag: "Revenge trade", cost: -18400 },
      { tag: "Oversized", cost: -12750 },
      { tag: "Chased entry", cost: -7300 },
    ],
    []
  );
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  React.useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setI((n) => (n + 1) % rows.length), 2200);
    return () => clearInterval(t);
  }, [visible, rows.length]);
  return (
    <div ref={ref} className="mt-4 space-y-2">
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

/** Multi-leg straddle P&L breakdown mini-demo — real product output. */
function StraddleDemo() {
  const rows: [string, string][] = [
    ["Leg 1 · 52000 CE sell", "+₹3,450.00"],
    ["Leg 2 · 52000 PE sell", "+₹2,280.00"],
    ["Charges (both legs)", "−₹187.42"],
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
        <span className="text-profit">+₹5,542.58</span>
      </div>
    </div>
  );
}

/** A trimmed FY tax-pack summary — the kind of line the reports tab produces. */
function TaxPackDemo() {
  const rows: [string, string][] = [
    ["F&O turnover (ICAI)", "₹12,84,210"],
    ["Speculative (intraday EQ)", "₹1,42,900"],
    ["Total charges (est.)", "−₹9,318"],
  ];
  return (
    <div className="mt-4 rounded-lg border bg-surface-2/40 p-3 font-money text-xs">
      <div className="mb-1.5 flex items-center justify-between border-b pb-1.5 font-sans text-[11px] text-muted">
        <span>FY 2025–26 · Tax pack</span>
        <span>CSV · Excel · PDF</span>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between py-0.5 text-muted">
          <span className="font-sans">{k}</span>
          <span>{v}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-1.5 text-sm font-semibold">
        <span className="font-sans">Realised P&L</span>
        <span className="text-profit">+₹2,18,640</span>
      </div>
    </div>
  );
}

/** The broker auto-detect banner exactly as it appears in the import dialog. */
function BrokerDetectDemo() {
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs">
        <FileCheck className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>
          Detected: <span className="font-medium">Zerodha Console tradebook</span> · 142 rows
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["Zerodha", "Upstox", "Angel One", "Dhan", "Fyers", "Groww"].map((b) => (
          <span
            key={b}
            className="rounded-full border bg-surface-2/60 px-2 py-0.5 text-[10px] text-muted"
          >
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

const CELLS = [
  {
    icon: Layers,
    title: "Every trader type, multi-leg included",
    text: "Intraday, swing, positional, F&O, commodity (MCX) and currency (CDS). Log straddles, spreads and iron condors with per-leg strikes, CE/PE, entries and exits in a single trade.",
    demo: <StraddleDemo />,
    className: "md:row-span-2",
  },
  {
    icon: Landmark,
    title: "Paise-accurate Indian charges & tax pack",
    text: "STT, exchange, GST, SEBI, stamp duty and CTT computed per leg to the paisa — then a financial-year tax pack with turnover, speculative split and realised P&L you can export as CSV, Excel or PDF.",
    demo: <TaxPackDemo />,
    className: "md:row-span-2",
  },
  {
    icon: BarChart3,
    title: "Insights, tilt & Monte-Carlo",
    text: "Tag mistakes and TradeMarkk prices each habit in rupees — alongside expectancy, R-multiples, tilt detection (revenge, overtrading) and a Monte-Carlo equity cone for your edge.",
    demo: <CostTicker />,
    className: "md:row-span-2",
  },
  {
    icon: Upload,
    title: "Import from 6 Indian brokers",
    text: "Drop a tradebook CSV — the broker is auto-detected, buys and sells pair into round trips, and re-imports never duplicate.",
    demo: <BrokerDetectDemo />,
    className: "md:row-span-2",
  },
  {
    icon: Chrome,
    title: "Multi-broker Chrome extension",
    text: "Capture trades straight from Kite, Upstox, Groww, Dhan and Fyers without leaving your broker tab — with a pre-trade rules checklist where you trade.",
  },
  {
    icon: FlaskConical,
    title: "Backtesting",
    text: "Replay your strategies against real 1-minute NIFTY, BANKNIFTY & SENSEX options data — right in your browser. Equity curves, expectancy and walk-forward checks, with honest data-coverage on every result.",
  },
  {
    icon: Database,
    title: "Your data, your database",
    text: "Hosted in your own isolated database by default, or connect a Turso DB you own and we never see a single trade — even a fully local in-browser mode. Switch directions anytime.",
  },
  {
    icon: Flame,
    title: "Streaks & community",
    text: "Journal daily to build a streak, share trade cards with structured R-multiples, and learn from traders who post losses as openly as wins.",
  },
];

export function FeatureBento() {
  return (
    <div className="grid gap-4 md:grid-cols-2 md:[grid-auto-rows:minmax(0,auto)] lg:grid-cols-3">
      {CELLS.map((c, i) => (
        <Reveal key={c.title} delay={i * 0.06} className={c.className}>
          <div data-glow className="glow-card group h-full rounded-xl border bg-surface p-5">
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent transition-transform group-hover:scale-110">
                <c.icon className="h-4.5 w-4.5" aria-hidden />
              </div>
            </div>
            <h3 className="mt-4 text-base font-semibold">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">{c.text}</p>
            {"demo" in c ? c.demo : null}
          </div>
        </Reveal>
      ))}
    </div>
  );
}
