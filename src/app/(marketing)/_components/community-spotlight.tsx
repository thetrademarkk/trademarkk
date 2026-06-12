import Link from "next/link";
import { ArrowRight, Heart, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
// Deep import on purpose: the `@/features/community` barrel drags the whole
// feed/composer/messaging bundle (~65 kB of JS + its hydration cost) onto the
// landing route. The card view alone is all this section needs.
import { TradeCardView } from "@/features/community/components/trade-card-view";
import { Reveal } from "./reveal";

/** Split section introducing the community — copy left, real product UI right. */
export function CommunitySpotlight() {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2">
      <Reveal>
        <div>
          <p className="micro-label text-accent">New · Community</p>
          <h2 className="mt-2 text-2xl font-bold md:text-4xl">
            Trade alone. <span className="text-gradient">Learn together.</span>
          </h2>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted">
            Share a setup straight from your journal as a structured trade card — entry, stop,
            target and R-multiple, with your ₹ P&amp;L shared only if you choose. Discuss lessons,
            ask questions, and learn from traders who show their losses as openly as their wins.
          </p>
          <ul className="mt-5 space-y-2 text-sm text-muted">
            <li>· One-click “Share to community” from any trade</li>
            <li>· Educational discussion only — no tips, no paid-group spam</li>
            <li>· Works in every storage mode; your journal stays private</li>
          </ul>
          <Button className="group mt-6" asChild>
            <Link href="/community">
              Visit the community
              <ArrowRight
                className="transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </Button>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        {/* A real shared-trade card as it appears in the feed — product UI, not a testimonial. */}
        <div className="relative" aria-hidden>
          <div className="absolute -inset-4 rounded-3xl bg-accent/10 blur-2xl" />
          <div className="relative rounded-xl border bg-surface p-4 shadow-xl">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{
                  background: "linear-gradient(135deg, hsl(260 60% 45%), hsl(310 65% 35%))",
                }}
              >
                YO
              </span>
              <div className="leading-tight">
                <p className="text-sm font-semibold">You</p>
                <p className="text-xs text-muted">@your_handle · 2m</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground/90">
              ORB breakout on the 15-min range — entered the retest, trailed to 2R. Patience on the
              entry made this one.
            </p>
            <TradeCardView
              card={{
                symbol: "BANKNIFTY",
                segment: "OPT",
                strike: 52000,
                optionType: "CE",
                expiry: undefined,
                direction: "long",
                entry: 245.5,
                exit: 412.0,
                sl: 198.0,
                target: 420.0,
                rMultiple: 2.1,
                netPnl: null,
                holdMins: 47,
                openedAt: new Date().toISOString(),
              }}
            />
            <div className="mt-3 flex items-center gap-4 border-t pt-2 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <Heart className="h-4 w-4" /> 12
              </span>
              <span className="flex items-center gap-1.5">
                <MessageCircle className="h-4 w-4" /> 4
              </span>
              <span className="ml-auto rounded-md bg-accent/10 px-2 py-0.5 font-medium text-accent">
                #setups
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
