"use client";

import * as React from "react";
import {
  Coins,
  Download,
  FileSpreadsheet,
  Info,
  Landmark,
  Printer,
  Receipt,
  Scale,
} from "lucide-react";
import { useTrades, useAccounts } from "@/features/trades";
import { downloadFile } from "@/features/settings";
import { availableFyYears, currentFyStartYear, fyLabel, fyRange, fyStartYear } from "@/lib/tax/fy";
import {
  CG_LTCG_RATE_PCT,
  CG_RATE_EFFECTIVE_FROM,
  CG_STCG_RATE_PCT,
  chargesBreakdown,
  fyTaxSummary,
  type TaxTrade,
} from "@/lib/tax/turnover";
import { buildTaxCsv, toExcelCsv } from "@/lib/tax/csv";
import { formatINR, formatPct } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PnlText } from "@/components/shared/pnl-text";

const SEGMENT_LABEL: Record<string, string> = {
  EQ: "Equity",
  FUT: "Futures",
  OPT: "Options",
  COMM: "Commodity",
  CDS: "Currency",
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="micro-label">{label}</div>
      <div className="font-money text-sm">{children}</div>
    </div>
  );
}

/** A money cell formatted from paise-precise rupees, with the sign colour. */
function Money({ value, plain = false }: { value: number; plain?: boolean }) {
  if (plain) return <span className="font-money">{formatINR(value, { decimals: true })}</span>;
  return <PnlText value={value} signed={false} />;
}

