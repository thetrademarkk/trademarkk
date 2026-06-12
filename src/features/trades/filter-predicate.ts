// Advanced multi-criteria trade filtering — pure functions, no I/O.
// Runs client-side on the already-fetched trades list, so it behaves
// identically across hosted / BYOD / local storage modes. URL codecs keep
// filter state shareable; the saved-views store persists named filter sets.

import { toDateKey } from "@/lib/utils";
import type { TradeWithMeta } from "./types";

export type Segment = "EQ" | "FUT" | "OPT";

export interface AdvancedTradeFilters {
  /** Case-insensitive substring match on the base symbol. */
  symbol?: string;
  segments?: Segment[];
  direction?: "long" | "short";
  /** Closed trades only — open trades never match a result filter. */
  result?: "win" | "loss";
  playbookIds?: string[];
  /** Trade matches when it carries at least one of the selected tags. */
  tagIds?: string[];
  /** Inclusive R-multiple band; trades without an R never match a bound. */
  rMin?: number;
  rMax?: number;
  /** Inclusive net P&L band (₹); open trades never match a bound. */
  pnlMin?: number;
  pnlMax?: number;
  /** Inclusive local-date band (YYYY-MM-DD) on the entry time. */
  dateFrom?: string;
  dateTo?: string;
  /** Local weekdays of the entry time: 0=Sun … 6=Sat. */
  weekdays?: number[];
  /** Day classification from the rules checklist (rule_checks). */
  ruleCheck?: "clean" | "broken";
}

/** Day sets derived from rule_checks — see useRuleDays() in the rules feature. */
export interface RuleDayContext {
  /** Dates with at least one broken rule check. */
  brokenDates: Set<string>;
  /** Dates with at least one rule check of any status. */
  checkedDates: Set<string>;
}

export const SEGMENT_LABELS: Record<Segment, string> = {
  OPT: "Options",
  FUT: "Futures",
  EQ: "Equity",
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const SEGMENTS: Segment[] = ["EQ", "FUT", "OPT"];
const MAX_IDS = 50;
const MAX_TEXT = 64;

/** True when the trade passes every active criterion (criteria AND together). */
export function matchesTrade(
  t: TradeWithMeta,
  f: AdvancedTradeFilters,
  ruleDays?: RuleDayContext
): boolean {
  const symbol = f.symbol?.trim().toUpperCase();
  if (symbol && !t.symbol.toUpperCase().includes(symbol)) return false;

  if (f.segments?.length && !f.segments.includes(t.segment)) return false;
  if (f.direction && t.direction !== f.direction) return false;

  if (f.result) {
    if (t.status !== "closed") return false;
    if (f.result === "win" && t.net_pnl <= 0) return false;
    if (f.result === "loss" && t.net_pnl >= 0) return false;
  }

  if (f.playbookIds?.length && (!t.playbook_id || !f.playbookIds.includes(t.playbook_id)))
    return false;
  if (f.tagIds?.length && !t.tags.some((tag) => f.tagIds!.includes(tag.id))) return false;

  if (f.rMin != null || f.rMax != null) {
    if (t.r_multiple == null) return false;
    if (f.rMin != null && t.r_multiple < f.rMin) return false;
    if (f.rMax != null && t.r_multiple > f.rMax) return false;
  }

  if (f.pnlMin != null || f.pnlMax != null) {
    if (t.status !== "closed") return false;
    if (f.pnlMin != null && t.net_pnl < f.pnlMin) return false;
    if (f.pnlMax != null && t.net_pnl > f.pnlMax) return false;
  }

  if (f.dateFrom || f.dateTo || f.weekdays?.length || f.ruleCheck) {
    const opened = new Date(t.opened_at);
    const dateKey = toDateKey(opened);
    if (f.dateFrom && dateKey < f.dateFrom) return false;
    if (f.dateTo && dateKey > f.dateTo) return false;
    if (f.weekdays?.length && !f.weekdays.includes(opened.getDay())) return false;
    // Without day context (still loading) the rule criterion is ignored —
    // the page gates rendering on it instead of flashing wrong results.
    if (f.ruleCheck && ruleDays) {
      if (f.ruleCheck === "broken" && !ruleDays.brokenDates.has(dateKey)) return false;
      if (
        f.ruleCheck === "clean" &&
        (!ruleDays.checkedDates.has(dateKey) || ruleDays.brokenDates.has(dateKey))
      )
        return false;
    }
  }

  return true;
}

export function filterTrades(
  trades: TradeWithMeta[],
  f: AdvancedTradeFilters,
  ruleDays?: RuleDayContext
): TradeWithMeta[] {
  if (!hasActiveFilters(f)) return trades;
  return trades.filter((t) => matchesTrade(t, f, ruleDays));
}

/** Number of active criterion groups (a min+max range counts once). */
export function countActiveFilters(f: AdvancedTradeFilters): number {
  let n = 0;
  if (f.symbol?.trim()) n++;
  if (f.segments?.length) n++;
  if (f.direction) n++;
  if (f.result) n++;
  if (f.playbookIds?.length) n++;
  if (f.tagIds?.length) n++;
  if (f.rMin != null || f.rMax != null) n++;
  if (f.pnlMin != null || f.pnlMax != null) n++;
  if (f.dateFrom || f.dateTo) n++;
  if (f.weekdays?.length) n++;
  if (f.ruleCheck) n++;
  return n;
}

export function hasActiveFilters(f: AdvancedTradeFilters): boolean {
  return countActiveFilters(f) > 0;
}

// ---------------------------------------------------------------------------
// Sanitizing — saved views and URL params are user-editable, so every field
// is validated before it reaches the predicate.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, MAX_TEXT);
  return s || undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v !== "number" && (typeof v !== "string" || v.trim() === "")) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function asDate(v: unknown): string | undefined {
  return typeof v === "string" && DATE_RE.test(v) ? v : undefined;
}

