"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Code2,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildPayoffCurve, classifyStrategy, type PayoffLeg } from "@/lib/options/payoff";
import type { PayoffSummary } from "@/features/backtest/builder/payoff-rail";
import { PayoffChart } from "@/components/backtesting/builder/payoff-chart";
import { CoverageSeam } from "@/components/backtesting/shared/coverage-seam";
import { BtSection } from "@/components/backtesting/shared/bt-section";
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
      "Write a JavaScript strategy and run it in a sandboxed VM in your browser, against the same data. Best if you want full control.",
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
      {/* Hero — the LIVE INSTRUMENT: a loaded strategy (amber payoff on the ruled
          grid) on the left, the pitch + CTAs on the right, sharing one baseline. */}
      <section className="grid items-end gap-6 border-b pb-8 sm:grid-cols-2">
        <div className="order-2 rounded-lg border bg-surface p-3 sm:order-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="micro-label">Loaded · NIFTY short straddle</p>
            <span className="micro-label">Payoff at expiry</span>
          </div>
          <PayoffChart summary={HERO_PAYOFF} className="h-44 w-full" />
          <CoverageSeam
            segments={[
              { kind: "real", frac: 0.72 },
              { kind: "sub", frac: 0.18 },
              { kind: "gap", frac: 0.1 },
            ]}
            className="mt-2"
            label="Illustrative data coverage"
          />
        </div>
        <div className="order-1 sm:order-2">
          <h1 className="text-balance text-3xl font-bold sm:text-[32px]">
            Backtest options strategies — free, honest, in your browser
          </h1>
          <p className="mt-3 text-pretty text-sm leading-6 text-muted sm:text-base">
            Test a NIFTY, BANKNIFTY or SENSEX idea against real 1-minute history. Build with no code
            or bring your own. See a beautiful result that&apos;s honest about exactly what data
            existed — and sign in only when you want to keep it.
          </p>
          <div className="mt-6 flex flex-col gap-2 xs:flex-row">
            <Button asChild size="lg" className="w-full xs:w-auto">
              <Link href="/backtesting/build">Build a strategy — free, no signup</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full xs:w-auto">
              <Link href="/backtesting/explore">Explore strategies</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Recent-runs rail — ALWAYS visible (never silently hides); a ruled strip
          with a left amber tick, and a ghost "load your first" rung when empty. */}
      <section className="mt-10" data-testid="bt-recent-rail">
        <p className="micro-label">Recent runs</p>
        <div className="mt-2 flex flex-wrap gap-2 border-l-2 border-accent pl-3">
          {returning && recent.length > 0 ? (
            recent.map((r) => (
              <Link
                key={r.id}
                href={`/backtesting/run/${r.id}`}
                className="rounded border bg-surface px-3 py-2 text-xs hover:border-accent"
              >
                <span className="font-medium">{r.label}</span>
                <span className="ml-2 text-muted">{r.index}</span>
              </Link>
            ))
          ) : (
            <Link
              href="/backtesting/build"
              className="inline-flex items-center gap-1 rounded border border-dashed bg-surface-2 px-3 py-2 text-xs text-muted hover:border-accent hover:text-foreground"
              data-testid="bt-recent-empty"
            >
              Load your first strategy <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </section>

      {/* The pre-baked sample — the "Run this" on-ramp, instant + $0 */}
      <BtSection
        number="01"
        eyebrow="Sample result"
        className="mt-10"
        action={
          <Button asChild size="sm" variant="ghost">
            <Link href="/backtesting/build?template=short-straddle">Tweak this strategy →</Link>
          </Button>
        }
      >
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
              fallback={<div className="h-40 animate-pulse rounded-lg bg-surface-2/60" />}
            >
              <RunResultReport result={SAMPLE_RUN} />
            </React.Suspense>
          </div>
        )}
      </BtSection>

      {/* Two ways in */}
      <section className="mt-12">
        <h2 className="text-center text-lg font-semibold">Two ways to backtest</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {TWO_WAYS.map((w) => (
            <Link
              key={w.href}
              href={w.href}
              className="group rounded-lg border bg-surface p-5 transition-colors hover:border-accent"
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
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent group-hover:underline">
                {w.cta}{" "}
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Journal-compare entry (BT-12) — the journal-first killer */}
      <section className="mt-12">
        <Link
          href="/backtesting/compare"
          className="group flex flex-col gap-3 rounded-lg border bg-surface p-5 transition-colors hover:border-accent xs:flex-row xs:items-start xs:gap-4"
          data-testid="bt-compare-entry"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15">
            <GitCompareArrows className="h-5 w-5 text-accent" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Did you trade your plan?</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Already journaling your trades? Overlay your <strong>real trades</strong> on a
              mechanical backtest of the same idea and see, honestly, where your discretionary
              trading diverged. Runs on your own journal — read-only, on this device.
            </p>
            <span className="mt-2 inline-block text-sm font-medium text-accent">
              Compare with your journal →
            </span>
          </div>
        </Link>
      </section>

      {/* Trust row */}
      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {TRUST.map((t) => (
          <div key={t.title} className="rounded-lg border bg-surface p-5">
            <t.icon className="h-5 w-5 text-accent" aria-hidden />
            <h3 className="mt-3 text-sm font-semibold">{t.title}</h3>
            <p className="mt-1.5 text-sm leading-6 text-muted">{t.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
