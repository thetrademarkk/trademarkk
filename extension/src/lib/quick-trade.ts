import { parseContractName, type ParsedInstrument } from "@/features/trades/instrument-parse";
import { tradeFormSchema, type TradeFormValues } from "@/features/trades/schemas";
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

export function buildQuickTradeValues(input: QuickTradeInput): QuickTradeResult {
  const instrument = input.instrument.trim();
  if (!instrument) return { ok: false, error: "Instrument is required" };
  const parsed = parseContractName(instrument);
  const exit = toNumber(input.exit);
  const now = nowLocalInput();

  const candidate = {
    accountId: input.accountId,
    symbol: parsed.symbol,
    segment: parsed.segment,
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
  return `${parsed.symbol} · Equity`;
}
