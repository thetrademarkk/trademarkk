"use client";

// TradeZella-grade composable filter bar: every criterion renders as an
// editable chip, new criteria come from the "Add filter" menu, and the whole
// set is shareable (URL) and saveable (named views in localStorage).

import * as React from "react";
import { toast } from "sonner";
import {
  Bookmark,
  BookOpenText,
  CalendarDays,
  CalendarRange,
  Check,
  Gauge,
  IndianRupee,
  Layers,
  Link2,
  ListFilter,
  MoveRight,
  Search,
  ShieldCheck,
  Tags,
  Trash2,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSavedViewsStore } from "@/stores/saved-views-store";
import { usePlaybooks, useTags } from "../queries";
import {
  countActiveFilters,
  hasActiveFilters,
  sanitizeFilters,
  SEGMENT_LABELS,
  WEEKDAY_LABELS,
  type AdvancedTradeFilters,
  type Segment,
} from "../filter-predicate";
import type { PlaybookRow, Tag } from "../types";

type CriterionKey =
  | "segments"
  | "direction"
  | "result"
  | "playbookIds"
  | "tagIds"
  | "r"
  | "pnl"
  | "date"
  | "weekdays"
  | "ruleCheck";

const CRITERIA: { key: CriterionKey; label: string; icon: LucideIcon }[] = [
  { key: "segments", label: "Segment", icon: Layers },
  { key: "direction", label: "Direction", icon: MoveRight },
  { key: "result", label: "Result", icon: Trophy },
  { key: "playbookIds", label: "Setup", icon: BookOpenText },
  { key: "tagIds", label: "Tags", icon: Tags },
  { key: "r", label: "R multiple", icon: Gauge },
  { key: "pnl", label: "Net P&L", icon: IndianRupee },
  { key: "date", label: "Date range", icon: CalendarRange },
  { key: "weekdays", label: "Weekday", icon: CalendarDays },
  { key: "ruleCheck", label: "Rule check", icon: ShieldCheck },
];

const CLEAR_PATCH: Record<CriterionKey, Partial<AdvancedTradeFilters>> = {
  segments: { segments: undefined },
  direction: { direction: undefined },
  result: { result: undefined },
  playbookIds: { playbookIds: undefined },
  tagIds: { tagIds: undefined },
  r: { rMin: undefined, rMax: undefined },
  pnl: { pnlMin: undefined, pnlMax: undefined },
  date: { dateFrom: undefined, dateTo: undefined },
  weekdays: { weekdays: undefined },
  ruleCheck: { ruleCheck: undefined },
};

function isActive(key: CriterionKey, f: AdvancedTradeFilters): boolean {
  switch (key) {
    case "segments":
      return Boolean(f.segments?.length);
    case "direction":
      return Boolean(f.direction);
    case "result":
      return Boolean(f.result);
    case "playbookIds":
      return Boolean(f.playbookIds?.length);
    case "tagIds":
      return Boolean(f.tagIds?.length);
    case "r":
      return f.rMin != null || f.rMax != null;
    case "pnl":
      return f.pnlMin != null || f.pnlMax != null;
    case "date":
      return Boolean(f.dateFrom || f.dateTo);
    case "weekdays":
      return Boolean(f.weekdays?.length);
    case "ruleCheck":
      return Boolean(f.ruleCheck);
  }
}

const rangeLabel = (prefix: string, fmt: (n: number) => string, min?: number, max?: number) =>
  min != null && max != null
    ? `${prefix} ${fmt(min)} to ${fmt(max)}`
    : min != null
      ? `${prefix} ≥ ${fmt(min)}`
      : `${prefix} ≤ ${fmt(max!)}`;

const fmtDay = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