export function TaxReportView() {
  // All closed trades across every FY, fetched once, computed client-side.
  const { data: trades = [] } = useTrades({});
  const { data: accounts = [] } = useAccounts();

  const closed = React.useMemo(
    () => trades.filter((t) => t.status === "closed" && t.closed_at) as unknown as TaxTrade[],
    [trades]
  );

  const profileForAccount = React.useCallback(
    (accountId: string) => {
      const acc = accounts.find((a) => a.id === accountId);
      return acc?.charge_profile ?? "zerodha";
    },
    [accounts]
  );

  const years = React.useMemo(() => availableFyYears(closed), [closed]);
  const [startYear, setStartYear] = React.useState<number>(() => currentFyStartYear());

  // Keep the selected year valid as data loads in.
  React.useEffect(() => {
    if (years.length && !years.includes(startYear)) setStartYear(years[0]!);
  }, [years, startYear]);

  const range = fyRange(startYear);
  const fyTrades = React.useMemo(
    () => closed.filter((t) => fyStartYear(t.closed_at!) === startYear),
    [closed, startYear]
  );

  const summary = React.useMemo(() => fyTaxSummary(fyTrades), [fyTrades]);
  const breakdown = React.useMemo(
    () => chargesBreakdown(fyTrades, profileForAccount),
    [fyTrades, profileForAccount]
  );

  const isEmpty = fyTrades.length === 0;

  const exportCsv = (excel: boolean) => {
    if (isEmpty) return;
    const csv = buildTaxCsv(startYear, fyTrades, breakdown);
    const body = excel ? toExcelCsv(csv) : csv;
    downloadFile(
      `trademarkk-tax-FY${fyLabel(startYear)}${excel ? "-excel" : ""}.csv`,
      body,
      "text/csv;charset=utf-8"
    );
  };

  return (
    <div className="space-y-4" data-print-section>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Select value={String(startYear)} onValueChange={(v) => setStartYear(Number(v))}>
          <SelectTrigger className="w-[150px]" aria-label="Financial year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                FY {fyLabel(y)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" disabled={isEmpty} onClick={() => exportCsv(false)}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" disabled={isEmpty} onClick={() => exportCsv(true)}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" disabled={isEmpty} onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> PDF / Print
          </Button>
        </div>
      </div>

      {/* Disclaimer — always visible, prints too. */}
      <div
        className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-muted"
        role="note"
      >
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
        <span>
          Informational only — <span className="font-medium">not tax advice</span>. Figures follow
          common ICAI turnover conventions and are computed from your journalled trades; verify with
          a qualified CA before filing. FY runs 1 Apr → 31 Mar (IST), grouped by close date.
        </span>
      </div>

      {isEmpty ? (
        <Card data-testid="tax-empty">
          <CardContent className="py-10 text-center text-sm text-muted">
            <Landmark className="mx-auto mb-2 h-6 w-6 text-muted" aria-hidden />
            No closed trades in FY {fyLabel(startYear)}.
            {years.length > 1 && " Pick another financial year above."}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Year summary */}
          <Card data-print-break={false}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Landmark className="h-4 w-4 text-muted" aria-hidden /> FY {fyLabel(startYear)}{" "}
                summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Closed trades">{summary.trades}</Stat>
                <Stat label="Gross P&L">
                  <Money value={summary.grossPnl} />
                </Stat>
                <Stat label="Charges">
                  <Money value={summary.charges} plain />
                </Stat>
                <Stat label="Net realised P&L">
                  <Money value={summary.netPnl} />
                </Stat>
                <Stat label="Charge drag (of gross)">{formatPct(summary.chargeDragPct, 1)}</Stat>
                <Stat label="Period">
                  <span className="text-xs text-muted">
                    {range.from} → {range.to}
                  </span>
                </Stat>
              </div>
            </CardContent>
          </Card>

          {/* Three-way income classification */}
          <Card data-testid="tax-classification">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Scale className="h-4 w-4 text-muted" aria-hidden /> Income classification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted">
                Three heads of income: <span className="font-medium">speculative</span> (intraday
                equity), <span className="font-medium">non-speculative business</span> (F&amp;O,
                commodity &amp; currency) and <span className="font-medium">capital gains</span>{" "}
                (delivery equity).
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted">
                      <th className="py-1.5 pr-2 font-medium">Head of income</th>
                      <th className="py-1.5 px-2 text-right font-medium">Trades</th>
                      <th className="py-1.5 px-2 text-right font-medium">Gross P&amp;L</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      {
                        key: "speculative",
                        label: "Speculative (intraday equity)",
                        b: summary.buckets.speculative,
                      },
                      {
                        key: "business",
                        label: "Non-speculative business (F&O / commodity / currency)",
                        b: summary.buckets.nonSpeculativeBusiness,
                      },
                      {
                        key: "capital-gains",
                        label: "Capital gains (delivery equity)",
                        b: summary.buckets.capitalGains,
                      },
                    ].map(({ key, label, b }) => (
                      <tr key={key} data-bucket={key} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">{label}</td>
                        <td className="py-1.5 px-2 text-right font-money" data-bucket-trades>
                          {b.trades}
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <Money value={b.grossPnl} />
                        </td>
                        <td className="py-1.5 pl-2 text-right" data-bucket-net>
                          <Money value={b.netPnl} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Capital gains — STCG / LTCG */}
          <Card data-testid="tax-capital-gains">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Coins className="h-4 w-4 text-muted" aria-hidden /> Capital gains — STCG / LTCG
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary.buckets.cg.trades === 0 ? (
                <p className="text-sm text-muted">
                  No realised delivery-equity (CNC) trades in this FY.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    Realised gains on delivery equity, split by holding period:{" "}
                    <span className="font-medium">STCG</span> when held ≤ 12 months,{" "}
                    <span className="font-medium">LTCG</span> when held &gt; 12 months. Open
                    positions are excluded (unrealised).
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted">
                          <th className="py-1.5 pr-2 font-medium">Term</th>
                          <th className="py-1.5 px-2 text-right font-medium">Trades</th>
                          <th className="py-1.5 px-2 text-right font-medium">Gross P&amp;L</th>
                          <th className="py-1.5 pl-2 text-right font-medium">Net P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr data-cg="stcg" className="border-b">
                          <td className="py-1.5 pr-2">STCG (held ≤ 12 months)</td>
                          <td className="py-1.5 px-2 text-right font-money" data-cg-trades>
                            {summary.buckets.cg.shortTerm.trades}
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            <Money value={summary.buckets.cg.shortTerm.grossPnl} />
                          </td>
                          <td className="py-1.5 pl-2 text-right" data-cg-net>
                            <Money value={summary.buckets.cg.shortTerm.netPnl} />
                          </td>
                        </tr>
                        <tr data-cg="ltcg" className="border-b last:border-0">
                          <td className="py-1.5 pr-2">LTCG (held &gt; 12 months)</td>
                          <td className="py-1.5 px-2 text-right font-money" data-cg-trades>
                            {summary.buckets.cg.longTerm.trades}
                          </td>
                          <td className="py-1.5 px-2 text-right">
                            <Money value={summary.buckets.cg.longTerm.grossPnl} />
                          </td>
                          <td className="py-1.5 pl-2 text-right" data-cg-net>
                            <Money value={summary.buckets.cg.longTerm.netPnl} />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span data-cg-exemption>
                        LTCG yearly exemption:{" "}
                        <span className="font-money text-foreground">
                          {formatINR(summary.buckets.cg.ltcgExemption, { decimals: true })}
                        </span>
                      </span>
                      <span>
                        LTCG net after exemption:{" "}
                        <span className="font-money text-foreground">
                          {formatINR(summary.buckets.cg.ltcgTaxableAfterExemption, {
                            decimals: true,
                          })}
                        </span>
                      </span>
                    </div>
                    <p className="mt-2">
                      Informational rate labels ({CG_RATE_EFFECTIVE_FROM} onward, listed equity):{" "}
                      <span className="font-medium text-foreground">STCG {CG_STCG_RATE_PCT}%</span>{" "}
                      ·{" "}
                      <span className="font-medium text-foreground">LTCG {CG_LTCG_RATE_PCT}%</span>{" "}
                      above the ₹1.25L exemption. These are a classification &amp; realised-gains
                      statement — <span className="font-medium">not</span> a tax-liability
                      computation. Verify with a CA.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* F&O / commodity / currency turnover statement */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Receipt className="h-4 w-4 text-muted" aria-hidden /> F&amp;O / commodity /
                currency turnover statement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary.turnover.trades === 0 ? (
                <p className="text-sm text-muted">
                  No futures, options, commodity or currency trades in this FY.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <Stat label="Derivative trades">{summary.turnover.trades}</Stat>
                    <Stat label="Turnover (abs-profit)">
                      <Money value={summary.turnover.absoluteProfitTurnover} plain />
                    </Stat>
                    <Stat label="Net realised P&L">
                      <Money value={summary.turnover.netRealised} />
                    </Stat>
                    <Stat label="Total profit">
                      <Money value={summary.turnover.totalProfit} plain />
                    </Stat>
                    <Stat label="Total loss">
                      <Money value={summary.turnover.totalLoss} plain />
                    </Stat>
                  </div>
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted">
                    <div className="mb-1 font-medium text-foreground">Alternate conventions</div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1">
                      <span>
                        Notional / contract turnover:{" "}
                        <span className="font-money text-foreground">
                          {formatINR(summary.turnover.notionalTurnover, { decimals: true })}
                        </span>
                      </span>
                      <span>
                        Sell-side turnover:{" "}
                        <span className="font-money text-foreground">
                          {formatINR(summary.turnover.sellTurnover, { decimals: true })}
                        </span>
                      </span>
                    </div>
                    <p className="mt-1">
                      The abs-profit figure is the ICAI Guidance-Note convention used for the audit
                      / presumptive-tax thresholds.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Charges breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Receipt className="h-4 w-4 text-muted" aria-hidden /> Charges breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted">
                Total charges of{" "}
                <span className="font-money text-foreground">
                  {formatINR(breakdown.actualTotal, { decimals: true })}
                </span>{" "}
                ({formatPct(summary.chargeDragPct, 1)} drag on gross).{" "}
                {breakdown.estimated && (
                  <span>
                    Component split is <span className="font-medium">estimated</span> from your
                    broker charge profile (we store an aggregate per trade) and scaled to the actual
                    total.
                  </span>
                )}
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                {[
                  ["Brokerage", breakdown.brokerage],
                  ["STT / CTT", breakdown.stt],
                  ["Exchange txn", breakdown.exchange],
                  ["SEBI fee", breakdown.sebi],
                  ["GST", breakdown.gst],
                  ["Stamp duty", breakdown.stampDuty],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-center justify-between text-sm">
                    <span className="text-muted">
                      {label as string}
                      {breakdown.estimated && <span className="text-[10px]">*</span>}
                    </span>
                    <span className="font-money">
                      {formatINR(value as number, { decimals: true })}
                    </span>
                  </div>
                ))}
              </div>
              {breakdown.estimated && (
                <p className="text-[10px] text-muted">* estimated component (aggregate is exact)</p>
              )}
            </CardContent>
          </Card>

          {/* Realised P&L by instrument */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Landmark className="h-4 w-4 text-muted" aria-hidden /> Realised P&amp;L by
                instrument
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted">
                      <th className="py-1.5 pr-2 font-medium">Instrument</th>
                      <th className="py-1.5 px-2 text-right font-medium">Trades</th>
                      <th className="hidden py-1.5 px-2 text-right font-medium sm:table-cell">
                        Buy value
                      </th>
                      <th className="hidden py-1.5 px-2 text-right font-medium sm:table-cell">
                        Sell value
                      </th>
                      <th className="py-1.5 px-2 text-right font-medium">Charges</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byInstrument.map((r) => (
                      <tr key={`${r.symbol}-${r.segment}`} className="border-b last:border-0">
                        <td className="py-1.5 pr-2">
                          <span className="font-medium">{r.symbol}</span>{" "}
                          <span className="text-xs text-muted">
                            {SEGMENT_LABEL[r.segment] ?? r.segment}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-money">{r.trades}</td>
                        <td className="hidden py-1.5 px-2 text-right font-money sm:table-cell">
                          {formatINR(r.buyValue, { decimals: true })}
                        </td>
                        <td className="hidden py-1.5 px-2 text-right font-money sm:table-cell">
                          {formatINR(r.sellValue, { decimals: true })}
                        </td>
                        <td className="py-1.5 px-2 text-right font-money">
                          {formatINR(r.charges, { decimals: true })}
                        </td>
                        <td className="py-1.5 pl-2 text-right">
                          <Money value={r.netPnl} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
