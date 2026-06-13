import Link from "next/link";
import { CandlestickChart, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/shared/site-header";
import { FeedbackDialog } from "@/components/shared/feedback-dialog";
import { siteConfig } from "@/config/site";

const FOOTER_GROUPS: {
  title: string;
  links: { href: string; label: string; external?: boolean }[];
}[] = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features" },
      { href: "/community", label: "Community" },
      { href: "/pulse", label: "Pulse" },
      { href: "/docs", label: "Docs" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/blog", label: "Blog" },
      { href: "/faq", label: "FAQ" },
      { href: "/faq", label: "Privacy & your data" },
      { href: "/compare/tradezella-alternative", label: "TradeZella alternative" },
    ],
  },
  {
    title: "Open source",
    links: [
      { href: siteConfig.github, label: "GitHub", external: true },
      { href: `${siteConfig.github}/blob/main/LICENSE`, label: "MIT license", external: true },
      {
        href: `${siteConfig.github}/blob/main/docs/SECURITY.md`,
        label: "Security",
        external: true,
      },
    ],
  },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        cta={
          <Button asChild size="sm">
            <Link href="/app/onboarding" prefetch={false}>
              Sign in
            </Link>
          </Button>
        }
      />
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-surface/30">
        <div className="mx-auto w-full max-w-5xl px-4 py-10">
          <div className="flex flex-wrap justify-between gap-x-12 gap-y-8">
            <div className="max-w-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <CandlestickChart className="h-4 w-4 text-accent" aria-hidden /> TradeMark
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">
                {siteConfig.tagline} The free, open-source trading journal for Indian intraday &amp;
                FnO traders.
              </p>
              <a
                href={siteConfig.github}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
              >
                <Github className="h-3.5 w-3.5" aria-hidden /> Star on GitHub
              </a>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-8">
              {FOOTER_GROUPS.map((g) => (
                <nav key={g.title} aria-label={g.title} className="min-w-28">
                  <p className="micro-label">{g.title}</p>
                  <ul className="mt-3 space-y-2 text-xs">
                    {g.links.map((l) => (
                      <li key={l.label}>
                        {l.external ? (
                          <a
                            href={l.href}
                            target="_blank"
                            rel="noreferrer"
                            className="text-muted hover:text-foreground"
                          >
                            {l.label}
                          </a>
                        ) : (
                          <Link
                            href={l.href}
                            prefetch={false}
                            className="text-muted hover:text-foreground"
                          >
                            {l.label}
                          </Link>
                        )}
                      </li>
                    ))}
                    {g.title === "Open source" && (
                      <li>
                        <FeedbackDialog
                          trigger={
                            <button className="cursor-pointer text-muted hover:text-foreground">
                              Feedback
                            </button>
                          }
                        />
                      </li>
                    )}
                  </ul>
                </nav>
              ))}
            </div>
          </div>
          <p className="mt-10 border-t pt-5 text-[11px] text-muted">
            MIT licensed · Free forever · Educational only — nothing on TradeMark is investment
            advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
