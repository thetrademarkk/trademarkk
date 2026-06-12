import {
  ArrowLeftRight,
  Boxes,
  CalendarDays,
  Clock3,
  CloudLightning,
  Flame,
  Gauge,
  Receipt,
  Scale,
  ShieldAlert,
  Sunset,
  Timer,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PnlText } from "@/components/shared/pnl-text";
import { cn } from "@/lib/utils";
import type { Insight, InsightId, InsightSeverity } from "../compute";

const ICONS: Record<InsightId, LucideIcon> = {
  "rule-break": ShieldAlert,
  payoff: Scale,
  "day-of-week": CalendarDays,
  "hour-of-day": Clock3,
  revenge: Flame,
  "long-short": ArrowLeftRight,
  instruments: Boxes,
  streaks: Zap,
  "fee-drag": Receipt,
  "tilt-sizing": Gauge,
  "tilt-pace": Timer,
  "tilt-fade": Sunset,
  "tilt-burst": CloudLightning,
};

const TINTS: Record<InsightSeverity, { card: string; icon: string }> = {
  positive: { card: "border-profit/30 bg-profit/5", icon: "text-profit" },
  negative: { card: "border-loss/30 bg-loss/5", icon: "text-loss" },
  neutral: { card: "", icon: "text-muted" },
};

export function InsightCard({ insight }: { insight: Insight }) {
  const Icon = ICONS[insight.id];
  const tint = TINTS[insight.severity];
  return (
    <article
      data-insight={insight.id}
      data-severity={insight.severity}
      className={cn("rounded-xl border bg-surface p-4", tint.card)}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", tint.icon)} aria-hidden />
        <h3 className="text-sm font-semibold">{insight.title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed">{insight.sentence}</p>
      {insight.figures.length > 0 && (
        <dl className="mt-3 space-y-1.5 border-t pt-3">
          {insight.figures.map((f) => (
            <div key={f.label} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="min-w-0 truncate text-muted">{f.label}</dt>
              <dd className="shrink-0">
                {f.amount != null ? (
                  <PnlText value={f.amount} className="text-xs" />
                ) : (
                  <span className="font-money">{f.text}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}
