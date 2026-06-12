import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The hero visual: a handcrafted dashboard mock inside browser chrome —
 * restored from landing v1 by user request ("the screenshot is not looking
 * relevant — earlier it was good") and refined. Pure JSX + CSS, zero client
 * JS: crisp at any DPR, themes with the site, and never competes with LCP.
 * The equity curve draws itself and the rule ticks pop in via CSS keyframes;
 * reduced-motion users get the finished state instantly (global rule).
 */

const KPIS: { label: string; value: string; className?: string }[] = [
  { label: "Net P&L · 30d", value: "₹18,920", className: "text-profit" },
  { label: "Win rate", value: "67%" },
  { label: "Avg R", value: "2.1R" },
];

const CURVE =
  "M0,86 C30,80 45,84 70,72 C95,60 110,66 135,58 C160,50 175,56 200,42 C225,30 245,38 270,26 C295,16 315,22 340,12";

const RULES = ["Risk max 1% per trade", "No trades first 15 min", "SL before entry"];

/** Day strip: signed intensity per trading day (positive = green, negative = red). */
const DAYS = [3, -1, 2, 4, 0, 1, 3, -2, 2, 5, 1, -1, 4, 2];

export function HeroShowcase() {
  return (
    <div className="hero-frame relative mx-auto mt-14 w-full max-w-3xl animate-float-slow">
      <div className="absolute -inset-8 rounded-3xl bg-accent/10 blur-3xl" aria-hidden />
      <div
        data-testid="hero-showcase"
        className="hero-tilt relative overflow-hidden rounded-xl border bg-surface text-left shadow-2xl"
      >
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 border-b bg-surface-2/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-profit/70" />
          <span className="ml-3 text-[11px] text-muted">TradeMark — Dashboard</span>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-3">
          {/* KPI tiles */}
          {KPIS.map((k) => (
            <div key={k.label} className="rounded-lg border bg-surface-2/40 p-3">
              <div className="micro-label">{k.label}</div>
              <div className={cn("mt-1 font-money text-xl font-semibold", k.className)}>
                {k.value}
              </div>
            </div>
          ))}

          {/* Equity curve — draws itself once on load */}
          <div className="rounded-lg border bg-surface-2/40 p-3 sm:col-span-2">
            <div className="micro-label mb-2">Equity curve</div>
            <svg viewBox="0 0 340 100" className="h-28 w-full" fill="none" aria-hidden>
              <path
                d={`${CURVE} L340,100 L0,100 Z`}
                fill="url(#heroEqFill)"
                className="hero-fade"
              />
              <path
                d={CURVE}
                pathLength={1}
                stroke="var(--profit)"
                strokeWidth="2"
                strokeLinecap="round"
                className="hero-draw"
              />
              <defs>
                <linearGradient id="heroEqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--profit)" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="var(--profit)" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
            {/* Day strip — green/red pills, one per trading day */}
            <div className="mt-2 flex gap-1" aria-hidden>
              {DAYS.map((v, i) => (
                <span
                  key={i}
                  className="hero-fade h-2 flex-1 rounded-full"
                  style={{
                    animationDelay: `${0.7 + i * 0.05}s`,
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

          {/* Today's rules — green check tiles */}
          <div className="rounded-lg border bg-surface-2/40 p-3">
            <div className="micro-label mb-2">Today&apos;s rules</div>
            <div className="space-y-2">
              {RULES.map((rule, i) => (
                <div key={rule} className="flex items-center gap-2 text-xs">
                  <span
                    className="hero-tick flex h-4 w-4 items-center justify-center rounded border border-profit bg-profit/20 text-profit"
                    style={{ animationDelay: `${1 + i * 0.18}s` }}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="text-foreground">{rule}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
