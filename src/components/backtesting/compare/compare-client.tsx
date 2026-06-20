"use client";

import * as React from "react";
import Link from "next/link";
import { GitCompareArrows, Loader2, Lock, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDbSession } from "@/providers/db-session-provider";
import { useTrades, useAllLegs } from "@/features/trades/queries";
import { runBacktest } from "@/lib/backtest/engine/engine";
import { FixtureDataSource } from "@/lib/backtest/engine/adapters/fixture-source";
import { loadGoldenSnapshot } from "@/lib/backtest/__fixtures__/golden-loader";
import { makeDefaultStrategy, type StrategyDef } from "@/features/backtest/shared/strategy-def";
import type { RunResult } from "@/features/backtest/shared/run-result";
import {
  compareJournalToBacktest,
  type JournalCompareResult,
} from "@/features/backtest/journal-compare/compare";
import {
  normalizeJournalTrades,
  type JournalLegInput,
  type JournalTradeInput,
} from "@/features/backtest/journal-compare/adapter";
import { JournalCompareView } from "./journal-compare-view";

/**
 * The canonical MECHANICAL BASELINE: a NIFTY 9:20 short straddle squared off at
 * 15:15, run against the committed golden slice. This is the "rules-only version
 * of the idea" the user's discretionary NIFTY trading is mirrored against. Until
 * BT-08 (the HF data layer) lands, the golden slice is the only real data we
 * have, so the baseline is honestly scoped to that window.
 */
function buildMechanicalBaseline(): RunResult {
  const base = makeDefaultStrategy("journal-compare-baseline", "NIFTY");
  const snapshot = loadGoldenSnapshot();
  const days = snapshot.days.map((d) => d.day).sort();
  const strat: StrategyDef = {
    ...base,
    name: "Mechanical baseline — NIFTY 9:20 short straddle",
    market: {
      symbol: "NIFTY",
      interval: "1m",
      dateRange: { start: days[0]!, end: days[days.length - 1]! },
    },
    timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    legs: [
      {
        id: "ce",
        enabled: true,
        optionType: "CE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
      {
        id: "pe",
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
      },
    ],
  };
  return runBacktest(strat, new FixtureDataSource(snapshot), { ranAt: 0 });
}

/**
 * BT-12 journal-compare CLIENT. Opt-in: nothing about the user's trades is read
 * or shown until they explicitly press "Run comparison". The journal is read
 * ONLY through the existing query layer (`useTrades` / `useAllLegs`) — this
 * component never writes journal data and never touches the journal entry UI.
 *
 * Honest about its data: the mechanical baseline runs on the committed golden
 * NIFTY window, so only a user's NIFTY trades that overlap it are comparable. All
 * other cases resolve to a descriptive, non-blaming honest state.
 */
export function CompareClient() {
  const { state } = useDbSession();

  if (state.status === "loading") {
    return (
      <StateCard icon={Loader2} spin title="Connecting to your journal…">
        Reading your saved trades to set up the comparison.
      </StateCard>
    );
  }

  if (state.status === "none") {
    return (
      <StateCard icon={ScrollText} title="No journal connected on this device">
        <p>
          This compares your <strong>real journaled trades</strong> against a mechanical baseline,
          so it needs your journal. Open the journal once on this device — try the demo, your own
          browser-local journal, or sign in — then come back.
        </p>
        <Button asChild size="sm" className="mt-3 font-mono uppercase tracking-wide">
          <Link href="/app">Open the journal</Link>
        </Button>
      </StateCard>
    );
  }

  if (state.status === "locked") {
    return (
      <StateCard icon={Lock} title="Your journal is locked">
        Unlock your encrypted journal in the app first, then return to run a comparison.
        <Button
          asChild
          size="sm"
          variant="outline"
          className="mt-3 font-mono uppercase tracking-wide"
        >
          <Link href="/app">Unlock the journal</Link>
        </Button>
      </StateCard>
    );
  }

  if (state.status === "error") {
    return (
      <StateCard icon={ScrollText} title="Couldn't reach your journal">
        {state.message}
      </StateCard>
    );
  }

  // state.status === "ready" — safe to read trades via the existing query layer.
  return <CompareReady />;
}

/** Reads journal trades (read-only) and runs the comparison on explicit opt-in. */
function CompareReady() {
  const trades = useTrades();
  const legs = useAllLegs();
  const [result, setResult] = React.useState<JournalCompareResult | null>(null);
  const [running, setRunning] = React.useState(false);

  const loading = trades.isLoading || legs.isLoading;
  const tradeCount = trades.data?.length ?? 0;

  const runComparison = React.useCallback(() => {
    if (!trades.data) return;
    setRunning(true);
    // Defer a tick so the button shows its busy state before the sync engine run.
    setTimeout(() => {
      const inputs = trades.data as unknown as JournalTradeInput[];
      const legMap = (legs.data ?? new Map()) as Map<string, JournalLegInput[]>;
      const normalized = normalizeJournalTrades(inputs, legMap);
      const baseline = buildMechanicalBaseline();
      setResult(compareJournalToBacktest(normalized, baseline));
      setRunning(false);
    }, 0);
  }, [trades.data, legs.data]);

  return (
    <div className="space-y-5">
      {/* Opt-in control — nothing is computed until the user asks. */}
      <section className="bt-panel bt-ticks p-4 sm:p-5 bt-boot bt-boot-1">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-[var(--bt-amber-dim)]">
            <GitCompareArrows className="h-5 w-5 text-accent" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="bt-label text-accent">
              <span className="bt-prompt">journal compare</span>
            </p>
            <h2 className="bt-display mt-1 text-base font-semibold">Did you trade your plan?</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Overlay your real NIFTY journal trades on a mechanical baseline of the same idea — a
              9:20 short straddle squared off at close — and see exactly where your discretionary
              trading diverged. This reads your journal <strong>on this device only</strong> and
              never changes it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                onClick={runComparison}
                disabled={loading || running || tradeCount === 0}
                data-testid="bt-compare-run"
                className="font-mono uppercase tracking-wide"
              >
                {running ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
                )}
                Run comparison
              </Button>
              <span className="bt-label">
                {loading
                  ? "Loading your trades…"
                  : `${tradeCount} trade${tradeCount === 1 ? "" : "s"} in your journal`}
              </span>
            </div>
            {running && <div className="bt-scanline mt-3 h-0.5 rounded bg-border" aria-hidden />}
          </div>
        </div>
      </section>

      {result && <CompareOutcome result={result} />}
    </div>
  );
}

