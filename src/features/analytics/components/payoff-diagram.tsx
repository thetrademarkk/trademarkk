"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatINR, formatNumber } from "@/lib/utils";
import {
  buildPayoffCurve,
  classifyStrategy,
  type LegShape,
  type PayoffLeg,
} from "@/lib/options/payoff";
import { payoffAriaSummary } from "../chart-aria";

/** Plot geometry (viewBox units; the SVG scales responsively via width=100%). */
const W = 640;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 28, left: 56 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export interface PayoffDiagramProps {
  /** Symbol for the title, e.g. "NIFTY". */
  symbol: string;
  /** Legs with premium = the entered avg_entry. */
  legs: PayoffLeg[];
}

/**
 * Payoff-at-expiry diagram for an options trade (single- or multi-leg). Pure
 * SVG over the closed-form intrinsic-value curve — no live data, no IV. Profit
 * region is tinted green, loss red; strikes, breakevens and max-profit/-loss
 * are marked. The premiums are exactly what the user entered.
 */
export function PayoffDiagram({ symbol, legs }: PayoffDiagramProps) {
  const usable = useMemo(
    () => legs.filter((l) => Number.isFinite(l.strike) && Number.isFinite(l.premium) && l.qty > 0),
    [legs]
  );
  const curve = useMemo(() => buildPayoffCurve(usable), [usable]);
  const label = useMemo(
    () =>
      classifyStrategy(
        usable.map(
          (l): LegShape => ({
            strike: l.strike,
            optionType: l.optionType,
            direction: l.direction,
            qty: l.qty,
          })
        )
      ),
    [usable]
  );

  if (usable.length === 0 || curve.points.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-muted" aria-hidden />
            Payoff at expiry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-sm text-muted">
            Add strike, option type and entry premium to plot the payoff.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { points, minUnderlying, maxUnderlying, breakevens, profitUnbounded, lossUnbounded } =
    curve;
  const xMin = minUnderlying;
  const xMax = maxUnderlying;
  const pnls = points.map((p) => p.pnl);
  const yMaxRaw = Math.max(0, ...pnls);
  const yMinRaw = Math.min(0, ...pnls);
  // Pad the value axis ~8% so the curve doesn't touch the frame.
  const yPad = Math.max(1, (yMaxRaw - yMinRaw) * 0.08);
  const yMax = yMaxRaw + yPad;
  const yMin = yMinRaw - yPad;

  const sx = (u: number) => PAD.left + ((u - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const sy = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const zeroY = sy(0);
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.underlying)},${sy(p.pnl)}`)
    .join(" ");
  // Fill the area between the curve and the zero line, clipped to profit/loss.
  const areaPath = `${linePath} L${sx(points[points.length - 1]!.underlying)},${zeroY} L${sx(points[0]!.underlying)},${zeroY} Z`;

  const strikes = [...new Set(usable.map((l) => l.strike))].sort((a, b) => a - b);

  // Display values: respect the unbounded flags from the math layer.
  const maxProfitLabel = profitUnbounded
    ? "Unlimited"
    : formatINR(curve.maxProfit, { signed: true });
  const maxLossLabel = lossUnbounded ? "Unlimited" : formatINR(curve.maxLoss, { signed: true });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-4 text-muted" aria-hidden />
          Payoff at expiry
        </CardTitle>
        <Badge variant="outline" data-strategy={label}>
          {label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label={payoffAriaSummary({
            symbol,
            strategy: label,
            maxProfit: maxProfitLabel,
            maxLoss: maxLossLabel,
            breakevens,
          })}
          data-testid="payoff-svg"
        >
          {/* Profit (above zero) and loss (below zero) tinted bands, clipped to the curve area. */}
          <defs>
            <clipPath id="payoff-area">
              <path d={areaPath} />
            </clipPath>
          </defs>
          {/* Green band over the profit half-plane, red over the loss half-plane. */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={Math.max(0, zeroY - PAD.top)}
            fill="var(--profit)"
            fillOpacity={0.14}
            clipPath="url(#payoff-area)"
          />
          <rect
            x={PAD.left}
            y={zeroY}
            width={PLOT_W}
            height={Math.max(0, PAD.top + PLOT_H - zeroY)}
            fill="var(--loss)"
            fillOpacity={0.14}
            clipPath="url(#payoff-area)"
          />

          {/* Zero P&L line. */}
          <line
            x1={PAD.left}
            x2={PAD.left + PLOT_W}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--border)"
            strokeWidth={1}
          />
          {/* Y-axis labels: max profit, zero, max loss. */}
          <text x={4} y={sy(yMaxRaw) + 4} fontSize={10} fill="var(--text-muted)">
            {formatINR(yMaxRaw)}
          </text>
          <text x={4} y={zeroY + 4} fontSize={10} fill="var(--text-muted)">
            ₹0
          </text>
          <text x={4} y={sy(yMinRaw) + 4} fontSize={10} fill="var(--text-muted)">
            {formatINR(yMinRaw, { signed: true })}
          </text>

          {/* Strike markers. */}
          {strikes.map((k) => (
            <g key={`k-${k}`}>
              <line
                x1={sx(k)}
                x2={sx(k)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke="var(--border)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text x={sx(k)} y={H - 8} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
                {formatNumber(k, 0)}
              </text>
            </g>
          ))}

          {/* Breakeven markers. */}
          {breakevens.map((be) => (
            <g key={`be-${be}`}>
              <circle cx={sx(be)} cy={zeroY} r={3.5} fill="var(--accent-solid)" />
            </g>
          ))}

          {/* The payoff curve itself. */}
          <path
            d={linePath}
            fill="none"
            stroke="var(--accent-solid)"
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </svg>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md border px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted">Max profit</div>
            <div className="font-money text-profit">{maxProfitLabel}</div>
          </div>
          <div className="rounded-md border px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted">Max loss</div>
            <div className="font-money text-loss">{maxLossLabel}</div>
          </div>
          <div className="rounded-md border px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted">
              Breakeven{breakevens.length === 1 ? "" : "s"}
            </div>
            <div className="font-money">
              {breakevens.length === 0
                ? "—"
                : breakevens.map((b) => formatNumber(b, 0)).join(" · ")}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted">
          At-expiry intrinsic value from your entered premiums — no volatility or live data. Each
          point sums every leg.
        </p>
      </CardContent>
    </Card>
  );
}
