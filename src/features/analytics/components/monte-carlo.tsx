"use client";

import { useEffect, useMemo, useState } from "react";
import { Dices, ShieldAlert, TrendingDown, Target, Play, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber, formatPct, cn } from "@/lib/utils";
import {
  MIN_TRADES,
  extractRSamples,
  estimateTradesPerYear,
  type ConeBand,
  type SimResult,
} from "@/lib/montecarlo/simulate";
import type { TradeLike } from "@/lib/stats/stats";
import { useMonteCarlo } from "../hooks/use-monte-carlo";
import { EquityCone } from "./equity-cone";

const PATHS = 10_000; // N ≥ 10k simulated sequences, per spec.
const RUIN_FLOOR_OPTIONS = [
  { value: "0.9", label: "−10% (down 10%)" },
  { value: "0.8", label: "−20% (down 20%)" },
  { value: "0.7", label: "−30% (down 30%)" },
  { value: "0.5", label: "−50% (halved)" },
  { value: "0.25", label: "−75%" },
];

/**
 * Monte-Carlo equity simulator. Bootstraps the trader's own per-trade R
 * distribution into 10k future-trade sequences and renders a p5/p50/p95 equity
 * cone plus risk-of-ruin, max-drawdown and net-positive odds. Runs in a Web
 * Worker (seeded PRNG ⇒ reproducible). Gated behind MIN_TRADES R-bearing
 * closed trades — small samples make the cone meaningless.
 */
