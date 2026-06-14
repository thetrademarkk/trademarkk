"use client";

import * as React from "react";
import Link from "next/link";
import { Code2, FlaskConical, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SAMPLE_RUN } from "./sample-run";
import { SampleResultCard } from "./sample-result-card";

// The full read-only report (incl. the BT-11 robustness tab) is heavy (Recharts)
// so it's lazy-loaded and only mounts when the visitor expands the sample.
const RunResultReport = React.lazy(() =>
  import("@/components/backtesting/results/run-result-report").then((m) => ({
    default: m.RunResultReport,
  }))
);

/** localStorage keys for the anonymous-first backtesting universe (tmk.bt.*). */
export const BT_KEYS = {
  visited: "tmk.bt.visited",
  lastMode: "tmk.bt.lastMode",
  draft: (mode: string) => `tmk.bt.draft.${mode}`,
  recentRuns: "tmk.bt.recentRuns",
} as const;

interface RecentRun {
  id: string;
  label: string;
  ts: number;
  index: string;
  pnl: number;
}

function readRecentRuns(): RecentRun[] {
  try {
    const raw = localStorage.getItem(BT_KEYS.recentRuns);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

const TWO_WAYS = [
  {
    href: "/backtesting/build",
    mode: "nocode",
    icon: FlaskConical,
    title: "No-code builder",
    blurb:
      "Pick an index, add legs, set risk — a guided wizard with a live payoff preview. Best for most traders.",
    cta: "Build a strategy",
  },
  {
    href: "/backtesting/code",
    mode: "code",
    icon: Code2,
    title: "Bring your own code",
    blurb:
      "Write a Python strategy and run it in your browser against the same data. Best if you want full control.",
    cta: "Write code",
  },
] as const;

const TRUST = [
  {
    icon: ShieldCheck,
    title: "Honest about data",
    text: "Option history is patchy. We show you coverage and nearest-strike substitution before, during and after a run — never a fabricated curve.",
  },
  {
    icon: Gauge,
    title: "Free & in your browser",
    text: "Runs entirely client-side on your machine. No account needed to build or run — we ask you to sign in only when you save or share.",
  },
  {
    icon: Sparkles,
    title: "NIFTY · BANKNIFTY · SENSEX",
    text: "1-minute index + options data, weekly and monthly expiries, with real Indian brokerage and charges modelled into every trade.",
  },
] as const;

/**
 * Landing client shell. First-time visitors see the full hero + the two ways +
 * a PRE-BAKED static sample result (instant, zero engine boot) + a trust row.
 * Returning visitors with recent runs see a compact "recent runs" rail. The
 * sample card is the "Run this" on-ramp: it is real result shape, clearly
 * labelled a sample, and never triggers WASM.
 */
export function BacktestHome() {
  const [recent, setRecent] = React.useState<RecentRun[]>([]);
  const [returning, setReturning] = React.useState(false);
  const [showFullSample, setShowFullSample] = React.useState(false);

  React.useEffect(() => {
    try {
      setReturning(localStorage.getItem(BT_KEYS.visited) === "1");
      setRecent(readRecentRuns());
      localStorage.setItem(BT_KEYS.visited, "1");
    } catch {
      /* storage blocked — treat as first visit */
    }
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* Hero */}
      <section className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15">
          <FlaskConical className="h-6 w-6 text-accent" aria-hidden />
        </span>
        <h1 className="mt-4 text-balance text-3xl font-bold sm:text-4xl">
          Backtest options strategies — free, honest, in your browser
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-pretty text-sm leading-6 text-muted sm:text-base">
          Test a NIFTY, BANKNIFTY or SENSEX idea against real 1-minute history. Build with no code
          or bring your own. See a beautiful result that&apos;s honest about exactly what data
          existed — and sign in only when you want to keep it.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/backtesting/build">Build a strategy — free, no signup</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/backtesting/code">Write code</Link>
          </Button>
        </div>
      </section>

      {/* Recent runs rail (returning visitors only) */}
      {returning && recent.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-muted">Your recent runs</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {recent.map((r) => (
              <Link
                key={r.id}
                href={`/backtesting/run/${r.id}`}
                className="rounded-lg border bg-surface px-3 py-2 text-xs hover:border-accent"
              >
                <span className="font-medium">{r.label}</span>
                <span className="ml-2 text-muted">{r.index}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The pre-baked sample — the "Run this" on-ramp, instant + $0 */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">See a result in one tap</h2>
          <Button asChild size="sm" variant="ghost">
            <Link href="/backtesting/build?template=short-straddle">Tweak this strategy →</Link>
          </Button>
        </div>
        <p className="mb-3 text-xs text-muted">
          A NIFTY 9:20 short straddle over 3 months — a worked sample so you can see the result
          shape instantly. Build your own to run live in your browser.
        </p>
        <SampleResultCard run={SAMPLE_RUN} sample />
        <div className="mt-3 text-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowFullSample((v) => !v)}
            data-testid="bt-sample-full-toggle"
            aria-expanded={showFullSample}
          >
            {showFullSample ? "Hide full sample report" : "Explore the full sample report"}
          </Button>
        </div>
        {showFullSample && (
          <div className="mt-5" data-testid="bt-sample-full-report">
            <React.Suspense
              fallback={<div className="h-40 animate-pulse rounded-2xl bg-surface-2/60" />}
            >
              <RunResultReport result={SAMPLE_RUN} />
            </React.Suspense>
          </div>
        )}
      </section>

      {/* Two ways in */}
      <section className="mt-12">
        <h2 className="text-center text-lg font-semibold">Two ways to backtest</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {TWO_WAYS.map((w) => (
            <Link
              key={w.href}
              href={w.href}
              className="group rounded-2xl border bg-surface p-5 transition-colors hover:border-accent"
              onClick={() => {
                try {
                  localStorage.setItem(BT_KEYS.lastMode, w.mode);
                } catch {
                  /* ignore */
                }
              }}
            >
              <w.icon className="h-6 w-6 text-accent" aria-hidden />
              <h3 className="mt-3 text-base font-semibold">{w.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">{w.blurb}</p>
              <span className="mt-3 inline-block text-sm font-medium text-accent">{w.cta} →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Trust row */}
      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {TRUST.map((t) => (
          <div key={t.title} className="rounded-xl border bg-surface/50 p-5">
            <t.icon className="h-5 w-5 text-accent" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold">{t.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">{t.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