function asIdList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ids = [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))]
    .map((x) => x.slice(0, MAX_TEXT))
    .slice(0, MAX_IDS);
  return ids.length ? ids : undefined;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Clamps arbitrary input (URL params, persisted views) to a valid filter set. */
export function sanitizeFilters(input: unknown): AdvancedTradeFilters {
  if (typeof input !== "object" || input === null) return {};
  const raw = input as Record<string, unknown>;
  const f: AdvancedTradeFilters = {};

  const symbol = asText(raw.symbol);
  if (symbol) f.symbol = symbol;

  if (Array.isArray(raw.segments)) {
    const segs = SEGMENTS.filter((s) => (raw.segments as unknown[]).includes(s));
    if (segs.length) f.segments = segs;
  }

  const direction = oneOf(raw.direction, ["long", "short"] as const);
  if (direction) f.direction = direction;
  const result = oneOf(raw.result, ["win", "loss"] as const);
  if (result) f.result = result;

  const playbookIds = asIdList(raw.playbookIds);
  if (playbookIds) f.playbookIds = playbookIds;
  const tagIds = asIdList(raw.tagIds);
  if (tagIds) f.tagIds = tagIds;

  const rMin = asNumber(raw.rMin);
  if (rMin != null) f.rMin = rMin;
  const rMax = asNumber(raw.rMax);
  if (rMax != null) f.rMax = rMax;
  const pnlMin = asNumber(raw.pnlMin);
  if (pnlMin != null) f.pnlMin = pnlMin;
  const pnlMax = asNumber(raw.pnlMax);
  if (pnlMax != null) f.pnlMax = pnlMax;

  const dateFrom = asDate(raw.dateFrom);
  if (dateFrom) f.dateFrom = dateFrom;
  const dateTo = asDate(raw.dateTo);
  if (dateTo) f.dateTo = dateTo;

  if (Array.isArray(raw.weekdays)) {
    const days = [
      ...new Set(
        raw.weekdays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      ),
    ].sort((a, b) => a - b);
    if (days.length) f.weekdays = days;
  }

  const ruleCheck = oneOf(raw.ruleCheck, ["clean", "broken"] as const);
  if (ruleCheck) f.ruleCheck = ruleCheck;

  return f;
}

// ---------------------------------------------------------------------------
// URL codecs — compact keys so filtered views are shareable links.
// ---------------------------------------------------------------------------

const URL_KEYS = {
  symbol: "sym",
  direction: "dir",
  result: "res",
  rMin: "rmin",
  rMax: "rmax",
  pnlMin: "pmin",
  pnlMax: "pmax",
  dateFrom: "from",
  dateTo: "to",
  ruleCheck: "rule",
} as const;

/** Serializes active filters to a query string ("" when nothing is active). */
export function encodeFiltersToSearch(f: AdvancedTradeFilters): string {
  const p = new URLSearchParams();
  const clean = sanitizeFilters(f);
  for (const [field, key] of Object.entries(URL_KEYS) as [keyof typeof URL_KEYS, string][]) {
    const v = clean[field];
    if (v != null) p.set(key, String(v));
  }
  if (clean.segments) p.set("seg", clean.segments.join(","));
  if (clean.playbookIds) p.set("pb", clean.playbookIds.join(","));
  if (clean.tagIds) p.set("tag", clean.tagIds.join(","));
  if (clean.weekdays) p.set("wd", clean.weekdays.join(","));
  return p.toString();
}

/** Parses a query string (with or without leading "?") into sanitized filters. */
export function decodeFiltersFromSearch(search: string): AdvancedTradeFilters {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const csv = (key: string) => p.get(key)?.split(",").filter(Boolean);
  return sanitizeFilters({
    symbol: p.get(URL_KEYS.symbol) ?? undefined,
    segments: csv("seg"),
    direction: p.get(URL_KEYS.direction) ?? undefined,
    result: p.get(URL_KEYS.result) ?? undefined,
    playbookIds: csv("pb"),
    tagIds: csv("tag"),
    rMin: p.get(URL_KEYS.rMin) ?? undefined,
    rMax: p.get(URL_KEYS.rMax) ?? undefined,
    pnlMin: p.get(URL_KEYS.pnlMin) ?? undefined,
    pnlMax: p.get(URL_KEYS.pnlMax) ?? undefined,
    dateFrom: p.get(URL_KEYS.dateFrom) ?? undefined,
    dateTo: p.get(URL_KEYS.dateTo) ?? undefined,
    weekdays: csv("wd"),
    ruleCheck: p.get(URL_KEYS.ruleCheck) ?? undefined,
  });
}
