"use client";

// SEG-09 — legible segment / product / exchange / holding-period chips, shared
// by the desktop table and the mobile cards so the journal surfaces the
// Segment×Product×Exchange matrix consistently. Reuses the semantic Badge
// tokens (no new colours), lucide icons only, terse text for 360px.

import { classifyHorizon } from "@/lib/stats/horizon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { defaultLotSize, exactLotCount, segmentUsesLots } from "@/lib/instruments/lot-sizes";
import { effectiveProduct, normalizeExchange, PRODUCT_SHORT, SEGMENT_SHORT } from "../grouping";
import type { TradeWithMeta } from "../types";

const HORIZON_SHORT: Record<"intraday" | "swing" | "positional", string> = {
  intraday: "Intraday",
  swing: "Swing",
  positional: "Positional",
};

/**
 * The segment / product / exchange / holding-period chips for one trade. The
 * exchange chip is omitted when it's the segment default (NSE for EQ/FUT/OPT/
 * CDS, MCX for COMM) to keep the row uncluttered — only a non-default exchange
 * (BSE, NCDEX) is worth surfacing. Pass `compact` on mobile to drop the holding
 * chip (cards already show the hold time).
 */
export function TradeMetaBadges({
  trade,
  compact = false,
  className,
}: {
  trade: TradeWithMeta;
  compact?: boolean;
  className?: string;
}) {
  const product = effectiveProduct(trade);
  const exchange = normalizeExchange(trade.segment, trade.exchange);
  const defaultExchange = trade.segment === "COMM" ? "MCX" : "NSE";
  const horizon = classifyHorizon(trade);

  // SEG-10 — surface "N lots" for a derivative whose stored qty is an exact
  // multiple of the reference lot size (never imply a misleading fractional
  // lot). Purely informational; the stored qty (units) is unchanged.
  const lotSize = segmentUsesLots(trade.segment)
    ? defaultLotSize(trade.symbol, trade.segment)
    : null;
  const lots = lotSize != null ? exactLotCount(trade.qty, lotSize) : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <Badge variant="secondary" className="font-money" data-segment={trade.segment}>
        {SEGMENT_SHORT[trade.segment]}
      </Badge>
      <Badge variant="outline" data-product={product} title={product}>
        {PRODUCT_SHORT[product]}
      </Badge>
      {exchange !== defaultExchange && (
        <Badge variant="outline" data-exchange={exchange}>
          {exchange}
        </Badge>
      )}
      {!compact && horizon && (
        <Badge variant="outline" className="text-muted" data-horizon={horizon}>
          {HORIZON_SHORT[horizon]}
        </Badge>
      )}
      {lots != null && (
        <Badge variant="outline" className="text-muted" data-lots={lots}>
          {lots} {lots === 1 ? "lot" : "lots"}
        </Badge>
      )}
    </div>
  );
}
