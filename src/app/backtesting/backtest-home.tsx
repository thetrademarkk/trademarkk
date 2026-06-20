"use client";

import * as React from "react";
import Link from "next/link";
import { Code2, FlaskConical, GitCompareArrows, ShieldCheck, Terminal } from "lucide-react";
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

/** Honest system-status readout — real facts about the dataset, never P&L. */
const STATUS: { k: string; v: string; sub?: string }[] = [
  { k: "Instruments", v: "03", sub: "NIFTY · BANKNIFTY · SENSEX" },
  { k: "Resolution", v: "1m", sub: "1-minute candles" },
  { k: "History", v: "2021", sub: "→ present" },
  { k: "Charges", v: "ON", sub: "real brokerage modelled" },
];

const TWO_WAYS = [
  {
    href: "/backtesting/build",
    mode: "nocode",
    icon: FlaskConical,
    tag: "no-code",
    title: "Strategy Builder",
    blurb:
      "Pick an index, add legs, set risk and indicators — a guided ticket with a live payoff. Best for most traders.",
    cta: "Build a strategy",
  },
  {
    href: "/backtesting/code",
    mode: "code",
    icon: Code2,
    tag: "javascript",
    title: "Bring Your Own Code",
    blurb:
      "Write a JavaScript strategy and run it in a sandboxed VM in your browser, against the same data. Full control.",
    cta: "Write code",
  },
] as const;

const TRUST = [
  {
    icon: ShieldCheck,
    title: "Honest about data",
    text: "Option history is patchy. Coverage and nearest-strike substitution are shown before, during and after a run — never a fabricated curve.",
  },
  {
    icon: Terminal,
    title: "Free & in your browser",
    text: "Runs entirely client-side on your machine. No account to build or run — sign in only to save or share.",
  },
  {
    icon: FlaskConical,
    title: "Real microstructure",
    text: "1-minute index + option chains, weekly & monthly expiries, Indian brokerage and charges modelled into every fill.",
  },
] as const;

