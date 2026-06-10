"use client";

import { StatCard, inrFormat } from "@/components/shared/stat-card";
import {
  avgR,
  closedOnly,
  expectancy,
  netPnl,
  profitFactor,
  streaks,
  winRate,
  type TradeLike,
} from "@/lib/stats/stats";

export function KpiRow({ trades, adherencePct }: { trades: TradeLike[]; adherencePct?: number }) {
  const closed = closedOnly(trades);
  const pf = profitFactor(closed);
  const r = avgR(closed);
  const streak = streaks(closed).current;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <StatCard label="Net P&L" value={netPnl(closed)} format={inrFormat} tone="auto" className="col-span-2 md:col-span-1" />
      <StatCard label="Trades" value={closed.length} format={{ maximumFractionDigits: 0 }} />
      <StatCard label="Win rate" value={winRate(closed) * 100} format={{ maximumFractionDigits: 0 }} suffix="%" />
      <StatCard
        label="Profit factor"
        value={Number.isFinite(pf) ? pf : 0}
        format={{ maximumFractionDigits: 2 }}
        sub={!Number.isFinite(pf) && closed.length > 0 ? "no losses yet" : undefined}
      />
      <StatCard label="Expectancy" value={expectancy(closed)} format={inrFormat} tone="auto" sub="per trade" />
      <StatCard label="Avg R" value={r ?? 0} format={{ maximumFractionDigits: 2 }} suffix="R" sub={r == null ? "set SLs to track R" : undefined} />
      <StatCard
        label={adherencePct != null ? "Rule adherence" : "Streak"}
        value={adherencePct != null ? adherencePct * 100 : Math.abs(streak)}
        format={{ maximumFractionDigits: 0 }}
        suffix={adherencePct != null ? "%" : streak >= 0 ? " wins" : " losses"}
      />
    </div>
  );
}
