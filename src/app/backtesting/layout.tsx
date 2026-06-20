import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { QueryProvider } from "@/providers/query-provider";
import { BacktestRunnerProvider } from "@/components/backtesting/backtest-runner-provider";

export const metadata: Metadata = {
  title: { default: "Backtesting", template: `%s · TradeMarkk Backtesting` },
  description:
    "Backtest NIFTY, BANKNIFTY & SENSEX option strategies free in your browser — honest about data coverage, no login until you save. Educational only.",
  alternates: { canonical: "/backtesting" },
};

/**
 * Public backtesting universe shell — a peer to /community. Clones the community
 * layout pattern: SiteHeader + QueryProvider + a footer disclaimer. The header
 * CTA is a "Build a strategy" entry (the primary action), kept icon+label so it
 * stays usable down to 360px. Signed-in users are NEVER redirected away from
 * this universe — it is a real destination for everyone.
 */
export default function BacktestingLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      {/* The runner lives at the LAYOUT level so an in-flight worker run survives
          navigation between /build and the (future) results view. */}
      <BacktestRunnerProvider>
        <div className="bt-terminal flex min-h-dvh flex-col">
          <SiteHeader
            cta={
              <Button
                variant="outline"
                size="sm"
                asChild
                className="px-2 sm:px-3"
                aria-label="Build a strategy"
              >
                <Link href="/backtesting/build">
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">Build a strategy</span>
                </Link>
              </Button>
            }
          />
          <main className="flex-1">{children}</main>
          <footer className="border-t py-6 text-center text-xs leading-5 text-muted">
            Educational only — backtests use patchy historical data and are not investment advice.
            Past performance never guarantees future results.
          </footer>
        </div>
      </BacktestRunnerProvider>
    </QueryProvider>
  );
}
