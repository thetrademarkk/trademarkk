import Link from "next/link";
import { CandlestickChart, Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <CandlestickChart className="h-5 w-5 text-accent" />
            Trade<span className="text-accent">Mark</span>
          </Link>
          <nav className="hidden gap-5 text-sm text-muted md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground transition-colors">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" asChild>
              <a href={siteConfig.github} target="_blank" rel="noreferrer" aria-label="GitHub">
                <Github className="h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="sm">
              <Link href="/app/dashboard">Open app</Link>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted">
          <div>
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <CandlestickChart className="h-4 w-4 text-accent" /> TradeMark
            </div>
            <p className="mt-1 text-xs">{siteConfig.tagline} Open source, MIT licensed.</p>
          </div>
          <nav className="flex gap-4 text-xs">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">{n.label}</Link>
            ))}
            <Link href="/changelog" className="hover:text-foreground">Changelog</Link>
            <a href={siteConfig.github} className="hover:text-foreground" target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
