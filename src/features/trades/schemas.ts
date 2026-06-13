import { z } from "zod";

const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined || Number.isNaN(v) ? undefined : v),
    z.coerce.number().pipe(schema).optional()
  );

/**
 * One strategy leg (e.g. the short PE of a straddle): its own instrument
 * details + execution. Symbol/expiry/plan/psychology stay per-trade.
 */
export const legSchema = z.object({
  strike: optionalNumber(z.number().positive()),
  optionType: z.enum(["CE", "PE"]).optional(),
  direction: z.enum(["long", "short"]),
  qty: z.coerce.number().int("Whole number").positive("Qty required"),
  avgEntry: z.coerce.number().positive("Entry required"),
  avgExit: optionalNumber(z.number().positive()),
});

export type TradeLeg = z.infer<typeof legSchema>;

/** Market segments offered by the form (journal-DB v4 widening). */
export const SEGMENTS = ["EQ", "FUT", "OPT", "COMM", "CDS"] as const;
/** Position products. EQ allows MIS/CNC/BTST/STBT; derivatives allow MIS/NRML. */
export const PRODUCTS = ["MIS", "CNC", "NRML", "BTST", "STBT"] as const;

/** Derivative segments carry an expiry; EQ is cash and never does. */
export const DERIVATIVE_SEGMENTS = ["FUT", "OPT", "COMM", "CDS"] as const;
export const isDerivativeSegment = (s: string): boolean =>
  (DERIVATIVE_SEGMENTS as readonly string[]).includes(s);

/** Products valid for a given segment (drives the form selector + validation). */
export function productsForSegment(segment: string): readonly (typeof PRODUCTS)[number][] {
  return segment === "EQ" ? ["MIS", "CNC", "BTST", "STBT"] : ["MIS", "NRML"];
}

export const tradeFormSchema = z
  .object({
    accountId: z.string().min(1, "Account required"),
    symbol: z.string().min(1, "Symbol required"),
    segment: z.enum(SEGMENTS),
    product: z.enum(PRODUCTS).optional(),
    expiry: z.string().optional(),
    strike: optionalNumber(z.number().positive()),
    optionType: z.enum(["CE", "PE"]).optional(),
    direction: z.enum(["long", "short"]),
    qty: z.coerce.number().int("Whole number").positive("Qty required"),
    avgEntry: z.coerce.number().positive("Entry required"),
    avgExit: optionalNumber(z.number().positive()),
    plannedEntry: optionalNumber(z.number().positive()),
    plannedSl: optionalNumber(z.number().positive()),
    plannedTarget: optionalNumber(z.number().positive()),
    openedAt: z.string().min(1, "Time required"),
    closedAt: z.string().optional(),
    playbookId: z.string().optional(),
    confidence: z.number().int().min(1).max(5).optional(),
    notes: z.string().optional(),
    tagIds: z.array(z.string()),
    manualCharges: optionalNumber(z.number().min(0)),
    /** Legs 2..N of a multi-leg strategy; the top-level fields are Leg 1. */
    extraLegs: z.array(legSchema).optional(),
  })
  .refine((v) => v.segment !== "OPT" || (v.strike && v.optionType), {
    message: "Options need strike & CE/PE",
    path: ["strike"],
  })
  // Product must be valid for the chosen segment (EQ: MIS/CNC/BTST/STBT;
  // derivatives: MIS/NRML). Absent product is allowed (defaults later).
  .refine((v) => !v.product || productsForSegment(v.segment).includes(v.product), {
    message: "Product not valid for this segment",
    path: ["product"],
  })
  // Defense in depth behind the picker: trades can't be logged for the future.
  // (2-minute slack absorbs clock skew between devices.)
  .refine((v) => new Date(v.openedAt).getTime() <= Date.now() + 2 * 60_000, {
    message: "Trades can't be in the future",
    path: ["openedAt"],
  })
  .refine((v) => !v.closedAt || new Date(v.closedAt).getTime() <= Date.now() + 2 * 60_000, {
    message: "Exit time can't be in the future",
    path: ["closedAt"],
  });

export type TradeFormValues = z.infer<typeof tradeFormSchema>;
