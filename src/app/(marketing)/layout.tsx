import Link from "next/link";
import { CandlestickChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { siteConfig } from "@/config/site";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/community", label: "Community" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        cta={
          <Button asChild size="sm">
            <Link href="/app/onboarding">Sign in</Link>
          </Button>
        }
      />
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
          <div>
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <CandlestickChart className="h-4 w-4 text-accent" /> TradeMark
            </div>
            <p className="mt-1 text-xs">{siteConfig.tagline} Open source, MIT licensed.</p>
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
            <Link href="/changelog" className="hover:text-foreground">
              Changelog
            </Link>
            <a
              href={siteConfig.github}
              className="hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <FeedbackDialog
              trigger={<button className="hover:text-foreground cursor-pointer">Feedback</button>}
            />
          </nav>
        </div>
      </footer>
    </div>
  );
}
