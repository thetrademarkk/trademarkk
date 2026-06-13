import { cn } from "@/lib/utils";
import {
  VITAL_THRESHOLDS,
  formatVitalValue,
  type VitalMetric,
  type VitalSummary,
} from "@/lib/pulse-stats";

/**
 * Field web-vitals cards — server-rendered, pure display. Shows the P75 of
 * real-visit samples with Google's rating thresholds drawn as a scale so the
 * number has context. Honest empty state while samples accumulate.
 */
const META: Record<VitalMetric, { name: string; desc: string }> = {
  LCP: { name: "Largest Contentful Paint", desc: "how fast the main content appears" },
  INP: { name: "Interaction to Next Paint", desc: "how quickly the page reacts to input" },
  CLS: { name: "Cumulative Layout Shift", desc: "how visually stable the page is" },
  FCP: { name: "First Contentful Paint", desc: "time to the first content on screen" },
  TTFB: { name: "Time to First Byte", desc: "server response time" },
};

const RATING_STYLES = {
  good: { label: "Good", className: "border-profit/40 bg-profit/10 text-profit" },
  "needs-improvement": {
    label: "Needs work",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  poor: { label: "Poor", className: "border-loss/40 bg-loss/10 text-loss" },
} as const;

function ThresholdScale({ metric, value }: { metric: VitalMetric; value: number }) {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  const max = poor * 1.5;
  const pos = Math.min(value / max, 1) * 100;
  return (
    <div className="relative mt-3" aria-hidden>
      <div className="flex h-1.5 overflow-hidden rounded-full">
        <div className="bg-profit/45" style={{ width: `${(good / max) * 100}%` }} />
        <div className="bg-warning/45" style={{ width: `${((poor - good) / max) * 100}%` }} />
        <div className="flex-1 bg-loss/45" />
      </div>
      <div
        className="absolute -top-[3px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-bg bg-foreground shadow"
        style={{ left: `${pos}%` }}
      />
    </div>
  );
}

export function VitalCards({ vitals }: { vitals: VitalSummary[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {vitals.map((v) => {
        const meta = META[v.metric];
        const rating = v.rating ? RATING_STYLES[v.rating] : null;
        return (
          <div
            key={v.metric}
            data-vital={v.metric}
            className="rounded-xl border bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{v.metric}</p>
              {rating ? (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    rating.className
                  )}
                >
                  {rating.label}
                </span>
              ) : (
                <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted">
                  Collecting
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {meta.name} — {meta.desc}.
            </p>
            {v.p75 !== null ? (
              <>
                <p className="mt-3 font-money text-2xl font-bold">
                  {formatVitalValue(v.metric, v.p75)}
                  <span className="ml-1.5 text-xs font-normal text-muted">P75</span>
                </p>
                <ThresholdScale metric={v.metric} value={v.p75} />
                <p className="mt-2 text-[11px] text-muted">
                  {v.samples.toLocaleString("en-IN")} real-visit samples · 30 days
                </p>
              </>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted">
                No field samples yet — collection just started.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
