"use client";

import * as React from "react";
import { formatINR, formatNumber } from "@/lib/utils";
import type { PayoffSummary } from "@/features/backtest/builder/payoff-rail";

/** Plot geometry (viewBox units; the SVG scales responsively to width=100%). */
const W = 560;
const H = 240;
const PAD = { top: 14, right: 14, bottom: 26, left: 54 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export interface PayoffChartProps {
  summary: PayoffSummary;
  /** Optional overall SL/Target rupee guide-lines (Step 4 anchors them visually). */
  guides?: { target?: number; stopLoss?: number };
  /** Compact mode renders a smaller chart (mobile sparkline / sheet header). */
  className?: string;
  height?: number;
}

/**
 * The live payoff-at-expiry diagram for the builder rail. Pure SVG over the
 * existing closed-form curve (buildPayoffCurve). Profit band tinted profit,
 * loss band loss; strikes, breakevens and the zero line are marked. Optional
 * horizontal guide-lines anchor the overall SL/Target to the same axis. Honors
 * reduced-motion implicitly (no animation here; the rail morphs via CSS).
 */
export function PayoffChart({ summary, guides, className, height = H }: PayoffChartProps) {
  const { curve, label } = summary;
  const points = curve.points;

  if (points.length < 2) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded-lg border border-dashed bg-surface/40 text-center text-xs text-muted"
        data-testid="bt-payoff-empty"
      >
        Add a leg with a strike to see the live payoff.
      </div>
    );
  }

  const xMin = curve.minUnderlying;
  const xMax = curve.maxUnderlying;
  const pnls = points.map((p) => p.pnl);
  const guideVals = [guides?.target, guides?.stopLoss && -Math.abs(guides.stopLoss)].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v)
  );
  const yMaxRaw = Math.max(0, ...pnls, ...guideVals);
  const yMinRaw = Math.min(0, ...pnls, ...guideVals);
  const yPad = Math.max(1, (yMaxRaw - yMinRaw) * 0.08);
  const yMax = yMaxRaw + yPad;
  const yMin = yMinRaw - yPad;

  const sx = (u: number) => PAD.left + ((u - xMin) / (xMax - xMin || 1)) * PLOT_W;
  const sy = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const zeroY = sy(0);
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.underlying).toFixed(1)},${sy(p.pnl).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${sx(points[points.length - 1]!.underlying).toFixed(1)},${zeroY.toFixed(1)} L${sx(points[0]!.underlying).toFixed(1)},${zeroY.toFixed(1)} Z`;

  const strikes = [...new Set(summary.legs.map((l) => l.strike))].sort((a, b) => a - b);
  const scaledH = (height / H) * H; // viewBox stays constant; height controls box

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className ?? "h-auto w-full"}
      style={height !== H ? { height: scaledH } : undefined}
      role="img"
      aria-label={`${label} payoff at expiry`}
      data-testid="bt-payoff-svg"
      data-strategy={label}
    >
      <defs>
        <clipPath id="bt-payoff-area">
          <path d={areaPath} />
        </clipPath>
      </defs>
      {/* Profit (above zero) + loss (below zero) bands, clipped to the curve. */}
      <rect
        x={PAD.left}
        y={PAD.top}
        width={PLOT_W}
        height={Math.max(0, zeroY - PAD.top)}
        fill="var(--profit)"
        fillOpacity={0.14}
        clipPath="url(#bt-payoff-area)"
      />
      <rect
        x={PAD.left}
        y={zeroY}
        width={PLOT_W}
        height={Math.max(0, PAD.top + PLOT_H - zeroY)}
        fill="var(--loss)"
        fillOpacity={0.14}
        clipPath="url(#bt-payoff-area)"
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

      {/* Y-axis labels (mono ticks — the TAPE numeric face). */}
      <text
        x={4}
        y={sy(yMaxRaw) + 4}
        fontSize={10}
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
      >
        {formatINR(yMaxRaw)}
      </text>
      <text
        x={4}
        y={zeroY + 4}
        fontSize={10}
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
      >
        ₹0
      </text>
      <text
        x={4}
        y={sy(yMinRaw) + 4}
        fontSize={10}
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
      >
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
          <text
            x={sx(k)}
            y={H - 8}
            fontSize={9}
            fill="var(--text-muted)"
            fontFamily="var(--font-mono)"
            textAnchor="middle"
          >
            {formatNumber(k, 0)}
          </text>
        </g>
      ))}

      {/* Risk guide-lines (Step 4 anchors SL/Target to the same axis). */}
      {typeof guides?.target === "number" && guides.target > 0 && (
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={sy(guides.target)}
          y2={sy(guides.target)}
          stroke="var(--profit)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
      {typeof guides?.stopLoss === "number" && guides.stopLoss > 0 && (
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={sy(-Math.abs(guides.stopLoss))}
          y2={sy(-Math.abs(guides.stopLoss))}
          stroke="var(--loss)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}

      {/* Breakeven dots. */}
      {curve.breakevens.map((be) => (
        <circle key={`be-${be}`} cx={sx(be)} cy={zeroY} r={3.5} fill="var(--accent-solid)" />
      ))}

      {/* The payoff curve. */}
      <path
        d={linePath}
        fill="none"
        stroke="var(--accent-solid)"
        strokeWidth={2}
        strokeLinejoin="round"
        style={{ transition: "d 220ms cubic-bezier(0,0,0.2,1)" }}
      />
    </svg>
  );
}
