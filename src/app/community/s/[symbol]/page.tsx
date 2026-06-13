import type { Metadata } from "next";
import { countPostsForSymbol } from "@/server/community";
import { lookupSymbol, normalizeSymbol } from "@/features/community/symbols";
import { SymbolStream } from "./symbol-stream";

// On-demand ISR: a per-symbol shell is rendered once per ticker then served
// from the CDN and refreshed every 5 min (post counts / OG don't need to be
// real-time). We deliberately do NOT generateStaticParams over hundreds of
// symbols — that would bloat the build; the empty list means "build none up
// front, generate each on first request and cache it".
export const revalidate = 300;
export const dynamicParams = true;

export function generateStaticParams(): { symbol: string }[] {
  return [];
}

/** Per-symbol SEO: real title/description, canonical, and OG so shared links unfurl. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol: raw } = await params;
  const symbol = normalizeSymbol(decodeURIComponent(raw));
  const info = lookupSymbol(symbol);
  const label = info ? `${symbol} (${info.name})` : symbol;
  const title = `$${symbol} — TradeMarkk Community`;
  const description = info
    ? `Educational trade ideas, charts and discussion about ${label} on TradeMarkk. Not investment advice.`
    : `Educational trade ideas and discussion tagged $${symbol} on TradeMarkk. Not investment advice.`;
  return {
    title: `$${symbol}`,
    description,
    alternates: { canonical: `/community/s/${symbol}` },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function SymbolPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: raw } = await params;
  const symbol = normalizeSymbol(decodeURIComponent(raw));
  const info = lookupSymbol(symbol);
  const count = await countPostsForSymbol(symbol);
  return (
    <SymbolStream
      symbol={symbol}
      name={info?.name ?? null}
      exchange={info?.exchange ?? null}
      initialCount={count}
    />
  );
}
