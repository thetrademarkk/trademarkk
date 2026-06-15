"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rHistogram, type TradeLike } from "@/lib/stats/stats";
import { rHistogramAriaSummary } from "../chart-aria";
import { cn } from "@/lib/utils";

/** Strip the ≤/≥ prefix so "≤ -2R" / "≥ 3R" still parse to a signed number. */
function bucketSign(bucket: string): boolean {
  const r = parseFloat(bucket.replace("≤", "").replace("≥", ""));
  return !(r < 0); // ≥ 0R counts as a win bucket
}

export function RHistogram({ trades }: { trades: TradeLike[] }) {
  const data = rHistogram(trades);
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle>R-multiple distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="flex h-52 items-center justify-center text-center text-sm text-muted">
            Set stop losses on trades to build the R distribution.
          </p>
        ) : (
          <div
            className="flex h-52 items-end gap-1.5"
            role="img"
            aria-label={rHistogramAriaSummary(data)}
          >
            {data.map((d) => {
              const pos = bucketSign(d.bucket);
              const hPct = (d.count / max) * 100;
              return (
                <div
                  key={d.bucket}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                >
                  <span className="font-money text-[10px] text-muted">{d.count || ""}</span>
                  <div
                    className={cn(
                      "w-full origin-bottom rounded-t-[5px] motion-safe:animate-grow-y",
                      pos
                        ? "bg-gradient-to-t from-profit to-profit/55"
                        : "bg-gradient-to-t from-loss to-loss/55"
                    )}
                    style={{ height: `${Math.max(hPct, d.count ? 4 : 0)}%` }}
                  />
                  <span className="font-money text-[10px] text-muted">{d.bucket}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
