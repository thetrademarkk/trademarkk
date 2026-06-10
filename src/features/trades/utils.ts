import { computeCharges, computeGrossPnl, computeRMultiple } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import type { TradeFormValues } from "./schemas";

export interface DerivedNumbers {
  status: "open" | "closed";
  gross: number;
  charges: number;
  net: number;
  r: number | null;
}

/** Computes gross/charges/net/R for a trade form. Open trades carry zeros until closed. */
export function deriveTradeNumbers(values: TradeFormValues, chargeProfileId: string): DerivedNumbers {
  if (values.avgExit == null) {
    return { status: "open", gross: 0, charges: 0, net: 0, r: null };
  }
  const gross = computeGrossPnl({
    direction: values.direction,
    qty: values.qty,
    entryPrice: values.avgEntry,
    exitPrice: values.avgExit,
  });
  const charges =
    values.manualCharges != null
      ? values.manualCharges
      : computeCharges(getChargeProfile(chargeProfileId), {
          segment: values.segment,
          qty: values.qty,
          entryPrice: values.avgEntry,
          exitPrice: values.avgExit,
          direction: values.direction,
        }).total;
  const net = Math.round((gross - charges) * 100) / 100;
  const r = computeRMultiple({
    direction: values.direction,
    entryPrice: values.avgEntry,
    exitPrice: values.avgExit,
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
