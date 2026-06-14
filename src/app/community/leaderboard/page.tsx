import type { Metadata } from "next";
import { LeaderboardPageClient } from "./leaderboard-view";

// Public, indexable surface — self-canonical so it doesn't fold into the
// /community feed canonical inherited from the layout. The client view below
// renders unchanged (and never requires auth to view the rankings).
export const metadata: Metadata = {
  title: "Leaderboard",
  description:
    "Top community contributors and shared trading streaks on TradeMarkk. Reputation reflects participation, not P&L. Educational only.",
  alternates: { canonical: "/community/leaderboard" },
};

export default function LeaderboardPage() {
  return <LeaderboardPageClient />;
}
