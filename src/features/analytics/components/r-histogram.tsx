"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { rHistogram, type TradeLike } from "@/lib/stats/stats";

export function RHistogram({ trades }: { trades: TradeLike[] }) {
  const data = rHistogram(trades);
  return (
    <Card>
      <CardHeader><CardTitle>R-multiple distribution</CardTitle></CardHeader>
      <CardContent className="h-52">
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-muted">
            Set stop losses on trades to build the R distribution.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "var(--text-muted)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={28} />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="count" fill="var(--accent)" fillOpacity={0.85} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