function namesFor(ids: string[], lookup: { id: string; name: string }[], noun: string): string {
  const names = ids
    .map((id) => lookup.find((x) => x.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  return names.length > 0 ? names.join(", ") : `${ids.length} ${noun}`;
}

function chipLabel(
  key: CriterionKey,
  f: AdvancedTradeFilters,
  playbooks: PlaybookRow[],
  tags: Tag[]
): string {
  switch (key) {
    case "segments":
      return (f.segments ?? []).map((s) => SEGMENT_LABELS[s]).join(", ");
    case "direction":
      return f.direction === "long" ? "Long" : "Short";
    case "result":
      return f.result === "win" ? "Wins" : "Losses";
    case "playbookIds":
      return namesFor(f.playbookIds ?? [], playbooks, "setups");
    case "tagIds":
      return namesFor(f.tagIds ?? [], tags, "tags");
    case "r":
      return rangeLabel("R", (n) => `${n}`, f.rMin, f.rMax);
    case "pnl":
      return rangeLabel("P&L", (n) => formatINR(n), f.pnlMin, f.pnlMax);
    case "date":
      return f.dateFrom && f.dateTo
        ? `${fmtDay(f.dateFrom)} to ${fmtDay(f.dateTo)}`
        : f.dateFrom
          ? `From ${fmtDay(f.dateFrom)}`
          : `Until ${fmtDay(f.dateTo!)}`;
    case "weekdays":
      return (f.weekdays ?? []).map((d) => WEEKDAY_LABELS[d]).join(", ");
    case "ruleCheck":
      return f.ruleCheck === "clean" ? "Clean days" : "Broken-rule days";
  }
}

// --- editors ---------------------------------------------------------------

function MultiList({
  options,
  selected,
  onToggle,
  emptyText,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string, on: boolean) => void;
  emptyText?: string;
}) {
  if (options.length === 0)
    return <p className="px-1.5 py-1 text-xs text-muted">{emptyText ?? "Nothing here yet."}</p>;
  return (
    <div className="max-h-60 space-y-0.5 overflow-y-auto">
      {options.map((o) => (
        <label
          key={o.value}
          className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-surface-2"
        >
          <Checkbox
            checked={selected.includes(o.value)}
            onCheckedChange={(c) => onToggle(o.value, c === true)}
          />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function ChoiceList({
  options,
  value,
  onSelect,
}: {
  options: { value: string; label: string }[];
  value?: string;
  onSelect: (value?: string) => void;
}) {
  return (
    <div className="space-y-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2",
              active && "bg-surface-2 font-medium"
            )}
            onClick={() => onSelect(active ? undefined : o.value)}
          >
            {o.label}
            {active && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
          </button>
        );
      })}
    </div>
  );
}

function RangeEditor({
  unit,
  min,
  max,
  onCommit,
}: {
  unit: string;
  min?: number;
  max?: number;
  onCommit: (min?: number, max?: number) => void;
}) {
  const [lo, setLo] = React.useState(min != null ? String(min) : "");
  const [hi, setHi] = React.useState(max != null ? String(max) : "");
  const parse = (s: string) => {
    if (s.trim() === "") return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const update = (l: string, h: string) => {
    setLo(l);
    setHi(h);
    onCommit(parse(l), parse(h));
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{unit} (inclusive)</p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          placeholder="Min"
          aria-label={`${unit} minimum`}
          className="h-8"
          value={lo}
          onChange={(e) => update(e.target.value, hi)}
        />
        <span className="text-xs text-muted">to</span>
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          placeholder="Max"
          aria-label={`${unit} maximum`}
          className="h-8"
          value={hi}
          onChange={(e) => update(lo, e.target.value)}
        />
      </div>
    </div>
  );
}

function DateRangeEditor({
  from,
  to,
  onCommit,
}: {
  from?: string;
  to?: string;
  onCommit: (from?: string, to?: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs text-muted">From</Label>
        <Input
          type="date"
          className="h-8"
          aria-label="Date from"
          value={from ?? ""}
          onChange={(e) => onCommit(e.target.value || undefined, to)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted">To</Label>
        <Input
          type="date"
          className="h-8"
          aria-label="Date to"
          value={to ?? ""}
          onChange={(e) => onCommit(from, e.target.value || undefined)}
        />
      </div>
    </div>
  );
}

const WEEKDAY_OPTIONS = ([1, 2, 3, 4, 5, 6, 0] as const).map((d) => ({
  value: String(d),
  label: WEEKDAY_LABELS[d],
}));

function CriterionEditor({
  k,
  filters,
  onChange,
  playbooks,
  tags,
}: {
  k: CriterionKey;
  filters: AdvancedTradeFilters;
  onChange: (f: AdvancedTradeFilters) => void;
  playbooks: PlaybookRow[];
  tags: Tag[];
}) {
  const set = (patch: Partial<AdvancedTradeFilters>) => onChange({ ...filters, ...patch });
  const toggleIn = <T,>(current: T[] | undefined, value: T, on: boolean): T[] | undefined => {
    const next = on ? [...(current ?? []), value] : (current ?? []).filter((v) => v !== value);
    return next.length ? next : undefined;
  };

  switch (k) {
    case "segments":
      return (
        <MultiList
          options={(["OPT", "FUT", "EQ"] as Segment[]).map((s) => ({
            value: s,
            label: SEGMENT_LABELS[s],
          }))}
          selected={filters.segments ?? []}
          onToggle={(value, on) =>
            set({ segments: toggleIn(filters.segments, value as Segment, on) })
          }
        />
      );
    case "direction":
      return (
        <ChoiceList
          options={[
            { value: "long", label: "Long" },
            { value: "short", label: "Short" },
          ]}
          value={filters.direction}
          onSelect={(v) => set({ direction: v as AdvancedTradeFilters["direction"] })}
        />
      );
    case "result":
      return (
        <ChoiceList
          options={[
            { value: "win", label: "Wins" },
            { value: "loss", label: "Losses" },
          ]}
          value={filters.result}
          onSelect={(v) => set({ result: v as AdvancedTradeFilters["result"] })}
        />
      );
    case "playbookIds":
      return (
        <MultiList
          options={playbooks.map((p) => ({ value: p.id, label: p.name }))}
          selected={filters.playbookIds ?? []}
          onToggle={(value, on) => set({ playbookIds: toggleIn(filters.playbookIds, value, on) })}
          emptyText="No setups yet — create one in Playbooks."
        />
      );
    case "tagIds":
      return (
        <MultiList
          options={tags.map((t) => ({ value: t.id, label: t.name }))}
          selected={filters.tagIds ?? []}
          onToggle={(value, on) => set({ tagIds: toggleIn(filters.tagIds, value, on) })}
          emptyText="No tags yet — tag trades from the trade form."
        />
      );
    case "r":
      return (
        <RangeEditor
          unit="R multiple"
          min={filters.rMin}
          max={filters.rMax}
          onCommit={(min, max) => set({ rMin: min, rMax: max })}
        />
      );
    case "pnl":
      return (
        <RangeEditor
          unit="Net P&L in ₹"
          min={filters.pnlMin}
          max={filters.pnlMax}
          onCommit={(min, max) => set({ pnlMin: min, pnlMax: max })}
        />
      );
    case "date":
      return (
        <DateRangeEditor
          from={filters.dateFrom}
          to={filters.dateTo}
          onCommit={(from, to) => set({ dateFrom: from, dateTo: to })}
        />
      );
    case "weekdays":
      return (
        <MultiList
          options={WEEKDAY_OPTIONS}
          selected={(filters.weekdays ?? []).map(String)}
          onToggle={(value, on) => {
            const current = filters.weekdays ?? [];
            const day = Number(value);
            const next = on ? [...current, day] : current.filter((d) => d !== day);
            set({ weekdays: next.length ? next.sort((a, b) => a - b) : undefined });
          }}
        />
      );
    case "ruleCheck":
      return (
        <ChoiceList
          options={[
            { value: "clean", label: "Clean days (no rules broken)" },
            { value: "broken", label: "Broken-rule days" },
          ]}
          value={filters.ruleCheck}
          onSelect={(v) => set({ ruleCheck: v as AdvancedTradeFilters["ruleCheck"] })}
        />
      );
  }
}

// --- chips, add-menu, views ------------------------------------------------

function FilterChip({
  k,
  filters,
  onChange,
  playbooks,
  tags,
}: {
  k: CriterionKey;
  filters: AdvancedTradeFilters;
  onChange: (f: AdvancedTradeFilters) => void;
  playbooks: PlaybookRow[];
  tags: Tag[];
}) {
  const meta = CRITERIA.find((c) => c.key === k)!;
  const label = chipLabel(k, filters, playbooks, tags);
  return (
    <div
      className="flex h-8 items-center overflow-hidden rounded-full border bg-surface-2 text-xs font-medium"
      data-filter-chip={k}
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-full max-w-[240px] items-center gap-1.5 pl-2.5 pr-1.5 transition-colors hover:bg-surface"
            aria-label={`Edit ${meta.label} filter`}
          >
            <meta.icon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2">
          <CriterionEditor
            k={k}
            filters={filters}
            onChange={onChange}
            playbooks={playbooks}
            tags={tags}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remove ${meta.label} filter`}
        className="flex h-full items-center pl-1 pr-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
        onClick={() => onChange({ ...filters, ...CLEAR_PATCH[k] })}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AddFilterMenu({
  filters,
  onChange,
  playbooks,
  tags,
}: {
  filters: AdvancedTradeFilters;
  onChange: (f: AdvancedTradeFilters) => void;
  playbooks: PlaybookRow[];
  tags: Tag[];
}) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CriterionKey | null>(null);
  const inactive = CRITERIA.filter((c) => !isActive(c.key, filters));
  if (inactive.length === 0) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setEditing(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 rounded-full">
          <ListFilter className="h-3.5 w-3.5" /> Add filter
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2">
        {editing === null ? (
          <div className="space-y-0.5">
            {inactive.map((c) => (
              <button
                key={c.key}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => setEditing(c.key)}
              >
                <c.icon className="h-4 w-4 text-muted" aria-hidden="true" />
                {c.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              className="text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setEditing(null)}
            >
              All filters
            </button>
            <CriterionEditor
              k={editing}
              filters={filters}
              onChange={onChange}
              playbooks={playbooks}
              tags={tags}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ViewsMenu({
  filters,
  onChange,
}: {
  filters: AdvancedTradeFilters;
  onChange: (f: AdvancedTradeFilters) => void;
}) {
  const { views, saveView, deleteView } = useSavedViewsStore();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const active = hasActiveFilters(filters);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !active) return;
    saveView(trimmed, filters);
    toast.success(`View "${trimmed}" saved`);
    setName("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 rounded-full">
          <Bookmark className="h-3.5 w-3.5" /> Views
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 p-3" align="end">
        <form onSubmit={save} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={active ? "Name this view…" : "Apply filters first…"}
            disabled={!active}
            maxLength={40}
            className="h-8 text-sm"
          />
          <Button type="submit" size="sm" className="h-8" disabled={!active || !name.trim()}>
            Save
          </Button>
        </form>
        {views.length === 0 ? (
          <p className="text-xs text-muted">
            Save the current filters as a named view and switch back to it anytime.
          </p>
        ) : (
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {views.map((v) => {
              const n = countActiveFilters(v.filters);
              return (
                <div key={v.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                    onClick={() => {
                      onChange(sanitizeFilters(v.filters));
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{v.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted">
                      {n} filter{n === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete view ${v.name}`}
                    className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-loss"
                    onClick={() => deleteView(v.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- bar -------------------------------------------------------------------

export function TradeFiltersBar({
  filters,
  onChange,
}: {
  filters: AdvancedTradeFilters;
  onChange: (f: AdvancedTradeFilters) => void;
}) {
  const { data: playbooks = [] } = usePlaybooks();
  const { data: tags = [] } = useTags();
  const activeChips = CRITERIA.filter((c) => isActive(c.key, filters));
  const nActive = countActiveFilters(filters);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Filter link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="trade-filters">
      <div className="relative">
        <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted" aria-hidden="true" />
        <Input
          placeholder="Symbol…"
          aria-label="Filter by symbol"
          className="h-8 w-[140px] pl-8 md:w-[180px]"
          value={filters.symbol ?? ""}
          onChange={(e) => onChange({ ...filters, symbol: e.target.value || undefined })}
        />
      </div>

      {activeChips.map((c) => (
        <FilterChip
          key={c.key}
          k={c.key}
          filters={filters}
          onChange={onChange}
          playbooks={playbooks}
          tags={tags}
        />
      ))}

      <AddFilterMenu filters={filters} onChange={onChange} playbooks={playbooks} tags={tags} />

      {nActive > 0 && (
        <>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => onChange({})}>
            <X className="h-3.5 w-3.5" /> Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={copyLink}>
            <Link2 className="h-3.5 w-3.5" /> Share
          </Button>
        </>
      )}

      <div className="ml-auto">
        <ViewsMenu filters={filters} onChange={onChange} />
      </div>
    </div>
  );
}