export function MonteCarlo({ trades }: { trades: TradeLike[] }) {
  const rSamples = useMemo(() => extractRSamples(trades), [trades]);
  const n = rSamples.length;
  const enough = n >= MIN_TRADES;

  if (!enough) {
    return (
      <Card data-testid="mc-gate">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dices className="size-4 text-muted" aria-hidden />
            Monte Carlo simulator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted">
            Not enough data yet. The simulator needs at least {MIN_TRADES} closed trades with a
            defined risk (R-multiple) to project a meaningful equity cone — you have {n}. Add stop
            losses to your trades so each one carries an R value.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <MonteCarloReady rSamples={rSamples} trades={trades} />;
}

function MonteCarloReady({ rSamples, trades }: { rSamples: number[]; trades: TradeLike[] }) {
  const defaultHorizon = useMemo(() => estimateTradesPerYear(trades), [trades]);
  const [horizon, setHorizon] = useState(defaultHorizon);
  const [floor, setFloor] = useState("0.5");
  // A fixed seed makes the run reproducible; "Re-roll" advances it explicitly.
  const [seed, setSeed] = useState(20260613);
  const { status, result, run } = useMonteCarlo();

  const horizonClamped = Math.max(MIN_TRADES, Math.min(2000, Math.round(horizon) || MIN_TRADES));

  const launch = (nextSeed = seed) => {
    run({
      rSamples,
      trades: horizonClamped,
      paths: PATHS,
      startEquityR: 100,
      ruinFloorFraction: Number(floor),
      seed: nextSeed,
    });
  };

  // Auto-run once on mount and whenever the inputs change, so the cone is
  // always live without making the user hunt for a button.
  useEffect(() => {
    launch(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizonClamped, floor, seed, rSamples]);

  const winRate = useMemo(() => rSamples.filter((r) => r > 0).length / rSamples.length, [rSamples]);
  const avgR = useMemo(() => rSamples.reduce((s, r) => s + r, 0) / rSamples.length, [rSamples]);

  return (
    <div className="space-y-4" data-testid="mc-ready">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Dices className="size-4 text-muted" aria-hidden />
            Monte Carlo simulator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">
            {PATHS.toLocaleString("en-IN")} simulated futures, each bootstrapped from your{" "}
            {rSamples.length} R-bearing trades ({formatPct(winRate, 0)} win, {formatNumber(avgR, 2)}
            R avg). Equity is shown in <strong>R</strong> (risk units), starting at 100R.
          </p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="mc-horizon">Future trades</Label>
              <Input
                id="mc-horizon"
                type="number"
                min={MIN_TRADES}
                max={2000}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                data-testid="mc-horizon"
              />
              <p className="text-[11px] text-muted">≈ your trades / year</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mc-floor">Ruin floor</Label>
              <Select value={floor} onValueChange={setFloor}>
                <SelectTrigger id="mc-floor" data-testid="mc-floor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RUIN_FLOOR_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted">drawdown that counts as ruin</p>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setSeed((s) => s + 1)}
                disabled={status === "running"}
                data-testid="mc-reroll"
              >
                {status === "running" ? (
                  <>
                    <Play className="animate-pulse" aria-hidden /> Simulating…
                  </>
                ) : (
                  <>
                    <RotateCcw aria-hidden /> Re-roll
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {status === "error" ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-loss">
              The simulation failed to run. Try a smaller horizon.
            </p>
          </CardContent>
        </Card>
      ) : !result ? (
        <Skeleton className="h-72" />
      ) : (
        <ResultPanel result={result} floorLabel={floorLabel(floor)} />
      )}
    </div>
  );
}

function floorLabel(floor: string): string {
  return RUIN_FLOOR_OPTIONS.find((o) => o.value === floor)?.label ?? floor;
}

function ResultPanel({ result, floorLabel }: { result: SimResult; floorLabel: string }) {
  const { riskOfRuin, probNetPositive, medianMaxDrawdown, worstMaxDrawdown } = result;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="mc-stats">
        <StatTile
          icon={ShieldAlert}
          label="Risk of ruin"
          value={formatPct(riskOfRuin, riskOfRuin < 0.01 && riskOfRuin > 0 ? 2 : 1)}
          sub={`paths breaching ${floorLabel}`}
          tone={riskOfRuin > 0.2 ? "loss" : riskOfRuin > 0.05 ? "warn" : "profit"}
          dataKey="risk-of-ruin"
        />
        <StatTile
          icon={Target}
          label="End net-positive"
          value={formatPct(probNetPositive, 1)}
          sub="paths finishing above start"
          tone={probNetPositive >= 0.5 ? "profit" : "loss"}
          dataKey="net-positive"
        />
        <StatTile
          icon={TrendingDown}
          label="Median max drawdown"
          value={`${formatNumber(medianMaxDrawdown, 1)}R`}
          sub="typical worst dip"
          tone="neutral"
          dataKey="median-drawdown"
        />
        <StatTile
          icon={TrendingDown}
          label="Worst max drawdown"
          value={`${formatNumber(worstMaxDrawdown, 1)}R`}
          sub="p95 across paths"
          tone="warn"
          dataKey="worst-drawdown"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equity cone</CardTitle>
        </CardHeader>
        <CardContent>
          <EquityCone cone={result.cone} startEquity={result.meta.startEquityR} />
          <ConeLegend cone={result.cone} />
        </CardContent>
      </Card>
    </>
  );
}

function ConeLegend({ cone }: { cone: ConeBand[] }) {
  const last = cone[cone.length - 1]!;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
      <LegendItem label="Pessimistic (p5)" value={`${formatNumber(last.p5, 1)}R`} tone="loss" />
      <LegendItem label="Median (p50)" value={`${formatNumber(last.p50, 1)}R`} tone="neutral" />
      <LegendItem label="Optimistic (p95)" value={`${formatNumber(last.p95, 1)}R`} tone="profit" />
    </div>
  );
}

function LegendItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "loss" | "neutral" | "profit";
}) {
  return (
    <div className="rounded-md border px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          "font-money text-sm tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  dataKey,
}: {
  icon: typeof ShieldAlert;
  label: string;
  value: string;
  sub: string;
  tone: "profit" | "loss" | "warn" | "neutral";
  dataKey: string;
}) {
  return (
    <Card data-mc-stat={dataKey}>
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Icon className="size-4" aria-hidden />
          {label}
        </div>
        <div
          className={cn(
            "font-money text-2xl tabular-nums",
            tone === "profit" && "text-profit",
            tone === "loss" && "text-loss",
            tone === "warn" && "text-warning"
          )}
        >
          {value}
        </div>
        <div className="text-[11px] text-muted">{sub}</div>
      </CardContent>
    </Card>
  );
}
