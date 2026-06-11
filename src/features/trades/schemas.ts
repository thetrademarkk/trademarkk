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

export const tradeFormSchema = z
  .object({
    accountId: z.string().min(1, "Account required"),
    symbol: z.string().min(1, "Symbol required"),
    segment: z.enum(["EQ", "FUT", "OPT"]),
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
