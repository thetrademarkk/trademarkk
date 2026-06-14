import { describe, expect, it } from "vitest";
import { buildTaxCsv, csvCell, toExcelCsv } from "./csv";
import { chargesBreakdown, type TaxTrade } from "./turnover";

let seq = 0;
function mk(over: Partial<TaxTrade> = {}): TaxTrade {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "acc1",
    symbol: "NIFTY",
    segment: "OPT",
    direction: "long",
    qty: 75,
    avg_entry: 100,
    avg_exit: 120,
    opened_at: "2025-06-10T04:00:00Z",
    closed_at: "2025-06-10T09:00:00Z",
    gross_pnl: 1500,
    charges: 50,
    net_pnl: 1450,
    ...over,
  };
}

describe("csvCell", () => {
  it("quotes fields with commas, quotes or newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
});

describe("buildTaxCsv", () => {
  const trades = [
    mk({ symbol: "NIFTY", segment: "OPT", net_pnl: 1450, gross_pnl: 1500, charges: 50 }),
    mk({
      symbol: "RELIANCE",
      segment: "EQ",
      opened_at: "2025-07-01T04:00:00Z",
      closed_at: "2025-07-01T09:00:00Z",
      avg_entry: 2900,
      avg_exit: 2950,
      qty: 10,
      gross_pnl: 500,
      charges: 30,
      net_pnl: 470,
    }),
  ];
  const breakdown = chargesBreakdown(trades, () => "zerodha");
  const csv = buildTaxCsv(2025, trades, breakdown);

  it("includes the FY label and the disclaimer", () => {
    expect(csv).toContain("FY 2025-26");
    expect(csv.toLowerCase()).toContain("not tax advice");
  });

  it("emits every section header", () => {
    for (const section of [
      "Summary",
      "Income classification (three-way)",
      "Capital gains — STCG / LTCG (delivery equity)",
      "F&O / commodity / currency turnover statement",
      "Charges breakdown",
      "Realised P&L by instrument",
      "Trade ledger",
    ]) {
      expect(csv).toContain(section);
    }
  });

  it("parses into rows and keeps money at two decimals", () => {
    const rows = csv.split("\r\n");
    expect(rows.length).toBeGreaterThan(20);
    // Net realised P&L summary line: 1450 + 470 = 1920.00
    const netLine = rows.find((r) => r.startsWith("Net realised P&L (INR)"));
    expect(netLine).toContain("1920.00");
    // The ledger has a row per trade — RELIANCE classified Speculative (intraday EQ).
    // (Match the ledger row, not the by-instrument row, via the open-date prefix.)
    const relLedgerLine = rows.find((r) => r.startsWith("2025-07-01") && r.includes("RELIANCE"));
    expect(relLedgerLine).toContain("Speculative");
  });

  it("uses CRLF line endings (Excel-friendly)", () => {
    expect(csv).toContain("\r\n");
  });
});

describe("toExcelCsv", () => {
  it("prepends a BOM and sep hint", () => {
    const out = toExcelCsv("a,b\r\n1,2");
    expect(out.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(out).toContain("sep=,");
    expect(out).toContain("a,b");
  });
});
