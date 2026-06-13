import { computeCharges, computeGrossPnl, computeRMultiple } from "@/lib/charges/charges";
import { classifyAgriCommodity } from "./instrument-parse";
import { getChargeProfile } from "@/config/brokers";
import type { TradeFormValues, TradeLeg } from "./schemas";

export interface DerivedNumbers {
  status: "open" | "closed";
  gross: number;
  charges: number;
  net: number;
  r: number | null;
}

/** All legs of a trade: leg 1 lives in the top-level fields, then extraLegs. */
export function allLegs(values: TradeFormValues): TradeLeg[] {
  return [
    {
      strike: values.strike,
      optionType: values.optionType,
      direction: values.direction,
      qty: values.qty,
      avgEntry: values.avgEntry,
      avgExit: values.avgExit,
    },
    ...(values.extraLegs ?? []),
  ];
}

/**
 * Computes gross/charges/net/R for a trade form (totalled across all legs of
 * a multi-leg strategy). The trade is closed only when every leg has exited.
 */
export function deriveTradeNumbers(
  values: TradeFormValues,
  chargeProfileId: string
): DerivedNumbers {
  const legs = allLegs(values);
  if (legs.some((l) => l.avgExit == null)) {
    return { status: "open", gross: 0, charges: 0, net: 0, r: null };
  }
  const profile = getChargeProfile(chargeProfileId);
  let gross = 0;
  let charges = 0;
  for (const leg of legs) {
    gross += computeGrossPnl({
      direction: leg.direction,
      qty: leg.qty,
      entryPrice: leg.avgEntry,
      exitPrice: leg.avgExit!,
    });
    charges += computeCharges(profile, {
      segment: values.segment,
      product: values.product ?? null,
      qty: leg.qty,
      entryPrice: leg.avgEntry,
      exitPrice: leg.avgExit!,
      direction: leg.direction,
      commodityOption: values.segment === "COMM" && leg.optionType != null,
      agriCommodity: values.segment === "COMM" && classifyAgriCommodity(values.symbol),
      isOption: values.segment === "CDS" && leg.optionType != null,
    }).total;
  }
  gross = Math.round(gross * 100) / 100;
  charges = values.manualCharges != null ? values.manualCharges : Math.round(charges * 100) / 100;
  const net = Math.round((gross - charges) * 100) / 100;
  // R uses the per-trade plan against leg 1 (the anchor leg of the strategy).
  const r = computeRMultiple({
    direction: values.direction,
    entryPrice: values.avgEntry,
    exitPrice: values.avgExit!,
    plannedEntry: values.plannedEntry ?? null,
    plannedSl: values.plannedSl ?? null,
  });
  return { status: "closed", gross, charges, net, r };
}

/** datetime-local input value ("YYYY-MM-DDTHH:mm") → ISO string. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** ISO string → datetime-local input value in the user's timezone. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function nowLocalInput(): string {
  return isoToLocalInput(new Date().toISOString());
}
