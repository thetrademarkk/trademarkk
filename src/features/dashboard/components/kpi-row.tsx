"use client";

import Link from "next/link";
import { StatCard, inrFormat } from "@/components/shared/stat-card";
import {
  avgR,
  closedOnly,
  expectancy,
  netPnl,
  profitFactor,
  winRate,
  type TradeLike,
} from "@/lib/stats/stats";
import { cn } from "@/lib/utils";

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

/**
 * The six headline KPIs. Adherence lives in its own ring card (no duplicate tile
 * here) — that's the one removed when the row was tightened.
 */
export function KpiRow({ trades }: { trades: TradeLike[] }) {
  const closed = closedOnly(trades);
  const pf = profitFactor(closed);
  const r = avgR(closed);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <KpiLink href="/app/reports">
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
    </div>
  );
}
