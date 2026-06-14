import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Free TradeZella alternative for Indian traders",
  description:
    "TradeMarkk is a free, open-source TradeZella alternative built for Indian FnO & intraday traders — with Indian charges, broker imports, and your-own-database privacy.",
  alternates: { canonical: "/compare/tradezella-alternative" },
  // Match og:url to the route's canonical (relative — metadataBase resolves it)
  // so it doesn't inherit the homepage url; the branded card image still comes
  // from the root layout's explicit openGraph.images.
  openGraph: { url: "/compare/tradezella-alternative" },
};

const ROWS: [string, string, string][] = [
  ["Price", "Free, open source (MIT)", "Paid subscription (USD)"],
  [
    "Made for Indian FnO",
    "✓ NIFTY/BANKNIFTY strikes, lot sizes, STT/GST/stamp duty",
    "✗ US-centric",
  ],
  ["Broker imports", "Zerodha, Upstox, Angel One, Dhan, Fyers, Groww CSVs", "US brokers"],
  ["Data ownership", "Your own database (BYOD) or isolated hosted DB", "Their cloud only"],
  ["Rules engine", "Daily checklist + ₹ cost of broken rules", "Basic"],
  ["Self-hosting", "✓ One-click Vercel deploy", "✗"],
  ["Mobile", "Installable PWA", "Web app"],
];

export default function ComparePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <h1 className="text-3xl font-bold">Looking for a free TradeZella alternative?</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        TradeZella is a polished journal — built for US markets at a US price. If you trade NIFTY
        options from India, TradeMarkk gives you the journaling loop that matters (trades, mistakes,
        rules, reviews) for free, with Indian charges and brokers built in, and your data in your
        own database.
      </p>
      <div className="mt-8 overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-surface">
              <th className="px-4 py-2 text-left font-semibold"></th>
              <th className="px-4 py-2 text-left font-semibold text-accent">TradeMarkk</th>
              <th className="px-4 py-2 text-left font-semibold">TradeZella</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, us, them]) => (
              <tr key={label} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{label}</td>
                <td className="px-4 py-2 text-muted">{us}</td>
                <td className="px-4 py-2 text-muted">{them}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button className="mt-8" size="lg" asChild>
        <Link href="/app/dashboard">Try TradeMarkk free</Link>
      </Button>
    </div>
  );
}
