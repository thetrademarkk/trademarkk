import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Flame } from "lucide-react";
import { TrendingBoard } from "@/features/community";

export const metadata: Metadata = {
  title: "Trending — TradeMarkk Community",
  description:
    "The tickers and topics TradeMarkk traders are actively discussing, ranked by how many distinct people are talking — community discussion volume, not investment advice.",
  alternates: { canonical: "/community/trending" },
  openGraph: {
    title: "Trending on TradeMarkk Community",
    description:
      "What TradeMarkk traders are discussing right now — ranked by distinct-author breadth. Not a recommendation or tip.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Trending on TradeMarkk Community",
    description: "What TradeMarkk traders are discussing right now. Not a recommendation or tip.",
  },
};

export default function TrendingPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/community"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>

      <header className="mb-5 flex items-start gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
        >
          <Flame className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight">Trending</h1>
          <p className="mt-1 text-sm text-muted">
            What the community is talking about — tickers and topics ranked by the number of
            distinct traders discussing each.
          </p>
        </div>
      </header>

      <TrendingBoard variant="full" />
    </div>
  );
}
