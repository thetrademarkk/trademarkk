import Image from "next/image";

/**
 * The hero visual: a real dashboard screenshot inside browser chrome, with a
 * soft glow and a gentle perspective tilt that flattens on hover. Fully
 * server-rendered — zero JS, and the image is the LCP candidate (priority).
 * The screenshot is auto-captured by the landing demo recorder (2x DPR).
 */
export function HeroFrame() {
  return (
    // Not opacity-gated: the screenshot is the LCP element — it must paint
    // the moment it decodes, not after an entrance animation.
    <div className="hero-frame relative mx-auto mt-14 w-full max-w-4xl">
      <div className="absolute -inset-8 rounded-3xl bg-accent/10 blur-3xl" aria-hidden />
      <div className="hero-tilt relative overflow-hidden rounded-xl border bg-surface shadow-2xl">
        {/* Browser chrome */}
        <div className="flex items-center gap-1.5 border-b bg-surface-2/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-profit/70" />
          <span className="ml-3 hidden rounded-md bg-surface px-2.5 py-0.5 text-[11px] text-muted sm:block">
            trademark — your trading journal
          </span>
        </div>
        <Image
          src="/landing/dashboard.webp"
          alt="TradeMark dashboard: net P&L, win rate, equity curve, P&L calendar and today's rules checklist for an Indian FnO journal"
          width={2560}
          height={1494}
          priority
          sizes="(max-width: 56rem) 100vw, 56rem"
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}
