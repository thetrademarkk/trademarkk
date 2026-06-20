"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  upcomingExpiryDays,
  type ExpiryExchange,
  type ExpiryDay,
  type ExpiryEvent,
  type ExpiryInstrumentType,
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
                <Chip key={e.underlying} label={e.underlying} />
              ))}
              {commodities.length > 0 && <CommodityChips items={commodities} />}
              {stocks.length > 0 && <Chip label="Stocks" />}
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
  const [type, setType] = React.useState<ExpiryInstrumentType>("all");
  const days = React.useMemo(
    () => upcomingExpiryDays({ today, exchanges: selected, type, maxDays: 120 }),
    [today, selected, type]
  );
  const toggle = (id: ExpiryExchange) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const exchangeLabel =
    selected.length === 0
      ? "All exchanges"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} exchanges`;

  return (
    <div className="space-y-3" data-testid="upcoming-expiries">
      {/* Both filters are compact dropdowns so the whole row fits on one line
          even on a 360px phone. */}
      <div className="flex items-center gap-2">
        <Select value={type} onValueChange={(v) => setType(v as ExpiryInstrumentType)}>
          <SelectTrigger className="h-8 w-[8.5rem] text-xs" aria-label="Contract type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All contracts</SelectItem>
            <SelectItem value="options">Options</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-8 min-w-[8.5rem] items-center justify-between gap-1.5 rounded-md border bg-surface px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 data-[state=open]:ring-2 data-[state=open]:ring-accent/60"
            aria-label="Filter exchanges"
          >
            {exchangeLabel}
            <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[10rem]">
            <DropdownMenuCheckboxItem
              checked={selected.length === 0}
              onCheckedChange={() => setSelected([])}
              onSelect={(e) => e.preventDefault()}
            >
              All exchanges
            </DropdownMenuCheckboxItem>
            {EXCHANGES.map((id) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={selected.includes(id)}
                onCheckedChange={() => toggle(id)}
                onSelect={(e) => e.preventDefault()}
              >
                {id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
