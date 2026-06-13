"use client";

import { useMemo } from "react";
import { formatNumber } from "@/lib/utils";
import type { ConeBand } from "@/lib/montecarlo/simulate";

/**
 * Plain-SVG equity cone (no recharts). Draws three nested bands —
 * p5–p95 (outer), p25–p75 (inner) and the p50 median line — over the trade
 * horizon, plus a dotted "start equity" baseline. Pure rendering: the
 * component scales the bands into a fixed viewBox and is fully responsive via
 * width="100%". No animation, so e2e never has to wait on a transition.
 */
export function EquityCone({ cone, startEquity }: { cone: ConeBand[]; startEquity: number }) {
  const W = 720;
  const H = 280;
  const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const geom = useMemo(() => {
    const steps = cone.length;
    const maxStep = Math.max(1, steps - 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of cone) {
      if (b.p5 < lo) lo = b.p5;
      if (b.p95 > hi) hi = b.p95;
    }
    if (startEquity < lo) lo = startEquity;
    if (startEquity > hi) hi = startEquity;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
      lo = startEquity - 1;
      hi = startEquity + 1;
    }
    const pad = (hi - lo) * 0.05;
    lo -= pad;
    hi += pad;

    const x = (step: number) => PAD.left + (step / maxStep) * plotW;
    const y = (val: number) => PAD.top + (1 - (val - lo) / (hi - lo)) * plotH;

    // Build a closed area path between an upper and a lower percentile series.
    const band = (upper: (b: ConeBand) => number, lower: (b: ConeBand) => number) => {
      const top = cone.map((b) => `${x(b.step).toFixed(1)},${y(upper(b)).toFixed(1)}`);
      const bottom = cone
        .slice()
        .reverse()
        .map((b) => `${x(b.step).toFixed(1)},${y(lower(b)).toFixed(1)}`);
      return `M${top.join(" L")} L${bottom.join(" L")} Z`;
    };

    const line = (val: (b: ConeBand) => number) =>
      cone
        .map((b, i) => `${i === 0 ? "M" : "L"}${x(b.step).toFixed(1)},${y(val(b)).toFixed(1)}`)
        .join(" ");

    // Y-axis ticks (5 evenly spaced).
    const ticks = Array.from({ length: 5 }, (_, i) => {
      const v = lo + ((hi - lo) * i) / 4;
      return { v, y: y(v) };
    });

    return {
      outer: band(
        (b) => b.p95,
        (b) => b.p5
      ),
      inner: band(
        (b) => b.p75,
        (b) => b.p25
      ),
      median: line((b) => b.p50),
      baselineY: y(startEquity),
      ticks,
      maxStep,
      x,
    };
  }, [cone, startEquity, plotW, plotH, PAD.left, PAD.top]);

  return (
    <div className="max-w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Monte Carlo equity cone — projected equity percentile bands over the trade horizon"
        data-testid="equity-cone"
        className="min-w-[320px]"
      >
        {/* Y grid + labels */}
        {geom.ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <text
              x={PAD.left - 6}
              y={t.y + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--text-muted)"
            >
              {formatNumber(t.v, 0)}R
            </text>
          </g>
        ))}

        {/* Start-equity baseline */}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={geom.baselineY}
          y2={geom.baselineY}
          stroke="var(--text-muted)"
          strokeDasharray="2 4"
          strokeWidth={1}
        />

        {/* p5–p95 outer band */}
        <path d={geom.outer} fill="var(--accent)" fillOpacity={0.12} stroke="none" />
        {/* p25–p75 inner band */}
        <path d={geom.inner} fill="var(--accent)" fillOpacity={0.22} stroke="none" />
        {/* p50 median line */}
        <path
          d={geom.median}
          fill="none"
          stroke="var(--accent-solid)"
          strokeWidth={2}
          strokeLinejoin="round"
        />

        {/* X labels: start and end */}
        <text x={PAD.left} y={H - 8} textAnchor="start" fontSize="10" fill="var(--text-muted)">
          0
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end" fontSize="10" fill="var(--text-muted)">
          {geom.maxStep} trades
        </text>
      </svg>
    </div>
  );
}
