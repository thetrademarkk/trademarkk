/**
 * Trader-type profile (SEG-08) — pure, no I/O.
 *
 * Onboarding asks the user what kind of Indian trader they are. The answer is
 * persisted as a single additive `settings` row and used to:
 *   1. seed the trade-form's DEFAULT segment + product (the user can always
 *      change it per trade);
 *   2. bias the adaptive dashboard's emphasis (SEG-06 `dashboardEmphasis`) as a
 *      RUNTIME DEFAULT, used only until enough real trades exist to read the
 *      style from the data;
 *   3. parameterise the "Explore with sample data" seed so the demo trades match
 *      the chosen type (a swing trader gets multi-day CNC equity, an F&O trader
 *      gets multi-leg OPT, a commodity trader gets MCX futures, etc.).
 *
 * Everything here is client-side, paise-irrelevant (it only chooses defaults),
 * runs identically across hosted / BYOD / local, and uses no market data.
 */
import type { Segment, Product } from "@/lib/charges/charges";
import type { DashboardEmphasis } from "@/lib/stats/horizon";

/** The trader types offered by onboarding. `mixed` is the skip/neutral default. */
export type TraderType = "intraday-equity" | "swing" | "fno" | "commodity" | "currency" | "mixed";

export const TRADER_TYPES: readonly TraderType[] = [
  "intraday-equity",
  "swing",
  "fno",
  "commodity",
  "currency",
  "mixed",
] as const;

/** The neutral default chosen when onboarding is skipped. */
export const DEFAULT_TRADER_TYPE: TraderType = "mixed";

/** Trade-form defaults a trader type implies. */
export interface TraderDefaults {
  segment: Segment;
  product: Product;
}

/**
 * The default (segment, product) each trader type maps to. These seed the
 * trade form — the user can change them on any individual trade.
 *  - Intraday equity → EQ + MIS
 *  - Swing & positional → EQ + CNC (delivery, held overnight)
 *  - F&O → OPT + NRML
 *  - Commodity (MCX/NCDEX) → COMM + NRML
 *  - Currency → CDS + NRML
 *  - Mixed → EQ + MIS (the app-wide neutral default)
 */
const DEFAULTS: Record<TraderType, TraderDefaults> = {
  "intraday-equity": { segment: "EQ", product: "MIS" },
  swing: { segment: "EQ", product: "CNC" },
  fno: { segment: "OPT", product: "NRML" },
  commodity: { segment: "COMM", product: "NRML" },
  currency: { segment: "CDS", product: "NRML" },
  mixed: { segment: "EQ", product: "MIS" },
};

export function traderTypeDefaults(type: TraderType): TraderDefaults {
  return DEFAULTS[type] ?? DEFAULTS[DEFAULT_TRADER_TYPE];
}

/**
 * The dashboard emphasis a trader type implies, used as the RUNTIME DEFAULT
 * before the journal has enough trades to read the style from the data. Mirrors
 * SEG-06: intraday-equity leans `intraday`; swing/positional and the
 * carry-forward derivative books (F&O/commodity/currency are predominantly held
 * overnight) lean `positional`; `mixed` stays `balanced` (hides nothing).
 */
const EMPHASIS: Record<TraderType, DashboardEmphasis> = {
  "intraday-equity": "intraday",
  swing: "positional",
  fno: "positional",
  commodity: "positional",
  currency: "positional",
  mixed: "balanced",
};

export function dashboardEmphasisForTraderType(type: TraderType): DashboardEmphasis {
  return EMPHASIS[type] ?? "balanced";
}

/** Persisted trader profile (additive `settings` JSON). */
export interface TraderProfile {
  traderType: TraderType;
}

export const DEFAULT_TRADER_PROFILE: TraderProfile = { traderType: DEFAULT_TRADER_TYPE };

/**
 * Clamps untrusted persisted JSON into a valid {@link TraderProfile} (never
 * throws). An unknown/legacy/garbage value degrades to the `mixed` default, so
 * the app behaves exactly as it did before SEG-08 for anyone who never picked.
 */
export function sanitizeTraderProfile(raw: unknown): TraderProfile {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_TRADER_PROFILE };
  const o = raw as Record<string, unknown>;
  const t = o.traderType;
  if (typeof t === "string" && (TRADER_TYPES as readonly string[]).includes(t)) {
    return { traderType: t as TraderType };
  }
  return { ...DEFAULT_TRADER_PROFILE };
}

/** The `settings` table key holding the trader profile (additive, idempotent). */
export const TRADER_PROFILE_KEY = "trader_profile.v1";
