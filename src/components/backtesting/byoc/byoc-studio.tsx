"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Play, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatNumber } from "@/lib/utils";
import { useByoc } from "@/features/backtest/byoc/use-byoc";
import type { Sym } from "@/lib/backtest/data/schema";

const SYMBOLS: Sym[] = ["NIFTY", "BANKNIFTY", "SENSEX"];

/** A real, runnable starter: a fast/slow SMA crossover (long-only). */
const STARTER = `// strategy(bars, ta) → return an array of trades.
// bars[i] = { t, o, h, l, c, v }   (your chosen interval, IST)
// ta = { closes, sma, ema, rsi, atr, highest, lowest, stdev, crossover, crossunder }
// Each trade: { entryIndex, exitIndex, side: "long" | "short" }
// P&L is the signed close-to-close move from entryIndex → exitIndex.

function strategy(bars, ta) {
  const c = ta.closes(bars);
  const fast = ta.sma(c, 9);
  const slow = ta.sma(c, 21);
  const trades = [];
  let entry = -1;

  for (let i = 0; i < bars.length; i++) {
    if (entry < 0 && ta.crossover(fast, slow, i)) {
      entry = i; // go long on a golden cross
    } else if (entry >= 0 && ta.crossunder(fast, slow, i)) {
      trades.push({ entryIndex: entry, exitIndex: i, side: "long" });
      entry = -1; // flat on a death cross
    }
  }
  return trades;
}`;

export function ByocStudio() {
  const { status, result, error, barCount, run } = useByoc();
  const [code, setCode] = React.useState(STARTER);
  const [symbol, setSymbol] = React.useState<Sym>("NIFTY");
  const [from, setFrom] = React.useState("2026-02-02");
  const [to, setTo] = React.useState("2026-02-27");
  const [interval, setInterval] = React.useState("5m");

  const busy = status === "loading-data" || status === "running";
  const onRun = () => run(code, { symbol, from, to, interval });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Bring your own code</h1>
          <p className="mt-1 text-sm text-muted">
            Write a JavaScript strategy and run it in your browser against real 1-minute data.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/backtesting">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs leading-5 text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>
          Your code runs inside a sandboxed JavaScript VM (QuickJS-WASM) — it has{" "}
          <span className="font-medium text-foreground">no network, DOM or filesystem access</span>,
          a memory cap and a time budget. This is a spot-series backtest (signed close-to-close
          returns; charges &amp; slippage are not modelled yet) — read it as educational.
        </span>
      </p>

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="text-muted">Underlying</span>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value as Sym)}
            className="mt-1 block h-9 rounded-md border bg-surface px-2 text-sm"
            data-testid="byoc-symbol"
          >
            {SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="text-muted">From</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-40"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted">To</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-40"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted">Interval</span>
          <Input
            type="text"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            placeholder="5m"
            className="mt-1 w-20"
            data-testid="byoc-interval"
          />
        </label>
        <Button type="button" onClick={onRun} disabled={busy} data-testid="byoc-run">
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              {status === "loading-data" ? "Loading data…" : "Running…"}
            </>
          ) : (
            <>
              <Play aria-hidden /> Run
            </>
          )}
        </Button>
      </div>

      {/* Editor */}
      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        spellCheck={false}
        rows={18}
        data-testid="byoc-code"
        className="mt-4 w-full rounded-xl border bg-surface/60 p-3 font-mono text-[12.5px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />

      {/* Status / results */}
      <div className="mt-4" data-testid="byoc-result" data-status={status}>
        {status === "error" && (
          <div className="flex items-start gap-2 rounded-lg border border-loss/40 bg-loss/5 p-3 text-sm text-loss">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}
        {status === "done" && result?.ok && <ByocResultView result={result} barCount={barCount} />}
        {result && result.logs.length > 0 && (
          <details className="mt-3 rounded-lg border bg-surface/40 p-2 text-xs">
            <summary className="cursor-pointer text-muted">
              console.log ({result.logs.length})
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
              {result.logs.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

function ByocResultView({
  result,
  barCount,
}: {
  result: Extract<ReturnType<typeof useByoc>["result"], { ok: true }>;
  barCount: number;
}) {
  const s = result.stats;
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const tone = (x: number) => (x > 0 ? "text-profit" : x < 0 ? "text-loss" : "text-foreground");
  return (
    <div className="space-y-4" data-testid="byoc-done">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total return" value={pct(s.totalReturn)} className={tone(s.totalReturn)} />
        <Stat label="Win rate" value={pct(s.winRate)} />
        <Stat label="Trades" value={formatNumber(s.trades, 0)} />
        <Stat label="Max DD" value={pct(s.maxDrawdown)} className="text-loss" />
        <Stat label="Expectancy / trade" value={pct(s.expectancy)} className={tone(s.expectancy)} />
        <Stat label="Best / worst" value={`${pct(s.bestReturn)} / ${pct(s.worstReturn)}`} />
      </div>
      <EquityCurve equity={s.equity} />
      <p className="text-[11px] text-muted">
        Ran over {formatNumber(barCount, 0)} candles in {result.elapsedMs}ms.
      </p>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border bg-surface/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-0.5 font-money text-sm font-semibold tabular-nums", className)}>
        {value}
      </div>
    </div>
  );
}

/** A tiny inline equity-curve sparkline (semantic tokens, no chart dep). */
function EquityCurve({ equity }: { equity: number[] }) {
  if (equity.length < 2) {
    return <p className="text-xs text-muted">Not enough trades to draw an equity curve.</p>;
  }
  const W = 600;
  const H = 90;
  const min = Math.min(1, ...equity);
  const max = Math.max(1, ...equity);
  const range = max - min || 1;
  const pts = equity
    .map((e, i) => {
      const x = (i / (equity.length - 1)) * W;
      const y = H - ((e - min) / range) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = equity[equity.length - 1]! >= 1;
  return (
    <div className="rounded-lg border bg-surface/40 p-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
        Equity (×, starts at 1)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className={up ? "text-profit" : "text-loss"}
        />
      </svg>
    </div>
  );
}