function CompareOutcome({ result }: { result: JournalCompareResult }) {
  if (result.ok) return <JournalCompareView compare={result.compare} />;

  switch (result.reason) {
    case "no-journal-trades":
      return (
        <StateCard icon={ScrollText} title="No closed trades to compare yet">
          Once you&rsquo;ve journaled and closed a few trades, run this again to see how your real
          trading lines up against the mechanical baseline.
        </StateCard>
      );
    case "no-comparable-instrument":
      return (
        <StateCard
          icon={GitCompareArrows}
          title="No comparable backtest data"
          testId="bt-compare-nodata"
        >
          <p>
            The mechanical baseline covers <strong>NIFTY</strong>, but none of your closed trades
            are on NIFTY (or its index family). There&rsquo;s nothing to compare honestly — we
            won&rsquo;t invent a baseline for an instrument we don&rsquo;t have data for.
          </p>
        </StateCard>
      );
    case "no-backtest":
      return (
        <StateCard icon={GitCompareArrows} title="No baseline available">
          The mechanical baseline couldn&rsquo;t be produced right now. Try again shortly.
        </StateCard>
      );
    case "no-date-overlap":
      return (
        <StateCard icon={GitCompareArrows} title="No overlapping dates" testId="bt-compare-nodata">
          <p>
            You have {result.comparableTrades} NIFTY trade
            {result.comparableTrades === 1 ? "" : "s"}, but none fall inside the baseline&rsquo;s
            date window, so there&rsquo;s no honest overlap to compare. When the live data layer
            extends the baseline to your trading dates, this will fill in.
          </p>
        </StateCard>
      );
  }
}

function StateCard({
  icon: Icon,
  title,
  children,
  spin,
  testId,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children: React.ReactNode;
  spin?: boolean;
  testId?: string;
}) {
  return (
    <div
      className="bt-panel bt-boot bt-boot-1 p-6 text-center"
      data-testid={testId ?? "bt-compare-state"}
    >
      <Icon
        className={`mx-auto mb-3 h-8 w-8 text-muted${spin ? " animate-spin" : ""}`}
        aria-hidden
      />
      <h2 className="bt-display text-base font-semibold">{title}</h2>
      <div className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-muted">{children}</div>
    </div>
  );
}
