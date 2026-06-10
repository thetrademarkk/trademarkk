"use client";

import * as React from "react";
import NumberFlow from "@number-flow/react";
import { motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Live product showcase: a real animated dashboard (not a screenshot, not a
 * fake video) — equity curve draws itself, P&L tickers roll, rules tick off.
 */
const SCENES = [
  { pnl: 12450, win: 64, r: 1.8 },
  { pnl: 18920, win: 67, r: 2.1 },
  { pnl: 15780, win: 66, r: 1.9 },
];

const CURVE = "M0,86 C30,80 45,84 70,72 C95,60 110,66 135,58 C160,50 175,56 200,42 C225,30 245,38 270,26 C295,16 315,22 340,12";

const RULES = ["Risk max 1% per trade", "No trades first 15 min", "SL before entry"];

const HEAT = [3, -1, 2, 4, 0, 1, 3, -2, 2, 5, 1, -1, 4, 2];

export function HeroShowcase() {
  const reduced = useReducedMotion();
  const [scene, setScene] = React.useState(0);
  const [ticks, setTicks] = React.useState(0);

  React.useEffect(() => {
    if (reduced) {
      setTicks(RULES.length);
      return;
    }
    const t = setInterval(() => setScene((s) => (s + 1) % SCENES.length), 2600);
    const r = setInterval(() => setTicks((n) => (n >= RULES.length ? 0 : n + 1)), 1300);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [reduced]);

  const s = SCENES[scene]!;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.25, ease: [0.21, 0.65, 0.36, 1] }}
      className="relative mx-auto mt-14 w-full max-w-3xl animate-float-slow"
    >
      <div className="absolute -inset-6 rounded-3xl bg-accent/10 blur-3xl" aria-hidden />
      <div className="relative overflow-hidden rounded-xl border bg-surface shadow-2xl">
        {/* window chrome */}
        <div className="flex items-center gap-1.5 border-b bg-surface-2/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-profit/70" />
          <span className="ml-3 text-[11px] text-muted">TradeMark — Dashboard</span>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {/* KPI tiles */}
          <div className="rounded-lg border bg-surface-2/40 p-3">
            <div className="micro-label">Net P&L · 30d</div>
            <div className="mt-1 font-money text-xl font-semibold text-profit">
              <NumberFlow
                value={s.pnl}
                format={{ style: "currency", currency: "INR", maximumFractionDigits: 0 }}
                locales="en-IN"
              />
            </div>
          </div>
          <div className="rounded-lg border bg-surface-2/40 p-3">
            <div className="micro-label">Win rate</div>
            <div className="mt-1 font-money text-xl font-semibold">
              <NumberFlow value={s.win} suffix="%" />
            </div>
          </div>
          <div className="rounded-lg border bg-surface-2/40 p-3">
            <div className="micro-label">Avg R</div>
            <div className="mt-1 font-money text-xl font-semibold">
              <NumberFlow value={s.r} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} suffix="R" />
            </div>
          </div>

          {/* Equity curve — draws itself */}
          <div className="rounded-lg border bg-surface-2/40 p-3 sm:col-span-2">
            <div className="micro-label mb-2">Equity curve</div>
            <svg viewBox="0 0 340 100" className="h-28 w-full" fill="none" aria-hidden>
              <motion.path
                d={`${CURVE} L340,100 L0,100 Z`}
                fill="url(#eqFill)"
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.2, delay: 1.4 }}
              />
              <motion.path
                d={CURVE}
                stroke="var(--profit)"
                strokeWidth="2"
                strokeLinecap="round"
                initial={reduced ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.6, delay: 0.6, ease: "easeOut" }}
              />
              <defs>
                <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--profit)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--profit)" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
            {/* mini heatmap */}
            <div className="mt-2 grid grid-cols-14 gap-1">
              {HEAT.map((v, i) => (
                <motion.span
                  key={i}
                  initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1 + i * 0.06 }}
                  className="h-3 rounded-sm"
                  style={{
                    backgroundColor:
                      v === 0
                        ? "var(--surface-2)"
                        : v > 0
                          ? `color-mix(in srgb, var(--profit) ${20 + v * 12}%, transparent)`
                          : `color-mix(in srgb, var(--loss) ${30 + Math.abs(v) * 12}%, transparent)`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Rule checklist ticking */}
          <div className="rounded-lg border bg-surface-2/40 p-3">
            <div className="micro-label mb-2">Today&apos;s rules</div>
            <div className="space-y-2">
              {RULES.map((rule, i) => {
                const done = i < ticks;
                return (
                  <div key={rule} className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border transition-colors duration-300",
                        done ? "border-profit bg-profit/20 text-profit" : "border-border text-transparent"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className={cn("transition-colors duration-300", done ? "text-foreground" : "text-muted")}>
                      {rule}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
