"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  upcomingExpiryDays,
  EXPIRY_CALENDAR_AS_OF,
  type ExpiryExchange,
  type ExpiryDay,
  type ExpiryEvent,
} from "../upcoming-expiries";

const EXCHANGES: ExpiryExchange[] = ["NSE", "BSE", "MCX", "NCDEX"];

// Distinct tones so a glance separates the exchanges (matches the app palette).
const EXCH_TONE: Record<ExpiryExchange, string> = {
  NSE: "border-accent/30 bg-accent/10 text-accent",
  BSE: "border-accent/30 bg-accent/10 text-accent",
  MCX: "border-warning/30 bg-warning/10 text-warning",
  NCDEX: "border-profit/30 bg-profit/10 text-profit",
};

function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtFull(key: string): string {
  return new Date(key + "T12:00:00").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
function weekdayShort(key: string): string {
  return new Date(key + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" });
}
function awayLabel(n: number): string {
  if (n <= 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n <= 6) return `in ${n} days`;
  if (n <= 13) return "next week";
  return `in ${n} days`;
}

function Chip({ label, tone }: { label: string; tone?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tone ?? "border-border bg-surface-2 text-muted"
      )}
    >
      {label}
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-accent bg-accent/15 text-accent"
          : "border-border text-muted hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}

const EXCH_ORDER: ExpiryExchange[] = ["NSE", "BSE", "MCX", "NCDEX"];

function ExchRow({ exch, children }: { exch: ExpiryExchange; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span
        className={cn(
          "w-14 shrink-0 rounded border px-1 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide",
          EXCH_TONE[exch]
        )}
      >
        {exch}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

/** Commodity chips with a "+N more" expander (a busy date can list many). */
function CommodityChips({ items }: { items: ExpiryEvent[] }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? items : items.slice(0, 12);
  return (
    <>
      {shown.map((e) => (
        <Chip key={e.underlying} label={e.underlying} />
      ))}
      {!all && items.length > 12 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="text-[11px] font-medium text-accent hover:underline"
        >
          +{items.length - 12} more
        </button>
      )}
    </>
  );
}

function StockExpander({ items }: { items: ExpiryEvent[] }) {
  return (
    <details className="w-full">
      <summary className="cursor-pointer list-none text-xs text-muted hover:text-foreground">
        <span className="font-money font-semibold text-foreground">{items.length}</span> single
        stocks expire — tap to view
      </summary>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {items.map((e) => (
          <Chip key={e.underlying} label={e.underlying} />
        ))}
      </div>
    </details>
  );
}

function groupByExchange(events: ExpiryEvent[]): Map<ExpiryExchange, ExpiryEvent[]> {
  const m = new Map<ExpiryExchange, ExpiryEvent[]>();
  for (const e of events) {
    const arr = m.get(e.exchange);
    if (arr) arr.push(e);
    else m.set(e.exchange, [e]);
  }
  return m;
}

function DayCard({ day }: { day: ExpiryDay }) {
  const byExch = groupByExchange(day.events);
  const soon = day.daysAway <= 7;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-3",
        soon ? "border-accent/30 bg-accent/5" : "bg-surface"
      )}
    >
      <div className="flex w-12 shrink-0 flex-col items-center justify-center rounded-md border bg-surface-2/60 py-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted">
          {weekdayShort(day.date)}
        </span>
        <span className="font-money text-lg font-bold leading-none">{day.date.slice(8, 10)}</span>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{fmtFull(day.date)}</span>
          <Badge variant={soon ? "default" : "secondary"}>{awayLabel(day.daysAway)}</Badge>
        </div>
        {EXCH_ORDER.filter((x) => byExch.has(x)).map((exch) => {
          const events = byExch.get(exch)!;
          const indices = events.filter((e) => e.kind === "index");
          const commodities = events.filter((e) => e.kind === "commodity");
          const stocks = events.filter((e) => e.kind === "stock");
          return (
            <ExchRow key={exch} exch={exch}>
              {indices.map((e) => (
                <Chip
                  key={e.underlying}
                  label={e.underlying}
                  tone="border-accent/40 bg-accent/15 font-semibold text-accent"
                />
              ))}
              {commodities.length > 0 && <CommodityChips items={commodities} />}
              {stocks.length > 0 && <StockExpander items={stocks} />}
            </ExchRow>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Dhan-style cross-exchange upcoming-expiry calendar for NSE / BSE / MCX / NCDEX.
 * Dates are real listed-contract expiries (Groww snapshot) plus computed NCDEX
 * monthly dates — filterable by exchange, grouped by date, nearest first.
 */
export function UpcomingExpiriesView() {
  const today = React.useMemo(todayKey, []);
  const [selected, setSelected] = React.useState<ExpiryExchange[]>([]);
  const days = React.useMemo(
    () => upcomingExpiryDays({ today, exchanges: selected, maxDays: 120 }),
    [today, selected]
  );
  const toggle = (id: ExpiryExchange) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="space-y-3" data-testid="upcoming-expiries">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={selected.length === 0} onClick={() => setSelected([])}>
          All exchanges
        </FilterChip>
        {EXCHANGES.map((id) => (
          <FilterChip key={id} active={selected.includes(id)} onClick={() => toggle(id)}>
            {id}
          </FilterChip>
        ))}
        <span className="ml-auto text-[11px] text-muted">
          snapshot {EXPIRY_CALENDAR_AS_OF} · NCDEX = 20th (approx.)
        </span>
      </div>

      {days.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">
          No upcoming expiries in range for this filter.
        </p>
      ) : (
        <div className="space-y-2">
          {days.map((d) => (
            <DayCard key={d.date} day={d} />
          ))}
        </div>
      )}
    </div>
  );
}
