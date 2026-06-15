"use client";

import { Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ring } from "@/components/shared/ring";
import { PnlText } from "@/components/shared/pnl-text";
import { useAdherence } from "../queries";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

/**
 * Headline rule-adherence card: a fill-in ring (% of checks followed) beside the
 * followed / broken counts, the ₹ cost of broken-rule days, and the most-broken
 * rule. Renders nothing until at least one rule check is logged in the range, so
 * it never shows an empty 100% on a fresh journal.
 */
export function AdherenceRingCard({ from, to }: { from: string | null; to: string | null }) {
  const { data } = useAdherence(from, to);
  if (!data || data.rules.length === 0) return null;

  const followed = data.rules.reduce((s, r) => s + r.followed, 0);
  const broken = data.rules.reduce((s, r) => s + r.broken, 0);
  if (followed + broken === 0) return null;

  const cost = data.rules.reduce((s, r) => s + r.brokenDayCost, 0);
  const mostBroken = data.rules.reduce((a, b) => (b.broken > a.broken ? b : a));
  const pct = data.overallPct * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-muted" aria-hidden /> Adherence
        </CardTitle>
        <p className="text-xs text-muted">This period</p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-5">
          <Ring
            value={pct}
            label={`${Math.round(pct)}%`}
            sub="followed"
            size={104}
            stroke={9}
            color="var(--profit)"
          />
          <dl className="grid flex-1 gap-2.5 text-sm">
            <Row label="Rules followed">
              <span className="font-money font-semibold text-profit">{followed}</span>
            </Row>
            <Row label="Rules broken">
              <span className="font-money font-semibold text-loss">{broken}</span>
            </Row>
            <Row label="Cost of breaks">
              <PnlText value={cost} className="text-sm font-semibold" />
            </Row>
            <Row label="Most broken">
              <span className="max-w-[55%] truncate font-medium text-warning">
                {mostBroken.broken > 0 ? mostBroken.rule.text : "—"}
              </span>
            </Row>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}
