import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Github, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig, jsonLdScript } from "@/config/site";
import { HeroShowcase } from "./_components/hero-showcase";
import { FeatureBento } from "./_components/feature-bento";
import { ModeExplorer } from "./_components/mode-explorer";
import { CommunitySpotlight } from "./_components/community-spotlight";
import { ReturningUserRedirect } from "./_components/returning-user-redirect";
import { Reveal } from "./_components/reveal";

export const metadata: Metadata = {
  title: "Free open-source trading journal for Indian FnO & intraday traders",
  description: siteConfig.description,
  alternates: { canonical: "/" },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: siteConfig.name,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Web",
  description: siteConfig.description,
  offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
  url: siteConfig.url,
};

const BROKERS = ["Zerodha", "Upstox", "Angel One", "Dhan", "Fyers", "Groww"];

const STEPS = [
  {
    n: "01",
    title: "Mark the trade",
    text: "Press T. Strike, qty, entry, exit — saved with charges and R-multiple in 15 seconds.",
  },
  {
    n: "02",
    title: "Mark the mistake",
    text: "Revenge trade? Oversized? Tag it. Tick your rules off before close.",
  },
  {
    n: "03",
    title: "Review & improve",
    text: "Saturday morning: your week, priced. Adherence, expectancy, and your costliest habit.",
  },
];

const STATS = [
  { value: "₹0", label: "cost, forever" },
  { value: "<15s", label: "to log a trade" },
  { value: "3", label: "storage modes" },
  { value: "100%", label: "open source · MIT" },
];

export default function LandingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <ReturningUserRedirect />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0" aria-hidden />
        <div className="grid-fade absolute inset-0" aria-hidden />
        <div className="relative mx-auto w-full max-w-5xl px-4 pb-20 pt-16 text-center md:pt-24">
          <Reveal>
            <p className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border bg-surface/60 px-3.5 py-1.5 text-xs text-muted backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-profit animate-pulse" />
              Open source · Free forever · Built for India
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-7xl">
              Mark your trade,
              <br />
              <span className="text-gradient">every day.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mx-auto mt-5 max-w-xl text-base text-muted md:text-lg">
              The open-source trading journal for intraday &amp; FnO traders. Trades, mistakes,
              rules and reviews — with your data in <em>your own</em> database.
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild className="group">
                <Link href="/app/onboarding">
                  Start journaling — free
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/app/onboarding">Try it — no sign-up</Link>
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted">Free forever · Open source · No card required</p>
          </Reveal>

          <HeroShowcase />

          <Reveal delay={0.1}>
            <div className="mt-12">
              <p className="micro-label">Import tradebooks from</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                {BROKERS.map((b) => (
                  <span
                    key={b}
                    className="rounded-full border bg-surface/60 px-3 py-1 text-xs text-muted"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="border-t bg-surface/30" aria-label="At a glance">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-2 px-4 py-8 md:grid-cols-4 md:divide-x md:divide-border">
          {STATS.map((s) => (
            <div key={s.label} className="px-4 py-2 text-center">
              <p className="font-money text-2xl font-bold text-foreground md:text-3xl">{s.value}</p>
              <p className="micro-label mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works — connected timeline ── */}
      <section className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-20">
          <Reveal>
            <h2 className="text-center text-2xl font-bold md:text-4xl">
              The loop that builds <span className="text-gradient">discipline</span>
            </h2>
          </Reveal>
          <div className="relative mt-14">
            <div
              className="absolute left-0 right-0 top-5 hidden h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent md:block"
              aria-hidden
            />
            <ol className="grid gap-10 md:grid-cols-3">
              {STEPS.map((s, i) => (
                // The <li> stays a direct child of the <ol> (valid list semantics);
                // the Reveal animation wraps the content inside it.
                <li key={s.n} className="relative">
                  <Reveal
                    delay={i * 0.12}
                    className="relative flex gap-4 md:flex-col md:items-center md:gap-0 md:text-center"
                  >
                    <span className="z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-bg font-money text-sm font-bold text-accent">
                      {s.n}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold md:mt-4">{s.title}</h3>
                      <p className="mt-1.5 max-w-xs text-sm leading-6 text-muted">{s.text}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Feature bento ── */}
      <section className="border-t bg-surface/30">
        <div className="mx-auto w-full max-w-5xl px-4 py-20">
          <Reveal>
            <h2 className="text-center text-2xl font-bold md:text-4xl">
              Everything a serious trader needs
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-center text-sm text-muted">
              No paywall, no premium tier. The whole journal, free and open source.
            </p>
          </Reveal>
          <div className="mt-12">
            <FeatureBento />
          </div>
        </div>
      </section>

      {/* ── Community spotlight ── */}
      <section className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-20">
          <CommunitySpotlight />
        </div>
      </section>

      {/* ── Data ownership — interactive explorer ── */}
      <section className="border-t bg-surface/30">
        <div className="mx-auto w-full max-w-5xl px-4 py-20">
          <Reveal>
            <div className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs text-muted">
              <Lock className="h-3.5 w-3.5 text-accent" aria-hidden /> Privacy is the product
            </div>
            <h2 className="text-center text-2xl font-bold md:text-4xl">Your data stays yours</h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">
              Pick where your journal lives. Explore each mode:
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-10">
            <ModeExplorer />
          </Reveal>
        </div>
      </section>

      {/* ── Keyboard-first ── */}
      <section className="border-t">
        <div className="mx-auto w-full max-w-5xl px-4 py-20 text-center">
          <Reveal>
            <h2 className="text-2xl font-bold md:text-4xl">Built for speed</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted">
              Journaling only works if it&apos;s effortless. TradeMark is keyboard-first and
              installs on your phone like a native app.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-muted">
              <span>
                <kbd className="rounded-md border bg-surface px-2.5 py-1.5 font-money text-foreground shadow-sm">
                  T
                </kbd>{" "}
                new trade
              </span>
              <span>
                <kbd className="rounded-md border bg-surface px-2.5 py-1.5 font-money text-foreground shadow-sm">
                  J
                </kbd>{" "}
                today&apos;s journal
              </span>
              <span>
                <kbd className="rounded-md border bg-surface px-2.5 py-1.5 font-money text-foreground shadow-sm">
                  ⌘K
                </kbd>{" "}
                anywhere
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Open source + CTA ── */}
      <section className="relative overflow-hidden border-t">
        <div className="hero-glow absolute inset-0 rotate-180" aria-hidden />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-24 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold md:text-5xl">
              Stop repeating the same <span className="text-loss">mistakes</span>.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-sm text-muted md:text-base">
              The traders who journal are the traders who last. MIT-licensed, self-hostable, and
              free — today and always.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild className="group">
                <Link href="/app/onboarding">
                  Open TradeMark
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={siteConfig.github} target="_blank" rel="noreferrer">
                  <Github /> Star on GitHub
                </a>
              </Button>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
