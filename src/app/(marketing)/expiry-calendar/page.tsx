import type { Metadata } from "next";
import Link from "next/link";
import { UpcomingExpiriesView } from "@/features/calendar";
import { EXPIRY_CALENDAR_AS_OF } from "@/features/calendar/upcoming-expiries";
import { jsonLdScript } from "@/config/site";

export const metadata: Metadata = {
  title: "F&O Expiry Calendar — NSE, BSE, MCX & NCDEX",
  description:
    "Upcoming F&O and commodity expiry dates for NSE, BSE, MCX and NCDEX — index, stock and commodity options & futures, weekly and monthly. Free, no login.",
  keywords: [
    "fno expiry calendar",
    "nse expiry calendar",
    "nifty expiry date",
    "banknifty expiry",
    "sensex expiry",
    "mcx expiry dates",
    "ncdex expiry",
    "options expiry calendar india",
  ],
  alternates: { canonical: "/expiry-calendar" },
  openGraph: { url: "/expiry-calendar", title: "F&O Expiry Calendar — NSE, BSE, MCX & NCDEX" },
};

/** Data-safe FAQ — answers stay general (the live calendar above carries the
 *  exact dates) so they never go stale or state a wrong weekday. */
const FAQS = [
  {
    q: "What is an F&O expiry?",
    a: "An expiry is the last trading day of a futures or options contract. On expiry, options settle to their intrinsic value and futures are marked to the settlement price. Indian index options have weekly and monthly expiries; single-stock and commodity contracts expire monthly.",
  },
  {
    q: "Which exchanges does this calendar cover?",
    a: "NSE and BSE (index & stock options and futures), MCX (commodity futures and options such as crude oil, gold and natural gas) and NCDEX (agri commodities). The dates come from the actual listed contracts, so holidays and expiry-day rule changes are already baked in.",
  },
  {
    q: "How often do NIFTY, BANKNIFTY and SENSEX options expire?",
    a: "Index options have a weekly expiry plus a monthly expiry; the exact upcoming dates for NIFTY, BANKNIFTY, FINNIFTY, SENSEX and the rest are listed in the calendar above. Use the Options / Futures filter to see option-only or future-only dates.",
  },
  {
    q: "Is this expiry calendar free?",
    a: "Yes — it's free and needs no login. TradeMarkk is an open-source trading journal for Indian intraday and F&O traders.",
  },
];

export default function ExpiryCalendarPage() {
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(faqLd) }}
      />

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">F&amp;O Expiry Calendar</h1>
        <p className="text-pretty text-sm leading-6 text-muted sm:text-base">
          Upcoming options &amp; futures expiries across <strong>NSE, BSE, MCX and NCDEX</strong> —
          index, stock and commodity contracts, weekly and monthly. Dates come from real listed
          contracts (holiday- and rule-adjusted). Filter by exchange or contract type.
        </p>
      </header>

      <UpcomingExpiriesView />

      <section aria-labelledby="expiry-faq" className="space-y-3 border-t pt-6">
        <h2 id="expiry-faq" className="text-lg font-semibold tracking-tight">
          Expiry calendar FAQ
        </h2>
        <dl className="space-y-4">
          {FAQS.map((f) => (
            <div key={f.q}>
              <dt className="text-sm font-semibold">{f.q}</dt>
              <dd className="mt-1 text-sm leading-6 text-muted">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-xs text-muted">
        Snapshot {EXPIRY_CALENDAR_AS_OF}. Track your own trades against these expiries in the{" "}
        <Link href="/app/calendar" className="text-accent hover:underline">
          journal calendar
        </Link>
        . Educational only — not investment advice. NCDEX dates are the approximate 20th-of-month
        convention.
      </p>
    </div>
  );
}
