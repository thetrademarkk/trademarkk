"use client";

import { cn, formatINR, toDateKey } from "@/lib/utils";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

interface MonthHeatmapProps {
  year: number;
  month: number; // 0-based
  dailyPnl: Map<string, number>;
  journaledDates?: Set<string>;
  selected?: string | null;
  onSelect?: (dateKey: string) => void;
  compact?: boolean;
}

/** Month grid heatmap — cell intensity scales with |day P&L|. */
export function MonthHeatmap({ year, month, dailyPnl, journaledDates, selected, onSelect, compact }: MonthHeatmapProps) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-start
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayK = toDateKey(new Date());
  const maxAbs = Math.max(1, ...[...dailyPnl.values()].map((v) => Math.abs(v)));

  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDateKey(new Date(year, month, i + 1))),
  ];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_HEADERS.map((d, i) => (
          <div key={i} className="micro-label py-1">{d}</div>
        ))}
        {cells.map((key, i) => {
          if (!key) return <div key={`empty-${i}`} />;
          const pnl = dailyPnl.get(key);
          const intensity = pnl != null ? Math.max(0.18, Math.abs(pnl) / maxAbs) : 0;
          const bg =
            pnl == null
              ? undefined
              : pnl >= 0
                ? `color-mix(in srgb, var(--profit) ${Math.round(intensity * 45)}%, transparent)`
                : `color-mix(in srgb, var(--loss) ${Math.round(intensity * 45)}%, transparent)`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect?.(key)}
              title={pnl != null ? `${key}: ${formatINR(pnl, { signed: true })}` : key}
              className={cn(
                "relative rounded-md border text-xs transition-colors",
                compact ? "h-9" : "h-12 md:h-16",
                key === todayK && "ring-1 ring-accent",
                selected === key && "ring-2 ring-accent",
                pnl == null && "text-muted hover:bg-surface-2"
              )}
              style={{ backgroundColor: bg }}
            >
              <span className="absolute left-1 top-0.5 opacity-70">{Number(key.slice(8))}</span>
              {!compact && pnl != null && (
                <span className={cn("absolute inset-x-0 bottom-1 font-money text-[10px] md:text-[11px]", pnl >= 0 ? "text-profit" : "text-loss")}>
                  {formatINR(pnl)}
                </span>
              )}
              {journaledDates?.has(key) && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
