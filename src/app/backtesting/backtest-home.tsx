"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Code2, Gauge, GitCompareArrows, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { buildPayoffCurve, classifyStrategy, type PayoffLeg } from "@/lib/options/payoff";
import type { PayoffSummary } from "@/features/backtest/builder/payoff-rail";
import { PayoffChart } from "@/components/backtesting/builder/payoff-chart";
import { SAMPLE_RUN } from "./sample-run";
import { SampleResultCard } from "./sample-result-card";

/**
 * A static "loaded strategy" for the live-instrument hero: a NIFTY 9:20 short
 * straddle (the same shape the Sample uses). Pure closed-form payoff math — zero
 * engine, zero data — so it renders instantly as the hero's amber curve crossing
 * the ruled zero-line at the two breakevens (the TAPE signature).
 */
const HERO_PAYOFF: PayoffSummary = (() => {
  const lot = 75;
  const legs: PayoffLeg[] = [
    { strike: 24500, optionType: "CE", direction: "short", qty: lot, premium: 132 },
    { strike: 24500, optionType: "PE", direction: "short", qty: lot, premium: 121 },
  ];
  const curve = buildPayoffCurve(legs);
  const label = classifyStrategy(
    legs.map((l) => ({
      strike: l.strike,
      optionType: l.optionType,
      direction: l.direction,
      qty: l.qty,
    }))
  );
  const netCredit = (132 + 121) * lot;
  return {
    label,
    curve,
    legs: legs.map((l, i) => ({
      legId: `hero-${i}`,
      strike: l.strike,
      premium: l.premium,
      payoff: l,
    })),
    netCredit,
    hasLegs: true,
  };
})();

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
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <PageHeader
        title="Backtesting"
        description="Backtest NIFTY, BANKNIFTY & SENSEX option ideas free, honestly, in your browser."
        actions={
          <Button asChild size="sm">
            <Link href="/backtesting/build">Build a strategy</Link>
          </Button>
        }
      />

      {/* The loaded-instrument hero — one journal card, no CTA (the page's single
          primary action lives in the header). */}
      <Card>
        <CardHeader>
          <CardTitle>NIFTY short straddle — payoff at expiry</CardTitle>
        </CardHeader>
        <CardContent>
          <PayoffChart summary={HERO_PAYOFF} className="h-44 w-full" />
          <p className="mt-2 text-sm text-muted">
            A worked example shape. Build your own to run it live on real 1-minute history.
          </p>
        </CardContent>
      </Card>

      {/* Recent runs — a plain journal section; ALWAYS visible (ghost rung empty). */}
      <section data-testid="bt-recent-rail" className="space-y-2">
        <h2 className="text-sm font-semibold">Recent runs</h2>
        <div className="flex flex-wrap gap-2">
          {returning && recent.length > 0 ? (
            recent.map((r) => (
              <Link
                key={r.id}
                href={`/backtesting/run/${r.id}`}
                className="rounded-md border bg-surface px-3 py-2.5 text-sm hover:border-accent"
              >
                <span className="font-medium">{r.label}</span>
                <span className="ml-2 text-muted">{r.index}</span>
              </Link>
            ))
          ) : (
            <Link
              href="/backtesting/build"
              className="inline-flex items-center gap-1 rounded-md border border-dashed bg-surface-2 px-3 py-2.5 text-sm text-muted hover:border-accent hover:text-foreground"
              data-testid="bt-recent-empty"
            >
              Load your first strategy <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </section>

      {/* The pre-baked sample — a journal card (instant, zero engine boot). */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Sample result</CardTitle>
          <Link
            href="/backtesting/build?template=short-straddle"
            className="text-sm font-medium text-accent hover:underline"
          >
            Tweak this →
          </Link>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">
            A NIFTY 9:20 short straddle over 3 months — a worked sample so you can see the result
            shape instantly.
          </p>
          <SampleResultCard run={SAMPLE_RUN} sample />
          <div>
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
            <div data-testid="bt-sample-full-report">
              <React.Suspense
                fallback={<div className="h-40 animate-pulse rounded-lg bg-surface-2/60" />}
              >
                <RunResultReport result={SAMPLE_RUN} />
              </React.Suspense>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bring-your-own-code — the one genuinely distinct alternate path (Build is
          already the header's primary CTA, so it isn't restated here). */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 xs:flex-row xs:items-start xs:gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15">
            <Code2 className="h-5 w-5 text-accent" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Prefer code?</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Write a JavaScript strategy and run it in a sandboxed VM in your browser, against the
              same data.
            </p>
            <Link
              href="/backtesting/code"
              onClick={() => {
                try {
                  localStorage.setItem(BT_KEYS.lastMode, "code");
                } catch {
                  /* ignore */
                }
              }}
              className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
            >
              Write a JS strategy →
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Journal-compare entry (BT-12) — the journal-first killer */}
      <Card>
        <CardContent className="pt-4">
          <Link
            href="/backtesting/compare"
            className="group flex flex-col gap-3 xs:flex-row xs:items-start xs:gap-4"
            data-testid="bt-compare-entry"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15">
              <GitCompareArrows className="h-5 w-5 text-accent" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold">Did you trade your plan?</h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Overlay your <strong>real trades</strong> on a mechanical backtest of the same idea
                and see, honestly, where your discretionary trading diverged. Read-only, on this
                device.
              </p>
              <span className="mt-2 inline-block text-sm font-medium text-accent">
                Compare with your journal →
              </span>
            </div>
          </Link>
        </CardContent>
      </Card>

      {/* Trust row */}
      <div className="grid gap-4 sm:grid-cols-3">
        {TRUST.map((t) => (
          <Card key={t.title}>
            <CardContent className="pt-4">
              <t.icon className="h-5 w-5 text-accent" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">{t.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">{t.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
