"use client";

import { useMemo } from "react";
import { CandlestickChart, Clock, Layers, TrendingUp, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { bySegment, byHourOfDay, type TradeLike } from "@/lib/stats/stats";
import { tradingStyle } from "@/lib/stats/horizon";
import { cn } from "@/lib/utils";

type Tone = "accent" | "profit" | "loss" | "neutral";

interface Stat {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: Tone;
}

const SEGMENT_LABEL: Record<string, string> = {
  OPT: "Options",
  FUT: "Futures",
  EQ: "Equity",
  CDS: "Currency",
  COM: "Commodity",
};

/** "9–10 AM" from an entry-hour bucket key (a 0–23 hour as a string). */
function hourWindow(key: string): string {
  const h = Number(key);
  if (!Number.isFinite(h)) return key;
  const fmt = (x: number) => {
    const hr = ((x % 24) + 24) % 24;
    const ampm = hr < 12 ? "AM" : "PM";
    const h12 = hr % 12 === 0 ? 12 : hr % 12;
    return `${h12} ${ampm}`;
  };
  return `${fmt(h)}–${fmt(h + 1)}`;
}

/** Mean holding time across closed trades, humanised (min / hr / days). */
function avgHold(trades: TradeLike[]): string {
  const spans = trades
    .filter((t) => t.closed_at)
    .map((t) => new Date(t.closed_at as string).getTime() - new Date(t.opened_at).getTime())
    .filter((ms) => Number.isFinite(ms) && ms >= 0);
  if (spans.length === 0) return "—";
  const min = spans.reduce((a, b) => a + b, 0) / spans.length / 60000;
  if (min < 90) return `${Math.round(min)} min`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)} hr`;
  return `${(hr / 24).toFixed(1)} days`;
}

function topByNet(groups: { key: string; netPnl: number }[]) {
  if (groups.length === 0) return null;
  return groups.reduce((best, g) => (g.netPnl > best.netPnl ? g : best));
}

/**
 * The four headline analytics tiles — trading style, average hold, the segment
 * paying most, and the best entry window. Every value is derived from the user's
 * own closed trades (computed on-device); empty data degrades to "—".
 */
export function AnalyticsStatCards({ trades }: { trades: TradeLike[] }) {
  const stats = useMemo<Stat[]>(() => {
    const style = tradingStyle(trades);
    const bestSeg = topByNet(bySegment(trades));
    const bestHour = topByNet(byHourOfDay(trades));

    return [
      {
        label: "Trading style",
        value: style.dominant ? `${style.pct}% ${style.dominant}` : "—",
        icon: CandlestickChart,
        tone: "accent",
      },
      {
        label: "Avg hold",
        value: avgHold(trades),
        icon: Clock,
        tone: "neutral",
      },
      {
        label: "Best segment",
        value: bestSeg ? (SEGMENT_LABEL[bestSeg.key] ?? bestSeg.key) : "—",
        icon: Layers,
        tone: bestSeg ? (bestSeg.netPnl >= 0 ? "profit" : "loss") : "neutral",
      },
      {
        label: "Edge window",
        value: bestHour ? hourWindow(bestHour.key) : "—",
        icon: TrendingUp,
        tone: bestHour ? (bestHour.netPnl >= 0 ? "profit" : "loss") : "neutral",
      },
    ];
  }, [trades]);

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {stats.map((s) => (
        <Card key={s.label} className="p-4">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="grid size-[30px] shrink-0 place-items-center rounded-[9px] bg-accent/15 text-accent">
              <s.icon className="size-[15px]" aria-hidden />
            </span>
            <span className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-muted">
              {s.label}
            </span>
          </div>
          <div
            className={cn(
              "text-[19px] font-semibold tracking-tight",
              s.tone === "accent" && "text-accent",
              s.tone === "profit" && "text-profit",
              s.tone === "loss" && "text-loss"
            )}
          >
            {s.value}
          </div>
        </Card>
      ))}
    </div>
  );
}