/**
 * Landing client shell — rebuilt in the "Terminal" instrument-grade aesthetic.
 * First-time visitors get the boot-sequence hero + an honest system readout +
 * the two entry modes + a PRE-BAKED static sample (instant, $0, zero WASM) + a
 * trust spec-sheet. Returning visitors with runs see a compact recent-runs rail.
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
    <div className="mx-auto max-w-5xl px-4 py-7 sm:py-10">
      {/* ── Hero: a framed terminal window ───────────────────────────── */}
      <section className="bt-boot bt-boot-1">
        <div className="bt-panel bt-ticks overflow-hidden">
          {/* Titlebar */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="flex items-center gap-2.5">
              <span className="flex gap-1" aria-hidden>
                <span className="h-2 w-2 rounded-full bg-loss/70" />
                <span className="h-2 w-2 rounded-full bg-warning/70" />
                <span className="h-2 w-2 rounded-full bg-profit/70" />
              </span>
              <span className="bt-label">tmk://backtest.engine</span>
            </span>
            <span className="bt-label flex items-center gap-1.5 text-profit">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-profit" aria-hidden />
              live · 1m
            </span>
          </div>

          {/* Body */}
          <div className="px-5 py-8 sm:px-9 sm:py-12">
            <p className="bt-label text-accent">
              <span className="bt-prompt">backtest engine — options, honestly</span>
            </p>
            <h1 className="bt-display mt-4 text-pretty text-3xl font-semibold leading-[1.07] sm:text-5xl">
              Test an idea against <span className="bt-glow-text">real 1-minute</span> history
              <span className="bt-caret" aria-hidden />
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              NIFTY, BANKNIFTY &amp; SENSEX option strategies — free, in your browser, and honest
              about exactly what data existed. Sign in only when you want to keep a run.
            </p>

            {/* Honest system readout */}
            <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-4">
              {STATUS.map((s) => (
                <div key={s.k} className="bg-surface px-3.5 py-3">
                  <dt className="bt-label">{s.k}</dt>
                  <dd className="bt-num mt-1.5 text-2xl text-foreground">{s.v}</dd>
                  {s.sub && <dd className="mt-1 text-[11px] leading-tight text-muted">{s.sub}</dd>}
                </div>
              ))}
            </dl>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="font-mono uppercase tracking-wide">
                <Link href="/backtesting/build">Build a strategy</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="font-mono uppercase tracking-wide"
              >
                <Link href="/backtesting/explore">Explore</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent runs rail (returning visitors) ────────────────────── */}
      {returning && recent.length > 0 && (
        <section className="mt-8 bt-boot bt-boot-2">
          <h2 className="bt-label mb-2.5">Recent runs</h2>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <Link
                key={r.id}
                href={`/backtesting/run/${r.id}`}
                className="bt-panel flex items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:border-accent"
              >
                <span className="font-medium">{r.label}</span>
                <span className="bt-chip">{r.index}</span>
                <span className={`bt-num ${r.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {r.pnl >= 0 ? "+" : ""}
                  {Math.round(r.pnl).toLocaleString("en-IN")}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── The pre-baked sample — instant, $0, zero WASM ────────────── */}
      <section className="mt-10 bt-boot bt-boot-3">
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 className="bt-label text-accent">
              <span className="bt-prompt">sample readout</span>
            </h2>
            <p className="mt-1 text-xs text-muted">
              NIFTY 09:20 short straddle, 3 months — a worked result so you see the shape instantly.
            </p>
          </div>
          <Button asChild size="sm" variant="ghost" className="shrink-0 font-mono text-xs">
            <Link href="/backtesting/build?template=short-straddle">Tweak →</Link>
          </Button>
        </div>
        <SampleResultCard run={SAMPLE_RUN} sample />
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setShowFullSample((v) => !v)}
            data-testid="bt-sample-full-toggle"
            aria-expanded={showFullSample}
            className="bt-bracket text-xs"
          >
            {showFullSample ? "collapse report" : "open full report"}
          </button>
        </div>
        {showFullSample && (
          <div className="mt-5" data-testid="bt-sample-full-report">
            <React.Suspense
              fallback={<div className="h-40 animate-pulse rounded bg-surface-2/60" />}
            >
              <RunResultReport result={SAMPLE_RUN} />
            </React.Suspense>
          </div>
        )}
      </section>

      {/* ── Two ways in ──────────────────────────────────────────────── */}
      <section className="mt-12 bt-boot bt-boot-4">
        <h2 className="bt-label mb-4">Two ways to backtest</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TWO_WAYS.map((w) => (
            <Link
              key={w.href}
              href={w.href}
              className="bt-panel bt-ticks group p-5 transition-colors hover:border-accent hover:[box-shadow:0_0_28px_-14px_var(--bt-glow)]"
              onClick={() => {
                try {
                  localStorage.setItem(BT_KEYS.lastMode, w.mode);
                } catch {
                  /* ignore */
                }
              }}
            >
              <div className="flex items-center justify-between">
                <w.icon className="h-6 w-6 text-accent" aria-hidden />
                <span className="bt-chip" data-tone="accent">
                  {w.tag}
                </span>
              </div>
              <h3 className="bt-display mt-4 text-lg font-semibold">{w.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">{w.blurb}</p>
              <span className="bt-bracket mt-4 inline-block text-xs">{w.cta}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Journal-compare entry (BT-12) ────────────────────────────── */}
      <section className="mt-8 bt-boot bt-boot-5">
        <Link
          href="/backtesting/compare"
          className="bt-panel group flex items-start gap-4 p-5 transition-colors hover:border-accent"
          data-testid="bt-compare-entry"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-accent/40 bg-[var(--bt-amber-dim)]">
            <GitCompareArrows className="h-5 w-5 text-accent" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="bt-display text-base font-semibold">Did you trade your plan?</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Overlay your <strong className="text-foreground">real journal trades</strong> on a
              mechanical backtest of the same idea and see, honestly, where discretion diverged.
              Runs on your own journal — read-only, on this device.
            </p>
            <span className="bt-bracket mt-2 inline-block text-xs">Compare with journal</span>
          </div>
        </Link>
      </section>

      {/* ── Trust spec-sheet ─────────────────────────────────────────── */}
      <section className="mt-8 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-3 bt-boot bt-boot-6">
        {TRUST.map((t) => (
          <div key={t.title} className="bg-surface p-5">
            <t.icon className="h-5 w-5 text-accent" aria-hidden />
            <h3 className="bt-display mt-3 text-sm font-semibold">{t.title}</h3>
            <p className="mt-1.5 text-[13px] leading-6 text-muted">{t.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
