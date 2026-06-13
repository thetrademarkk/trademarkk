import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { CommunitySearch, MessagesFab, NotificationsBell } from "@/features/community";
import { QueryProvider } from "@/providers/query-provider";

export const metadata: Metadata = {
  title: { default: "Community", template: `%s · TradeMarkk Community` },
  description:
    "Trade ideas, lessons and discussion from Indian intraday & FnO traders. Educational only — no tips, no spam.",
  alternates: { canonical: "/community" },
};

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader
          cta={
            <>
              <Suspense>
                <CommunitySearch />
              </Suspense>
              <NotificationsBell />
              <Button variant="outline" size="sm" asChild>
                <Link href="/app/dashboard">
                  <NotebookPen className="h-3.5 w-3.5" aria-hidden /> My journal
                </Link>
              </Button>
            </>
          }
        />
        <main className="flex-1">{children}</main>
        <MessagesFab />
        <footer className="border-t py-6 text-center text-[11px] text-muted">
          Educational discussion only — nothing on TradeMarkk is investment advice.
        </footer>
      </div>
    </QueryProvider>
  );
}
