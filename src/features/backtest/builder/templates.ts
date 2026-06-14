/**
 * Outlook-grouped strategy templates for the Legs-step gallery (BT-06). Each
 * template returns a fresh set of legs at sensible ATM offsets; selecting one
 * fills the draft and round-trips through classifyStrategy to the right label.
 *
 * Pure factories (no IDs baked in beyond a stable per-leg suffix the store
 * re-keys), so they are deterministic and easy to unit test.
 */

import type { LegDef } from "./types";

export type TemplateOutlook = "Neutral" | "Bullish" | "Bearish" | "Volatile";

export interface StrategyTemplate {
  id: string;
  name: string;
  outlook: TemplateOutlook;
  blurb: string;
  /** Build the legs (caller assigns final ids). */
  legs: () => Omit<LegDef, "id">[];
}

const leg = (
  optionType: LegDef["optionType"],
  side: LegDef["side"],
  steps: number,
  lots = 1
): Omit<LegDef, "id"> => ({
  enabled: true,
  optionType,
  side,
  lots,
  strike: { mode: "ATM_OFFSET", steps },
  expiry: "WEEKLY",
  squareOff: "partial",
});

export const TEMPLATES: StrategyTemplate[] = [
  {
    id: "short-straddle",
    name: "Short Straddle",
    outlook: "Neutral",
    blurb: "Sell ATM call + put. Profits if price stays range-bound.",
    legs: () => [leg("CE", "sell", 0), leg("PE", "sell", 0)],
  },
  {
    id: "short-strangle",
    name: "Short Strangle",
    outlook: "Neutral",
    blurb: "Sell OTM call + put. Wider breakevens, lower credit.",
    legs: () => [leg("CE", "sell", 2), leg("PE", "sell", -2)],
  },
  {
    id: "iron-condor",
    name: "Iron Condor",
    outlook: "Neutral",
    blurb: "Sell an OTM strangle, buy further wings to cap risk.",
    legs: () => [
      leg("CE", "sell", 2),
      leg("CE", "buy", 4),
      leg("PE", "sell", -2),
      leg("PE", "buy", -4),
    ],
  },
  {
    id: "bull-call-spread",
    name: "Bull Call Spread",
    outlook: "Bullish",
    blurb: "Buy a near call, sell a higher call. Defined-risk bullish.",
    legs: () => [leg("CE", "buy", 0), leg("CE", "sell", 2)],
  },
  {
    id: "bull-put-spread",
    name: "Bull Put Spread",
    outlook: "Bullish",
    blurb: "Sell a near put, buy a lower put. Credit, bullish bias.",
    legs: () => [leg("PE", "sell", 0), leg("PE", "buy", -2)],
  },
  {
    id: "bear-call-spread",
    name: "Bear Call Spread",
    outlook: "Bearish",
    blurb: "Sell a near call, buy a higher call. Credit, bearish bias.",
    legs: () => [leg("CE", "sell", 0), leg("CE", "buy", 2)],
  },
  {
    id: "long-straddle",
    name: "Long Straddle",
    outlook: "Volatile",
    blurb: "Buy ATM call + put. Profits on a big move either way.",
    legs: () => [leg("CE", "buy", 0), leg("PE", "buy", 0)],
  },
  {
    id: "long-strangle",
    name: "Long Strangle",
    outlook: "Volatile",
    blurb: "Buy OTM call + put. Cheaper, needs a larger move.",
    legs: () => [leg("CE", "buy", 2), leg("PE", "buy", -2)],
  },
];

export const TEMPLATES_BY_ID: Record<string, StrategyTemplate> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t])
);

/** Templates grouped by outlook, in display order. */
export const TEMPLATE_OUTLOOKS: TemplateOutlook[] = ["Neutral", "Bullish", "Bearish", "Volatile"];

export function templatesByOutlook(outlook: TemplateOutlook): StrategyTemplate[] {
  return TEMPLATES.filter((t) => t.outlook === outlook);
}
