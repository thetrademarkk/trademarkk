import { parseContractName, type ParsedInstrument } from "@/features/trades/instrument-parse";
import {
  isDerivativeSegment,
  tradeFormSchema,
  type TradeFormValues,
} from "@/features/trades/schemas";
import { nowLocalInput } from "@/features/trades/utils";

/**
 * Pure mapping from the panel's quick-log inputs to the app's TradeFormValues —
 * the exact shape the web trade form validates and persists. Times default to
 * "now" (the quick log exists to capture trades the moment they happen).
 */
export interface QuickTradeInput {
  accountId: string;
  /** Raw instrument text, e.g. "BANKNIFTY24JUN52000CE" or "RELIANCE". */
  instrument: string;
  /**
   * Captured broker exchange (NSE/BSE/MCX/NCDEX/CDS/...), when known. Used
   * ONLY to disambiguate the segment for a bare instrument whose name does
   * not already carry an exchange prefix or a recognised commodity/currency
   * base — e.g. a thin MCX/NCDEX commodity captured as just "GUARSEED" with
   * the exchange shown separately. Never overrides an explicit prefix.
   */
  exchange?: string | null;
  side: "buy" | "sell";
  qty: string;
  entry: string;
  /** Empty = still-open trade. */
  exit: string;
  playbookId?: string;
  notes?: string;
}

export type QuickTradeResult =
  | { ok: true; values: TradeFormValues; parsed: ParsedInstrument }
  | { ok: false; error: string };

const toNumber = (raw: string): number | undefined => {
  const v = raw.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Exchange tokens the contract-name parser understands as a "EX:SYM" prefix. */
const PARSER_EXCHANGES = new Set([
  "NSE",
  "BSE",
  "NFO",
  "BFO",
  "MCX",
  "CDS",
  "BCD",
  "NCDEX",
  "NCD",
  "NCO",
]);

/**
 * Prepends the captured broker exchange as a parser prefix when (a) the
 * instrument has no exchange prefix already and (b) the exchange is one the
 * contract-name parser can act on (MCX/NCDEX/CDS disambiguate the segment for a
 * bare commodity/currency name; NSE/BSE are harmless no-ops the parser strips).
 * This is the path that gets a thin MCX/NCDEX commodity ("GUARSEED", "DHANIYA")
 * classified as COMM even when its base isn't a built-in commodity keyword.
 */
export function applyCapturedExchange(instrument: string, exchange?: string | null): string {
  const sym = instrument.trim();
  if (!sym || /^[A-Z]+:/i.test(sym)) return sym; // already prefixed → leave it
  const ex = (exchange ?? "").trim().toUpperCase();
  if (!ex || !PARSER_EXCHANGES.has(ex)) return sym;
  return `${ex}:${sym}`;
}

/**
 * Default position product for a freshly captured/quick-logged trade, from the
 * segment: derivatives (FUT/OPT/COMM/CDS) are carry-forward (NRML) by default,
 * cash equity is intraday (MIS). The user can still change it on the web; this
 * just stops every captured commodity/currency/F&O trade defaulting to MIS,
 * which would mis-state charges (e.g. NRML vs MIS brokerage/holding basis).
 */
export function defaultProductForSegment(segment: TradeFormValues["segment"]): "MIS" | "NRML" {
  return isDerivativeSegment(segment) ? "NRML" : "MIS";
}

export function buildQuickTradeValues(input: QuickTradeInput): QuickTradeResult {
  const instrument = input.instrument.trim();
  if (!instrument) return { ok: false, error: "Instrument is required" };
  // The captured exchange disambiguates a bare commodity/currency symbol
  // (MCX/NCDEX/CDS) before parsing; it never overrides an explicit prefix.
  const parsed = parseContractName(applyCapturedExchange(instrument, input.exchange));
  const exit = toNumber(input.exit);
  const now = nowLocalInput();

  const candidate = {
    accountId: input.accountId,
    symbol: parsed.symbol,
    segment: parsed.segment,
    // Product mirrors the CSV-import inference: derivatives → NRML, EQ → MIS.
    product: defaultProductForSegment(parsed.segment),
    expiry: parsed.expiry ?? undefined,
    strike: parsed.strike ?? undefined,
    optionType: parsed.optionType ?? undefined,
    direction: input.side === "buy" ? ("long" as const) : ("short" as const),
    qty: toNumber(input.qty),
    avgEntry: toNumber(input.entry),
    avgExit: exit,
    openedAt: now,
    closedAt: exit != null ? now : undefined,
    playbookId: input.playbookId || undefined,
    notes: input.notes?.trim() || undefined,
    tagIds: [] as string[],
  };

  const result = tradeFormSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: issue ? issue.message : "Invalid trade" };
  }
  return { ok: true, values: result.data, parsed };
}

/** Compact human description of a parsed instrument for the confirmation chip. */
export function describeParsed(parsed: ParsedInstrument): string {
  if (parsed.segment === "OPT") {
    const strike = parsed.strike != null ? ` ${parsed.strike}` : "";
    const type = parsed.optionType ? ` ${parsed.optionType}` : "";
    const expiry = parsed.expiry ? ` · exp ${parsed.expiry}` : "";
    return `${parsed.symbol} · Options${strike}${type}${expiry}`;
  }
  if (parsed.segment === "FUT") {
    const expiry = parsed.expiry ? ` · exp ${parsed.expiry}` : "";
    return `${parsed.symbol} · Futures${expiry}`;
  }
  if (parsed.segment === "COMM") {
    const strike = parsed.strike != null ? ` ${parsed.strike}` : "";
    const type = parsed.optionType ? ` ${parsed.optionType}` : "";
    const agri = parsed.agri ? " agri" : "";
    return `${parsed.symbol} · Commodity${strike}${type}${agri}`;
  }
  if (parsed.segment === "CDS") {
    const strike = parsed.strike != null ? ` ${parsed.strike}` : "";
    const type = parsed.optionType ? ` ${parsed.optionType}` : "";
    return `${parsed.symbol} · Currency${strike}${type}`;
  }
  return `${parsed.symbol} · Equity`;
}
