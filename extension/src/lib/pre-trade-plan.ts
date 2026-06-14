import { parseContractName, type ParsedInstrument } from "@/features/trades/instrument-parse";
import {
  productsForSegment,
  SEGMENTS,
  tradeFormSchema,
  type TradeFormValues,
} from "@/features/trades/schemas";
import type { Product, Segment } from "@/features/trades/types";
import { nowLocalInput } from "@/features/trades/utils";

/**
 * Pre-trade PLAN capture — the panel flow for logging a trade *before* you
 * enter it. Pure mapping from the plan inputs to the app's `TradeFormValues`,
 * the same shape the web trade form validates and the shared statement builder
 * persists, so a plan is byte-identical to a web-logged open trade.
 *
 * How it reconciles with the journal (no new reconcile code):
 *   • The plan is written as an OPEN trade (status derived from the absence of
 *     an exit) carrying planned_entry / planned_sl / planned_target.
 *   • The planned entry doubles as the row's avg_entry so the row is a valid,
 *     visible position from the moment it's planned — the user later edits the
 *     ACTUAL avg_entry / avg_exit on the web to "execute" the plan.
 *   • The journal's discipline-v2 plan-adherence metric reads planned_* (entry
 *     slippage % of planned risk, exit resolution target/cut/stop/gaveBack) the
 *     instant all three levels are present — so a captured plan reconciles
 *     automatically once executed. See src/features/insights/discipline.ts.
 */
export interface PreTradePlanInput {
  accountId: string;
  /** Raw instrument text, e.g. "BANKNIFTY24JUN52000CE" or "RELIANCE". */
  instrument: string;
  /** Segment chosen in the plan form (prefilled from the parser, overridable). */
  segment: Segment;
  /** Position product (MIS/CNC/NRML/BTST/STBT) valid for the segment. */
  product: Product;
  side: "buy" | "sell";
  qty: string;
  /** Planned entry price — also seeds avg_entry so the open row is valid. */
  plannedEntry: string;
  /** Planned stop-loss price. */
  plannedSl: string;
  /** Planned target price. */
  plannedTarget: string;
  playbookId?: string;
  notes?: string;
}

export type PreTradePlanResult =
  | { ok: true; values: TradeFormValues; parsed: ParsedInstrument }
  | { ok: false; error: string };

const toNumber = (raw: string): number | undefined => {
  const v = raw.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const isSegment = (s: string): s is Segment => (SEGMENTS as readonly string[]).includes(s);

/** Parse the instrument; the panel uses the parsed shape for its confirmation chip. */
export function parsePlanInstrument(instrument: string): ParsedInstrument {
  return parseContractName(instrument);
}

/**
 * Builds the `TradeFormValues` for a pre-trade plan. The plan is an open trade:
 * no exit (⇒ status open), avg_entry seeded from the planned entry, with the
 * three planned levels populated for the discipline-v2 plan-adherence read.
 */
export function buildPreTradePlanValues(input: PreTradePlanInput): PreTradePlanResult {
  const instrument = input.instrument.trim();
  if (!instrument) return { ok: false, error: "Instrument is required" };

  // The contract parser owns strike/option-type/expiry. The user owns segment +
  // product, but if they typed a name the parser clearly recognises as a
  // contract (OPT/FUT, or an MCX/NCDEX commodity / CDS currency), trust the
  // parsed segment so we never drop a strike/CE-PE the validator then rejects
  // or mis-charge a commodity/currency as equity.
  const parsed = parseContractName(instrument);
  const chosen = isSegment(input.segment) ? input.segment : parsed.segment;
  // A parsed non-EQ segment is a strong signal (the parser only emits OPT/FUT/
  // COMM/CDS when the name encodes one); a bare EQ parse defers to the picker.
  const segment: Segment = parsed.segment !== "EQ" ? parsed.segment : chosen;

  const product: Product = productsForSegment(segment).includes(input.product)
    ? input.product
    : productsForSegment(segment)[0]!;

  const plannedEntry = toNumber(input.plannedEntry);
  const now = nowLocalInput();

  const candidate = {
    accountId: input.accountId,
    symbol: parsed.symbol,
    segment,
    product,
    expiry: parsed.expiry ?? undefined,
    strike: parsed.strike ?? undefined,
    optionType: parsed.optionType ?? undefined,
    direction: input.side === "buy" ? ("long" as const) : ("short" as const),
    qty: toNumber(input.qty),
    // Planned entry seeds avg_entry: an open position needs a valid entry, and
    // the planned price is the trader's intended fill until they execute.
    avgEntry: plannedEntry,
    avgExit: undefined,
    plannedEntry,
    plannedSl: toNumber(input.plannedSl),
    plannedTarget: toNumber(input.plannedTarget),
    openedAt: now,
    closedAt: undefined,
    playbookId: input.playbookId || undefined,
    notes: input.notes?.trim() || undefined,
    tagIds: [] as string[],
  };

  const result = tradeFormSchema.safeParse(candidate);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: issue ? issue.message : "Invalid plan" };
  }
  // A plan without all three levels would save as an open trade but never be
  // graded — surface that as an explicit error so the user knows to fill them.
  if (
    result.data.plannedEntry == null ||
    result.data.plannedSl == null ||
    result.data.plannedTarget == null
  ) {
    return { ok: false, error: "Planned entry, stop loss and target are all required" };
  }
  return { ok: true, values: result.data, parsed };
}
