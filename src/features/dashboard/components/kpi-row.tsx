"use client";

import Link from "next/link";
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
import { cn } from "@/lib/utils";
import { openPositionsSummary, type OpenTradeLike } from "@/lib/stats/open-positions";
import type { DashboardEmphasis } from "@/lib/stats/horizon";

/** Wraps a KPI so it lands on the page that explains it. */
function KpiLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // h-full + stretching children keeps all KPI boxes the same height
        // even when one card carries a sub-line ("per trade").
        "block h-full rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent [&>*]:h-full",
        className
      )}
    >
      {children}
    </Link>
  );
}

export function KpiRow({
  trades,
  adherencePct,
  emphasis = "balanced",
}: {
  trades: TradeLike[];
  adherencePct?: number;
  emphasis?: DashboardEmphasis;
}) {
  const closed = closedOnly(trades);
  const pf = profitFactor(closed);
  const r = avgR(closed);
  const streak = streaks(closed).current;
  // Positional/swing traders care about live carry more than the last KPI's
  // streak: when their style leans multi-day AND positions are open, the 7th
  // tile becomes "Open positions". Intraday/balanced keeps the day-focused KPI.
  const open = openPositionsSummary(trades as OpenTradeLike[]);
  const showOpenKpi = emphasis === "positional" && open.count > 0;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <KpiLink href="/app/reports" className="col-span-2 md:col-span-1">
        <StatCard label="Net P&L" value={netPnl(closed)} format={inrFormat} tone="auto" />
      </KpiLink>
      <KpiLink href="/app/trades">
        <StatCard label="Trades" value={closed.length} format={{ maximumFractionDigits: 0 }} />
      </KpiLink>
      <KpiLink href="/app/analytics">
        <StatCard
          label="Win rate"
          value={winRate(closed) * 100}
          format={{ maximumFractionDigits: 0 }}
          suffix="%"
        />
      </KpiLink>
      <KpiLink href="/app/analytics">
        <StatCard
          label="Profit factor"
          value={Number.isFinite(pf) ? pf : 0}
          format={{ maximumFractionDigits: 2 }}
          sub={!Number.isFinite(pf) && closed.length > 0 ? "no losses yet" : undefined}
        />
      </KpiLink>
      <KpiLink href="/app/analytics">
        <StatCard
          label="Expectancy"
          value={expectancy(closed)}
          format={inrFormat}
          tone="auto"
          sub="per trade"
        />
      </KpiLink>
      <KpiLink href="/app/analytics">
        <StatCard
          label="Avg R"
          value={r ?? 0}
          format={{ maximumFractionDigits: 2 }}
          suffix="R"
          sub={r == null ? "set SLs to track R" : undefined}
        />
      </KpiLink>
      {showOpenKpi ? (
        <KpiLink href="/app/trades">
          <StatCard
            label="Open positions"
            value={open.count}
            format={{ maximumFractionDigits: 0 }}
            sub={open.maxDaysHeld > 0 ? `${open.maxDaysHeld}d longest held` : "held today"}
          />
        </KpiLink>
      ) : (
        <KpiLink href={adherencePct != null ? "/app/rules" : "/app/analytics"}>
          <StatCard
            label={adherencePct != null ? "Rule adherence" : "Streak"}
            value={adherencePct != null ? adherencePct * 100 : Math.abs(streak)}
            format={{ maximumFractionDigits: 0 }}
            suffix={adherencePct != null ? "%" : streak >= 0 ? " wins" : " losses"}
          />
        </KpiLink>
      )}
    </div>
  );
}
