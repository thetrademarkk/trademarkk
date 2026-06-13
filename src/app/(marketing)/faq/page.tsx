import type { Metadata } from "next";
import { jsonLdScript } from "@/config/site";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about TradeMarkk, the free open-source trading journal.",
  alternates: { canonical: "/faq" },
};

const FAQS = [
  {
    q: "Is TradeMarkk really free?",
    a: "Yes. TradeMarkk is MIT-licensed open source. There is no premium tier, no trial, no ads. You can also self-host it on Vercel with your own keys.",
  },
  {
    q: "Where is my trading data stored?",
    a: "You choose. Hosted mode gives you a dedicated, isolated database we manage. BYOD mode connects your own free Turso database — your credentials stay in your browser and your data never touches our servers. Demo mode runs entirely in your browser.",
  },
  {
    q: "Can I switch between hosted and my own database later?",
    a: "Yes, both directions, in-app. Your data is copied directly from your browser to the target database, verified table-by-table, and only then switched. Hosted copies are deleted 30 days after you leave.",
  },
  {
    q: "Which brokers' tradebooks can I import?",
    a: "Zerodha Console, Upstox, Angel One, Dhan, Fyers and Groww tradebooks are auto-detected from the CSV header — plus a manual column mapper for anything else. Buys and sells are automatically paired into round-trip trades, and re-imports are deduplicated.",
  },
  {
    q: "Does it calculate Indian charges (STT, GST, stamp duty)?",
    a: "Yes. Charges are computed per trade from configurable broker profiles (Zerodha, Upstox, Angel One, Dhan, Fyers, Groww) covering brokerage, STT, exchange charges, SEBI fees, GST and stamp duty.",
  },
  {
    q: "Is there a mobile app?",
    a: "TradeMarkk is an installable PWA — add it to your home screen and it behaves like a native app, with a bottom tab bar and a one-tap quick-add button.",
  },
  {
    q: "What makes it different from TradeZella or Tradervue?",
    a: "Three things: it's free and open source; your data can live in your own database; and it has the deepest rules-and-mistakes engine — it literally prices each broken rule in rupees.",
  },
];

export default function FaqPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <h1 className="text-3xl font-bold">Frequently asked questions</h1>
      <div className="mt-8 max-w-3xl space-y-6">
        {FAQS.map((f) => (
          <div key={f.q}>
            <h2 className="text-base font-semibold">{f.q}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{f.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
